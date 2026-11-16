'use client';

import type {
  InvestmentTaxType,
  InvestmentTransaction,
  InvestmentTransactionType,
} from '@/lib/tax/investment-tax';
import { auth, db } from '@/lib/firebase';
import { assertTransactionsHaveRequiredCash } from '@/lib/transactions/cash-balances';
import {
  assertCloudDataReady,
  markCloudDataPending,
  markCloudDataReady,
  reportCloudDataUnavailable,
  setCloudDataWorkspace,
} from '@/lib/storage/cloud-data-status';
import { getUserScopedDocumentId } from '@/lib/storage/firestore-document-id';
import { decodeInvestmentTransaction } from '@/lib/transactions/transaction-schema';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useState, useEffect } from 'react';

export type AppTransaction = InvestmentTransaction & {
  source: 'demo' | 'manual' | 'broker';
};

export function deriveTaxType(
  type: InvestmentTransactionType,
  assetClass: InvestmentTransaction['assetClass'] = 'cash',
): InvestmentTaxType {
  switch (type) {
    case 'buy':
      return 'acquisition';
    case 'sell':
      return 'disposal';
    case 'dividend':
      return 'dividend_income';
    case 'deposit':
      return assetClass === 'cash' ? 'cash_in' : 'transfer_in';
    case 'withdrawal':
      return assetClass === 'cash' ? 'cash_out' : 'transfer_out';
    case 'transfer':
      return 'transfer_in';
    case 'fee':
      return 'fee_expense';
    case 'adjustment':
      return 'adjustment';
  }
}

export const MANUAL_TRANSACTIONS_STORAGE_KEY = 'investatlas.manual-transactions';
export const MANUAL_TRANSACTIONS_EVENT = 'investatlas:manual-transactions-change';

function normalizeTransaction(
  input: InvestmentTransaction,
  allowMissingLegacyMetalFineness = false,
): AppTransaction {
  const normalized = decodeInvestmentTransaction({
    ...input,
    asset: input.asset.trim().toUpperCase(),
    quote: input.quote.trim().toUpperCase(),
    source: input.source ?? 'manual',
    venue: input.venue.trim() || 'manual-entry',
    price: typeof input.price === 'string' ? parseFloat(input.price) : input.price,
    amount: typeof input.amount === 'string' ? parseFloat(input.amount) : input.amount,
    total: typeof input.total === 'string' ? parseFloat(input.total) : input.total,
  }, {
    allowMissingLegacyMetalFineness,
  }) as AppTransaction;

  const settlementVenue = input.settlementVenue?.trim();
  if (settlementVenue) {
    normalized.settlementVenue = settlementVenue;
  } else {
    delete normalized.settlementVenue;
  }

  return normalized;
}

function toFirestoreData(transaction: AppTransaction) {
  return Object.fromEntries(
    Object.entries(transaction).filter(([, value]) => value !== undefined),
  );
}

export function getDemoTransactions(): AppTransaction[] {
  return INVESTATLAS_SHOWCASE_SNAPSHOT.transactions.map((transaction) => {
    const normalized = normalizeTransaction({
      id: transaction.id,
      date: transaction.date,
      venue: transaction.venue,
      type: transaction.type,
      asset: transaction.asset,
      assetName: INVESTATLAS_SHOWCASE_SNAPSHOT.assets.find(
        (asset) => asset.symbol === transaction.asset,
      )?.name,
      assetClass: transaction.assetClass,
      quote: transaction.quote,
      amount: transaction.amount,
      price: transaction.price,
      total: transaction.total,
      fee: transaction.fee,
      metalFineness: transaction.metalFineness,
      taxType: transaction.taxType,
      source: 'manual',
    } as InvestmentTransaction);
    return { ...normalized, source: 'demo' };
  });
}

export function readManualTransactions(): AppTransaction[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_TRANSACTIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((transaction) =>
      normalizeTransaction(transaction as InvestmentTransaction, true));
  } catch {
    return [];
  }
}

function writeManualTransactions(transactions: AppTransaction[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MANUAL_TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions));
  window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: transactions }));
}

// Firebase State
let currentUserId: string | null = null;
let cachedTransactions: AppTransaction[] = [];
let cachedTransactionDocumentIds = new Map<string, string>();
let unsubscribeTransactionsSnapshot: (() => void) | null = null;

