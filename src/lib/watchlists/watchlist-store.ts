'use client';

import {
  getActiveBrowserWorkspaceUserId,
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export const WATCHLISTS_STORAGE_KEY = 'investatlas.watchlists';
export const WATCHLISTS_STORAGE_EVENT = 'investatlas:watchlists-change';

export const DEFAULT_WATCHLISTS: Watchlist[] = [
  {
    id: 'core',
    name: 'Core Ideas',
    symbols: ['BTC', 'ISWD', 'GOLD'],
  },
];

export function isDemoWatchlistWorkspace(): boolean {
  return getActiveBrowserWorkspaceUserId() === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot';
}

function getDemoWatchlists(): Watchlist[] {
  return INVESTATLAS_SHOWCASE_SNAPSHOT.watchlists.map((watchlist) => ({
    id: watchlist.id,
    name: watchlist.name,
    symbols: [...watchlist.symbols],
  }));
}

export function readWatchlists(): Watchlist[] {
  if (typeof window === 'undefined') {
    return DEFAULT_WATCHLISTS;
  }

  if (isDemoWatchlistWorkspace()) return getDemoWatchlists();

  try {
    const raw = readWorkspaceStorageItem(WATCHLISTS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_WATCHLISTS;
    }

    const parsed = JSON.parse(raw) as Watchlist[];
    if (!Array.isArray(parsed)) {
      return DEFAULT_WATCHLISTS;
    }

    return parsed.filter(
      (watchlist) =>
        watchlist &&
        typeof watchlist.id === 'string' &&
        typeof watchlist.name === 'string' &&
        Array.isArray(watchlist.symbols),
    );
  } catch {
    return DEFAULT_WATCHLISTS;
  }
}

export function writeWatchlists(nextWatchlists: Watchlist[]) {
  if (typeof window === 'undefined') {
    return;
  }

  if (isDemoWatchlistWorkspace()) {
    throw new Error('The Demo Snapshot is read-only.');
  }

  if (writeWorkspaceStorageItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(nextWatchlists))) {
    window.dispatchEvent(new CustomEvent(WATCHLISTS_STORAGE_EVENT, { detail: nextWatchlists }));
  }
}
