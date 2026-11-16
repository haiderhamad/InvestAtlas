'use client';

import { auth, db } from '@/lib/firebase';
import {
  assertCloudDataReady,
  markCloudDataPending,
  markCloudDataReady,
  reportCloudDataUnavailable,
  setCloudDataWorkspace,
} from '@/lib/storage/cloud-data-status';
import { getUserScopedDocumentId } from '@/lib/storage/firestore-document-id';
import { decodeManualAccount } from '@/lib/accounts/manual-account-schema';
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

export type ManualAccountKind = 'Brokerage' | 'Bank Account' | 'Savings Account' | 'Exchange' | 'Vault' | 'Other';
export type ManualAccountPortfolioScope = 'portfolio' | 'private';
export type ManualAccountCashCategory = 'investment_cash' | 'savings_cash' | 'private_cash';
export type ManualAccountCashRoute = 'stock' | 'etf' | 'crypto' | 'metal';

export interface ManualAccount {
  id: string;
  venue: string;
  label: string;
  kind: ManualAccountKind;
  portfolioScope?: ManualAccountPortfolioScope;
  cashCategory?: ManualAccountCashCategory;
  cashRoutes?: ManualAccountCashRoute[];
  archivedAt?: string;
  needsPortfolioScopeReview?: boolean;
  notes?: string;
  createdAt: string;
}

export const MANUAL_ACCOUNTS_STORAGE_KEY = 'investatlas.manual-accounts';
export const MANUAL_ACCOUNTS_EVENT = 'investatlas:manual-accounts-change';

// Firebase State
let currentUserId: string | null = null;
let cachedAccounts: ManualAccount[] = [];
let cachedAccountDocumentIds = new Map<string, string>();
let unsubscribeSnapshot: (() => void) | null = null;

// Listen to Auth State
if (typeof window !== 'undefined' && auth) {
  onAuthStateChanged(auth, (user) => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }

    cachedAccounts = [];
    cachedAccountDocumentIds = new Map();
    currentUserId = user?.uid ?? null;
    setCloudDataWorkspace(currentUserId);

    if (user) {
      const listenerUserId = user.uid;
      markCloudDataPending('accounts', listenerUserId);
      window.dispatchEvent(
        new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: [] }),
      );

      // Subscribe to accounts
      const q = query(collection(db, 'manual-accounts'), where('userId', '==', user.uid));
      unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        if (
          currentUserId !== listenerUserId
          || snapshot.metadata.hasPendingWrites
        ) {
          return;
        }
        try {
          const nextDocumentIds = new Map<string, string>();
          const nextAccounts = snapshot.docs.map((snapshotDocument) => {
            const data = snapshotDocument.data();
            // Ownership is enforced by the query/rules and never exposed to UI.
            const { userId, ...rest } = data;
            const account = decodeManualAccount(rest);
            nextDocumentIds.set(account.id, snapshotDocument.id);
            return account;
          });
          cachedAccounts = nextAccounts;
          cachedAccountDocumentIds = nextDocumentIds;
          markCloudDataReady('accounts', listenerUserId);
        } catch (error) {
          cachedAccounts = [];
          cachedAccountDocumentIds = new Map();
          reportCloudDataUnavailable('accounts', listenerUserId, error);
          window.dispatchEvent(
            new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: [] }),
          );
          return;
        }
        
        // Notify components
        window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }));
      }, (error) => {
        if (currentUserId !== listenerUserId) return;
        cachedAccounts = [];
        cachedAccountDocumentIds = new Map();
        reportCloudDataUnavailable('accounts', listenerUserId, error);
        window.dispatchEvent(
          new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: [] }),
        );
      });
      
      // Keep the anonymous Local Workspace separate from the signed-in cloud
      // workspace. Users can transfer data through the explicit import flow.
      
    } else {
      window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }));
    }
  });
}

export function getAllManualAccounts(): ManualAccount[] {
  return currentUserId
    ? cachedAccounts
    : readAnonymousWorkspaceMode() === 'demo_snapshot'
      ? []
      : readManualAccounts();
}

export class DemoAccountWorkspaceReadOnlyError extends Error {
  constructor() {
    super('The Demo Snapshot is read-only. Start a Local Workspace before editing accounts.');
    this.name = 'DemoAccountWorkspaceReadOnlyError';
  }
}

