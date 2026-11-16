'use client';

import {
  DEFAULT_TAX_PROFILE_SETTINGS,
  normalizeTaxProfileSettings,
  type TaxProfileSettings,
} from '@/lib/tax/tax-profile';
import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

export const TAX_PROFILE_STORAGE_KEY = 'investatlas.tax-profile-settings';
export const TAX_PROFILE_STORAGE_EVENT = 'investatlas:tax-profile-settings-change';

export function readTaxProfileSettings(): TaxProfileSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_TAX_PROFILE_SETTINGS;
  }

  try {
    const raw = readWorkspaceStorageItem(TAX_PROFILE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TAX_PROFILE_SETTINGS;
    }

    return normalizeTaxProfileSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_TAX_PROFILE_SETTINGS;
  }
}

export function writeTaxProfileSettings(nextSettings: TaxProfileSettings): TaxProfileSettings {
  const normalized = normalizeTaxProfileSettings(nextSettings);

  if (typeof window !== 'undefined') {
    if (writeWorkspaceStorageItem(TAX_PROFILE_STORAGE_KEY, JSON.stringify(normalized))) {
      window.dispatchEvent(new CustomEvent(TAX_PROFILE_STORAGE_EVENT, { detail: normalized }));
    }
  }

  return normalized;
}
