'use client';

import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';
import {
  normalizePersonalListingIdentity,
  type PersonalListingIdentity,
} from './personal-instrument';

export type LocalUserAssetClass = 'crypto' | 'stock' | 'etf' | 'metal';

export interface LocalUserAsset {
  symbol: string;
  name: string;
  assetClass: LocalUserAssetClass;
  isin?: string;
  wkn?: string;
  yahooSymbol?: string;
  searchAliases?: string[];
  /** Portable hint only; never screening evidence or proof of a provider response. */
  listing?: PersonalListingIdentity;
}

export const USER_ASSETS_STORAGE_KEY = 'userAssets';
export const HIDDEN_ASSETS_STORAGE_KEY = 'hiddenAssets';
export const USER_ASSETS_CHANGE_EVENT = 'investatlas:user-assets-change';

const MAX_USER_ASSETS = 256;
const MAX_USER_ASSETS_BYTES = 1024 * 1024;
const ASSET_FIELDS = new Set([
  'symbol', 'name', 'assetClass', 'isin', 'wkn', 'yahooSymbol', 'searchAliases', 'listing',
]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function normalizeUserAsset(value: unknown, strict: boolean): LocalUserAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const asset = value as Record<string, unknown>;
  if (strict && Object.keys(asset).some((key) => !ASSET_FIELDS.has(key))) return null;
  const symbol = typeof asset.symbol === 'string' ? asset.symbol.trim().toUpperCase() : '';
  const name = typeof asset.name === 'string' ? asset.name.trim() : '';
  if (typeof asset.symbol !== 'string' || !/^[\x20-\x7e]*$/.test(asset.symbol)
    || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)
    || !name || typeof asset.name !== 'string' || asset.name.length > 256 || CONTROL.test(name)
    || !['crypto', 'stock', 'etf', 'metal'].includes(String(asset.assetClass))) return null;

  const normalized: LocalUserAsset = {
    symbol, name, assetClass: asset.assetClass as LocalUserAssetClass,
  };
  for (const field of ['isin', 'wkn', 'yahooSymbol'] as const) {
    const entry = asset[field];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 64 || CONTROL.test(entry)) {
      if (strict) return null;
      continue;
    }
    normalized[field] = entry.trim();
  }
  if (asset.searchAliases !== undefined) {
    if (!Array.isArray(asset.searchAliases) || asset.searchAliases.length > 32
      || asset.searchAliases.some((entry) => typeof entry !== 'string'
        || !entry.trim() || entry.length > 64 || CONTROL.test(entry))) {
      if (strict) return null;
    } else {
      normalized.searchAliases = [...new Set(asset.searchAliases.map((entry: string) => entry.trim()))];
    }
  }
  if (asset.listing !== undefined) {
    const listing = normalizePersonalListingIdentity(asset.listing);
    if (!listing || listing.symbol !== symbol || listing.assetClass !== normalized.assetClass
      || (normalized.yahooSymbol !== undefined
        && normalized.yahooSymbol.toUpperCase() !== listing.providerSymbol)) {
      if (strict) return null;
    } else {
      normalized.listing = listing;
    }
  }
  return normalized;
}

export function readUserAssets(): LocalUserAsset[] {
  try {
    const raw = readWorkspaceStorageItem(USER_ASSETS_STORAGE_KEY);
    if (!raw || raw.length > MAX_USER_ASSETS_BYTES) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length > MAX_USER_ASSETS) return [];
    const symbols = new Set<string>();
    return parsed.flatMap((entry) => {
      const asset = normalizeUserAsset(entry, false);
      if (!asset || symbols.has(asset.symbol)) return [];
      symbols.add(asset.symbol);
      return [asset];
    });
  } catch {
    return [];
  }
}

export function writeUserAssets(assets: LocalUserAsset[]): boolean {
  if (!Array.isArray(assets) || assets.length > MAX_USER_ASSETS) {
    throw new Error('User assets are invalid.');
  }
  const symbols = new Set<string>();
  const normalized = assets.map((entry) => {
    const asset = normalizeUserAsset(entry, true);
    if (!asset || symbols.has(asset.symbol)) {
      throw new Error('User asset contains invalid or duplicate data.');
    }
    symbols.add(asset.symbol);
    return asset;
  });
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_USER_ASSETS_BYTES) throw new Error('User assets are too large.');
  const written = writeWorkspaceStorageItem(USER_ASSETS_STORAGE_KEY, serialized);
  if (written && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(USER_ASSETS_CHANGE_EVENT));
  }
  return written;
}

export function readHiddenAssets(): string[] {
  try {
    const raw = readWorkspaceStorageItem(HIDDEN_ASSETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((symbol): symbol is string => typeof symbol === 'string'))]
      : [];
  } catch {
    return [];
  }
}

export function writeHiddenAssets(symbols: string[]): void {
  writeWorkspaceStorageItem(
    HIDDEN_ASSETS_STORAGE_KEY,
    JSON.stringify([...new Set(symbols)]),
  );
}
