'use client';

import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  assertCloudDataReady,
  markCloudDataPending,
  markCloudDataReady,
  reportCloudDataUnavailable,
  setCloudDataWorkspace,
} from '@/lib/storage/cloud-data-status';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

export const ASSET_RISK_STORAGE_KEY = 'investatlas.asset-risk';
export const ASSET_RISK_EVENT = 'investatlas.asset-risk-updated';

export type RiskCategory = 'High' | 'Medium' | 'Low';

// Firebase State
let currentUserId: string | null = null;
let cachedRisks: Record<string, RiskCategory> = {};
let unsubscribeSnapshot: (() => void) | null = null;

// Listen to Auth State
if (typeof window !== 'undefined' && auth) {
  onAuthStateChanged(auth, (user) => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }

    cachedRisks = {};
    currentUserId = user?.uid ?? null;
    setCloudDataWorkspace(currentUserId);

    if (user) {
      const listenerUserId = user.uid;
      markCloudDataPending('asset_risks', listenerUserId);
      window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: {} }));

      // Subscribe to risks for this user
      const q = query(collection(db, 'asset-risks'), where('userId', '==', user.uid));
      unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        if (
          currentUserId !== listenerUserId
          || snapshot.metadata.hasPendingWrites
        ) {
          return;
        }
        const risks: Record<string, RiskCategory> = {};
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.symbol && data.risk) {
            risks[data.symbol] = data.risk as RiskCategory;
          }
        });
        cachedRisks = risks;
        markCloudDataReady('asset_risks', listenerUserId);
        window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: risks }));
      }, (error) => {
        if (currentUserId !== listenerUserId) return;
        cachedRisks = {};
        reportCloudDataUnavailable('asset_risks', listenerUserId, error);
        window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: {} }));
      });
      
      // Local risk preferences belong to the anonymous Local Workspace and are
      // not migrated implicitly when a user signs in.
      
    } else {
      window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: {} }));
    }
  });
}

function readLocalRisks(): Record<string, RiskCategory> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ASSET_RISK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isAnonymousDemoWorkspace(): boolean {
  return !currentUserId && readAnonymousWorkspaceMode() === 'demo_snapshot';
}

export function readAssetRisks(): Record<string, RiskCategory> {
  return currentUserId
    ? cachedRisks
    : isAnonymousDemoWorkspace()
      ? {}
      : readLocalRisks();
}

export function writeAssetRisks(risks: Record<string, RiskCategory>) {
  if (typeof window === 'undefined') return;
  if (isAnonymousDemoWorkspace()) return;
  
  if (currentUserId) {
    // Firestore handles persistence per document in saveAssetRisk
  } else {
    window.localStorage.setItem(ASSET_RISK_STORAGE_KEY, JSON.stringify(risks));
    window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: risks }));
  }
}

function normalizeRiskSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(normalized)) {
    throw new Error('Invalid asset symbol.');
  }
  return normalized;
}

export async function saveAssetRisk(
  symbol: string,
  risk: RiskCategory | undefined,
): Promise<void> {
  if (!risk) return;
  if (isAnonymousDemoWorkspace()) return;

  const normalizedSymbol = normalizeRiskSymbol(symbol);

  if (currentUserId) {
    assertCloudDataReady('asset_risks');
    const userId = currentUserId;
    await setDoc(doc(db, 'asset-risks', `${userId}_${normalizedSymbol}`), {
      symbol: normalizedSymbol,
      risk,
      userId,
    });

    if (currentUserId !== userId) {
      return;
    }

    cachedRisks = {
      ...cachedRisks,
      [normalizedSymbol]: risk,
    };
    window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: cachedRisks }));
  } else {
    const risks = readLocalRisks();
    if (risks[normalizedSymbol] === risk) return;
    risks[normalizedSymbol] = risk;
    window.localStorage.setItem(ASSET_RISK_STORAGE_KEY, JSON.stringify(risks));
    window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: risks }));
  }
}

export async function saveAssetRisks(
  newRisks: Record<string, RiskCategory>,
): Promise<void> {
  if (isAnonymousDemoWorkspace()) return;
  const normalizedRisks = Object.fromEntries(
    Object.entries(newRisks).map(([symbol, risk]) => [
      normalizeRiskSymbol(symbol),
      risk,
    ]),
  ) as Record<string, RiskCategory>;

  if (currentUserId) {
    assertCloudDataReady('asset_risks');
    const userId = currentUserId;
    const batch = writeBatch(db);
    Object.entries(normalizedRisks).forEach(([symbol, risk]) => {
      batch.set(doc(db, 'asset-risks', `${userId}_${symbol}`), {
        symbol,
        risk,
        userId,
      });
    });
    await batch.commit();

    if (currentUserId !== userId) {
      return;
    }

    cachedRisks = {
      ...cachedRisks,
      ...normalizedRisks,
    };
    window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: cachedRisks }));
  } else {
    const risks = readLocalRisks();
    let changed = false;
    for (const [symbol, risk] of Object.entries(normalizedRisks)) {
      if (risk && risks[symbol] !== risk) {
        risks[symbol] = risk;
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(ASSET_RISK_STORAGE_KEY, JSON.stringify(risks));
      window.dispatchEvent(new CustomEvent(ASSET_RISK_EVENT, { detail: risks }));
    }
  }
}