// Listen to Auth State
if (typeof window !== 'undefined' && auth) {
  onAuthStateChanged(auth, (user) => {
    if (unsubscribeTransactionsSnapshot) {
      unsubscribeTransactionsSnapshot();
      unsubscribeTransactionsSnapshot = null;
    }

    cachedTransactions = [];
    cachedTransactionDocumentIds = new Map();
    currentUserId = user?.uid ?? null;
    setCloudDataWorkspace(currentUserId);

    if (user) {
      const listenerUserId = user.uid;
      markCloudDataPending('transactions', listenerUserId);
      window.dispatchEvent(
        new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: [] }),
      );

      // Subscribe to transactions
      const q = query(collection(db, 'transactions'), where('userId', '==', user.uid));
      unsubscribeTransactionsSnapshot = onSnapshot(q, (snapshot) => {
        if (
          currentUserId !== listenerUserId
          || snapshot.metadata.hasPendingWrites
        ) {
          return;
        }
        try {
          const nextDocumentIds = new Map<string, string>();
          const nextTransactions = snapshot.docs.map((snapshotDocument) => {
            const transactionData = { ...snapshotDocument.data() };
            delete transactionData.userId;
            const transaction = normalizeTransaction(
              transactionData as InvestmentTransaction,
              true,
            );
            nextDocumentIds.set(transaction.id, snapshotDocument.id);
            return transaction;
          });
          cachedTransactions = nextTransactions;
          cachedTransactionDocumentIds = nextDocumentIds;
          markCloudDataReady('transactions', listenerUserId);
        } catch (error) {
          cachedTransactions = [];
          cachedTransactionDocumentIds = new Map();
          reportCloudDataUnavailable('transactions', listenerUserId, error);
          window.dispatchEvent(
            new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: [] }),
          );
          return;
        }
        
        // Notify components
        window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }));
      }, (error) => {
        if (currentUserId !== listenerUserId) return;
        cachedTransactions = [];
        cachedTransactionDocumentIds = new Map();
        reportCloudDataUnavailable('transactions', listenerUserId, error);
        window.dispatchEvent(
          new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: [] }),
        );
      });
      
      // The anonymous Local Workspace remains isolated from the signed-in cloud
      // workspace. Import/export is the explicit, acknowledged transfer path.
      
    } else {
      window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }));
    }
  });
}

export function getAllTransactions(): AppTransaction[] {
  const transactions = currentUserId
    ? cachedTransactions
    : readAnonymousWorkspaceMode() === 'demo_snapshot'
      ? getDemoTransactions()
      : readManualTransactions();
  return [...transactions].sort(
    (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
  );
}

export class DemoWorkspaceReadOnlyError extends Error {
  constructor() {
    super('The Demo Snapshot is read-only. Start a Local Workspace before editing data.');
    this.name = 'DemoWorkspaceReadOnlyError';
  }
}

function assertAnonymousWorkspaceWritable(): void {
  if (!currentUserId && readAnonymousWorkspaceMode() === 'demo_snapshot') {
    throw new DemoWorkspaceReadOnlyError();
  }
}

export function addManualTransaction(
  transaction: InvestmentTransaction,
): AppTransaction[] | Promise<AppTransaction[]> {
  assertAnonymousWorkspaceWritable();
  const normalized = normalizeTransaction(transaction);
  assertTransactionsHaveRequiredCash(getAllTransactions(), [normalized]);
  
  if (currentUserId) {
    assertCloudDataReady('transactions');
    const userId = currentUserId;
    const documentId =
      cachedTransactionDocumentIds.get(normalized.id)
      ?? getUserScopedDocumentId(userId, normalized.id);
    return (async () => {
      await setDoc(
        doc(db, 'transactions', documentId),
        { ...toFirestoreData(normalized), userId },
      );

      if (currentUserId === userId) {
        cachedTransactionDocumentIds.set(normalized.id, documentId);
        cachedTransactions = [
          normalized,
          ...cachedTransactions.filter((transaction) => transaction.id !== normalized.id),
        ].sort(
          (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
        );
        window.dispatchEvent(
          new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }),
        );
      }

      return getAllTransactions();
    })();
  } else {
    const nextTransactions = [normalized, ...readManualTransactions()].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
    writeManualTransactions(nextTransactions);
  }
  
  return getAllTransactions();
}

export function addManualTransactions(
  transactions: InvestmentTransaction[],
): AppTransaction[] | Promise<AppTransaction[]> {
  assertAnonymousWorkspaceWritable();
  if (transactions.length === 0) return readManualTransactions();
  const normalized = transactions.map((transaction) =>
    normalizeTransaction(transaction));
  assertTransactionsHaveRequiredCash(getAllTransactions(), normalized);
  
  if (currentUserId) {
    assertCloudDataReady('transactions');
    const userId = currentUserId;
    return (async () => {
      const batch = writeBatch(db);
      normalized.forEach((transaction) => {
        const documentId =
          cachedTransactionDocumentIds.get(transaction.id)
          ?? getUserScopedDocumentId(userId, transaction.id);
        batch.set(
          doc(db, 'transactions', documentId),
          { ...toFirestoreData(transaction), userId },
        );
      });
      await batch.commit();

      if (currentUserId === userId) {
        normalized.forEach((transaction) => {
          cachedTransactionDocumentIds.set(
            transaction.id,
            cachedTransactionDocumentIds.get(transaction.id)
              ?? getUserScopedDocumentId(userId, transaction.id),
          );
        });
        const incomingIds = new Set(normalized.map((transaction) => transaction.id));
        cachedTransactions = [
          ...normalized,
          ...cachedTransactions.filter((transaction) => !incomingIds.has(transaction.id)),
        ].sort(
          (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
        );
        window.dispatchEvent(
          new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }),
        );
      }

      return getAllTransactions();
    })();
  } else {
    const nextTransactions = [...normalized, ...readManualTransactions()].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
    writeManualTransactions(nextTransactions);
  }
  
  return getAllTransactions();
}