function assertAnonymousWorkspaceWritable(): void {
  if (!currentUserId && readAnonymousWorkspaceMode() === 'demo_snapshot') {
    throw new DemoAccountWorkspaceReadOnlyError();
  }
}

const sanitizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

const normalizeAccount = (account: ManualAccount): ManualAccount =>
  decodeManualAccount(account);

export function isPortfolioAccount(account?: ManualAccount | null) {
  return (account?.portfolioScope ?? 'portfolio') === 'portfolio';
}

export function isCashReserveAccount(account?: ManualAccount | null) {
  return account?.cashCategory === 'savings_cash';
}

export function isPortfolioVenue(venue: string, manualAccounts: ManualAccount[] = []) {
  const account = manualAccounts.find((candidate) => candidate.venue === venue);
  if (account?.archivedAt) return false;
  return account ? isPortfolioAccount(account) : true;
}

export function readManualAccounts(): ManualAccount[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(decodeManualAccount);
  } catch {
    return [];
  }
}

function writeManualAccounts(accounts: ManualAccount[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: accounts }));
}

export function addManualAccount(input: {
  label: string;
  kind: ManualAccountKind;
  portfolioScope?: ManualAccountPortfolioScope;
  cashCategory?: ManualAccountCashCategory;
  cashRoutes?: ManualAccountCashRoute[];
  notes?: string;
}): ManualAccount[] | Promise<ManualAccount[]> {
  assertAnonymousWorkspaceWritable();
  const label = input.label.trim();
  if (!label) {
    return getAllManualAccounts();
  }

  const existing = getAllManualAccounts();
  const duplicate = existing.find((a) => a.label.trim().toLowerCase() === label.toLowerCase());
  if (duplicate) {
    throw new Error(`Account with name "${label}" already exists!`);
  }

  const slug = sanitizeSlug(label) || 'manual-account';
  const timestamp = Date.now();
  const nextAccount: ManualAccount = normalizeAccount({
    id: `manual-account-${timestamp}`,
    venue: `manual-${slug}-${timestamp}`,
    label,
    kind: input.kind,
    portfolioScope: input.portfolioScope,
    cashCategory: input.cashCategory,
    cashRoutes: input.cashRoutes,
    needsPortfolioScopeReview: false,
    notes: input.notes,
    createdAt: new Date(timestamp).toISOString(),
  });

  if (currentUserId) {
    assertCloudDataReady('accounts');
    const userId = currentUserId;
    const documentId =
      cachedAccountDocumentIds.get(nextAccount.id)
      ?? getUserScopedDocumentId(userId, nextAccount.id);
    return (async () => {
      await setDoc(
        doc(db, 'manual-accounts', documentId),
        { ...nextAccount, userId },
      );

      if (currentUserId === userId) {
        cachedAccountDocumentIds.set(nextAccount.id, documentId);
        cachedAccounts = [
          nextAccount,
          ...cachedAccounts.filter((account) => account.id !== nextAccount.id),
        ];
        window.dispatchEvent(
          new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }),
        );
      }

      return getAllManualAccounts();
    })();
  } else {
    const nextAccounts = [nextAccount, ...readManualAccounts()];
    writeManualAccounts(nextAccounts);
  }

  return getAllManualAccounts();
}

export function updateManualAccount(
  venue: string,
  updates: {
    label?: string;
    kind?: ManualAccountKind;
    portfolioScope?: ManualAccountPortfolioScope;
    cashCategory?: ManualAccountCashCategory;
    cashRoutes?: ManualAccountCashRoute[];
    archivedAt?: string;
    needsPortfolioScopeReview?: boolean;
    notes?: string;
  },
): ManualAccount[] | Promise<ManualAccount[]> {
  assertAnonymousWorkspaceWritable();
  if (currentUserId) {
    assertCloudDataReady('accounts');
    const userId = currentUserId;
    const accountToUpdate = cachedAccounts.find((a) => a.venue === venue);
    if (accountToUpdate) {
      const updated = normalizeAccount({ ...accountToUpdate, ...updates });
      const documentId =
        cachedAccountDocumentIds.get(accountToUpdate.id)
        ?? getUserScopedDocumentId(userId, accountToUpdate.id);
      return (async () => {
        await setDoc(
          doc(db, 'manual-accounts', documentId),
          { ...updated, userId },
        );

        if (currentUserId === userId) {
          cachedAccountDocumentIds.set(accountToUpdate.id, documentId);
          cachedAccounts = cachedAccounts.map((account) =>
            account.venue === venue ? updated : account
          );
          window.dispatchEvent(
            new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }),
          );
        }

        return getAllManualAccounts();
      })();
    }
  } else {
    const nextAccounts = readManualAccounts().map((account) => {
      if (account.venue === venue) {
        return normalizeAccount({
          ...account,
          ...updates,
        });
      }
      return account;
    });
    writeManualAccounts(nextAccounts);
  }
  return getAllManualAccounts();
}

