'use client';

import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

export const HIDDEN_ACCOUNTS_STORAGE_KEY = 'investatlas.hidden-accounts';
export const HIDDEN_ACCOUNTS_EVENT = 'investatlas:hidden-accounts-change';

function normalizeVenues(venues: string[]) {
  return [...new Set(venues.map((venue) => venue.trim()).filter(Boolean))];
}

export function readHiddenAccountVenues(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = readWorkspaceStorageItem(HIDDEN_ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeVenues(parsed);
  } catch {
    return [];
  }
}

function writeHiddenAccountVenues(venues: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  const nextVenues = normalizeVenues(venues);
  if (writeWorkspaceStorageItem(HIDDEN_ACCOUNTS_STORAGE_KEY, JSON.stringify(nextVenues))) {
    window.dispatchEvent(new CustomEvent(HIDDEN_ACCOUNTS_EVENT, { detail: nextVenues }));
  }
}

export function setHiddenAccountVenues(venues: string[]) {
  writeHiddenAccountVenues(venues);
  return readHiddenAccountVenues();
}

export function toggleHiddenAccountVenue(venue: string) {
  const current = readHiddenAccountVenues();
  const next = current.includes(venue)
    ? current.filter((entry) => entry !== venue)
    : [...current, venue];

  writeHiddenAccountVenues(next);
  return readHiddenAccountVenues();
}

export function resetHiddenAccountVenues() {
  writeHiddenAccountVenues([]);
  return [];
}