export async function upsertManualTransactionsForImport(transactions: InvestmentTransaction[]): Promise<AppTransaction[]> {
  assertAnonymousWorkspaceWritable();
  if (transactions.length === 0) return getAllTransactions();

  const normalized = transactions.map((transaction) =>
    normalizeTransaction(transaction)).map((transaction) => ({
    ...transaction,
    source: transaction.source === 'demo' ? 'manual' : transaction.source,
  }));
  const incomingIds = new Set(normalized.map((transaction) => transaction.id));
  assertTransactionsHaveRequiredCash(getAllTransactions(), normalized);

  if (currentUserId) {
    assertCloudDataReady('transactions');
    const userId = currentUserId;

    const batch = writeBatch(db);
    normalized.forEach((transaction) => {
      const documentId =
        cachedTransactionDocumentIds.get(transaction.id)
        ?? getUserScopedDocumentId(userId, transaction.id);
      batch.set(
        doc(db, 'transactions', documentId),
        { ...toFirestoreData(transaction), userId },
      );
    });
    await batch.commit();

    if (currentUserId === userId) {
      normalized.forEach((transaction) => {
        cachedTransactionDocumentIds.set(
          transaction.id,
          cachedTransactionDocumentIds.get(transaction.id)
            ?? getUserScopedDocumentId(userId, transaction.id),
        );
      });
      cachedTransactions = [
        ...normalized,
        ...cachedTransactions.filter((transaction) => !incomingIds.has(transaction.id)),
      ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
      window.dispatchEvent(
        new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }),
      );
    }
  } else {
    const nextTransactions = [
      ...normalized,
      ...readManualTransactions().filter((transaction) => !incomingIds.has(transaction.id)),
    ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    writeManualTransactions(nextTransactions);
  }

  return getAllTransactions();
}

export function removeManualTransaction(id: string): AppTransaction[] | Promise<AppTransaction[]> {
  assertAnonymousWorkspaceWritable();
  if (currentUserId) {
    assertCloudDataReady('transactions');
    const userId = currentUserId;
    const documentId =
      cachedTransactionDocumentIds.get(id)
      ?? getUserScopedDocumentId(userId, id);
    return (async () => {
      await deleteDoc(doc(db, 'transactions', documentId));

      if (currentUserId === userId) {
        cachedTransactionDocumentIds.delete(id);
        cachedTransactions = cachedTransactions.filter((transaction) => transaction.id !== id);
        window.dispatchEvent(
          new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }),
        );
      }

      return getAllTransactions();
    })();
  } else {
    const nextTransactions = readManualTransactions().filter((transaction) => transaction.id !== id);
    writeManualTransactions(nextTransactions);
  }
  return getAllTransactions();
}

export function updateManualTransaction(
  updated: InvestmentTransaction,
): AppTransaction[] | Promise<AppTransaction[]> {
  assertAnonymousWorkspaceWritable();
  const stamped = normalizeTransaction({ ...updated, updatedAt: new Date().toISOString() });
  assertTransactionsHaveRequiredCash(
    getAllTransactions().filter((transaction) => transaction.id !== updated.id),
    [stamped],
  );
  
  if (currentUserId) {
    assertCloudDataReady('transactions');
    const userId = currentUserId;
    const documentId =
      cachedTransactionDocumentIds.get(updated.id)
      ?? getUserScopedDocumentId(userId, updated.id);
    return (async () => {
      await setDoc(
        doc(db, 'transactions', documentId),
        { ...toFirestoreData(stamped), userId },
      );

      if (currentUserId === userId) {
        cachedTransactionDocumentIds.set(updated.id, documentId);
        cachedTransactions = cachedTransactions.map((transaction) =>
          transaction.id === updated.id ? stamped : transaction
        );
        window.dispatchEvent(
          new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }),
        );
      }

      return getAllTransactions();
    })();
  } else {
    const nextTransactions = readManualTransactions().map((t) => (t.id === updated.id ? stamped : t));
    writeManualTransactions(nextTransactions);
  }
  return getAllTransactions();
}

export async function clearManualTransactions() {
  assertAnonymousWorkspaceWritable();
  if (currentUserId) {
    assertCloudDataReady('transactions');
    const q = query(collection(db, 'transactions'), where('userId', '==', currentUserId));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map((doc) => deleteDoc(doc.ref));
    await Promise.all(deletePromises);

    // Only reflect an empty cloud workspace after all acknowledged deletes
    // succeeded. A failed request remains safely retryable.
    cachedTransactions = [];
    cachedTransactionDocumentIds = new Map();
    window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }));
  } else {
    writeManualTransactions([]);
  }
}

// Custom Hook for React
export function useTransactions() {
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);

  useEffect(() => {
    setTransactions(getAllTransactions());
    
    const handleSync = () => {
      setTransactions(getAllTransactions());
    };
    
    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, handleSync);
    return () => window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, handleSync);
  }, []);

  return transactions;
}