export function removeManualAccount(venue: string): ManualAccount[] | Promise<ManualAccount[]> {
  assertAnonymousWorkspaceWritable();
  if (currentUserId) {
    assertCloudDataReady('accounts');
    const userId = currentUserId;
    const accountToDelete = cachedAccounts.find((a) => a.venue === venue);
    if (accountToDelete) {
      const documentId =
        cachedAccountDocumentIds.get(accountToDelete.id)
        ?? getUserScopedDocumentId(userId, accountToDelete.id);
      return (async () => {
        await deleteDoc(doc(db, 'manual-accounts', documentId));

        if (currentUserId === userId) {
          cachedAccountDocumentIds.delete(accountToDelete.id);
          cachedAccounts = cachedAccounts.filter((account) => account.venue !== venue);
          window.dispatchEvent(
            new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }),
          );
        }

        return getAllManualAccounts();
      })();
    }
  } else {
    const nextAccounts = readManualAccounts().filter((account) => account.venue !== venue);
    writeManualAccounts(nextAccounts);
  }
  return getAllManualAccounts();
}

export async function upsertManualAccountsForImport(accounts: ManualAccount[]): Promise<ManualAccount[]> {
  assertAnonymousWorkspaceWritable();
  if (accounts.length === 0) return getAllManualAccounts();

  const normalized = accounts.map(normalizeAccount);
  const incomingIds = new Set(normalized.map((account) => account.id));
  const incomingVenues = new Set(normalized.map((account) => account.venue));
  const incomingLabels = new Set(normalized.map((account) => account.label.trim().toLowerCase()));

  if (currentUserId) {
    assertCloudDataReady('accounts');
    const userId = currentUserId;

    const batch = writeBatch(db);
    normalized.forEach((account) => {
      const documentId =
        cachedAccountDocumentIds.get(account.id)
        ?? getUserScopedDocumentId(userId, account.id);
      batch.set(doc(db, 'manual-accounts', documentId), { ...account, userId });
    });
    await batch.commit();

    if (currentUserId === userId) {
      normalized.forEach((account) => {
        cachedAccountDocumentIds.set(
          account.id,
          cachedAccountDocumentIds.get(account.id)
            ?? getUserScopedDocumentId(userId, account.id),
        );
      });
      cachedAccounts = [
        ...normalized,
        ...cachedAccounts.filter(
          (account) =>
            !incomingIds.has(account.id) &&
            !incomingVenues.has(account.venue) &&
            !incomingLabels.has(account.label.trim().toLowerCase()),
        ),
      ];
      window.dispatchEvent(
        new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }),
      );
    }
  } else {
    const nextAccounts = [
      ...normalized,
      ...readManualAccounts().filter(
        (account) =>
          !incomingIds.has(account.id) &&
          !incomingVenues.has(account.venue) &&
          !incomingLabels.has(account.label.trim().toLowerCase()),
      ),
    ];
    writeManualAccounts(nextAccounts);
  }

  return getAllManualAccounts();
}

export async function clearManualAccounts() {
  assertAnonymousWorkspaceWritable();
  if (currentUserId) {
    assertCloudDataReady('accounts');
    const q = query(collection(db, 'manual-accounts'), where('userId', '==', currentUserId));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map((doc) => deleteDoc(doc.ref));
    await Promise.all(deletePromises);

    // Keep the visible cloud workspace unchanged until every delete is
    // acknowledged. Retrying after a partial remote failure is idempotent.
    cachedAccounts = [];
    cachedAccountDocumentIds = new Map();
    window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }));
  } else {
    writeManualAccounts([]);
  }
}
