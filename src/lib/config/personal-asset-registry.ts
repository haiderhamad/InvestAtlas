'use client';

import { getAssetConfig, getSupportedAssetsByClass, type AssetClass, type AssetConfig } from './supported-assets';
import { normalizePersonalListingIdentity, type PersonalListingIdentity } from './personal-instrument';
import { readUserAssets, writeUserAssets, type LocalUserAsset } from './user-assets-store';

export { USER_ASSETS_CHANGE_EVENT } from './user-assets-store';

function personalConfig(asset: LocalUserAsset): AssetConfig | undefined {
  const listing = asset.listing;
  if (!listing) return undefined;
  return {
    symbol: asset.symbol, name: asset.name, assetClass: listing.assetClass,
    nativeCurrency: listing.nativeCurrency, yahooSymbol: listing.providerSymbol,
    taxRegime: 'capital_income', compliance: { status: 'Blocked: Insufficient Evidence' },
    ...(asset.isin ? { isin: asset.isin } : {}),
    ...(asset.wkn ? { wkn: asset.wkn } : {}),
    ...(asset.searchAliases ? { searchAliases: [...asset.searchAliases] } : {}),
  };
}

export function getPersonalAssetConfig(symbol: string): AssetConfig | undefined {
  const catalogAsset = getAssetConfig(symbol);
  if (catalogAsset) return catalogAsset;
  const normalized = symbol.trim().toUpperCase();
  const asset = readUserAssets().find((entry) => entry.symbol === normalized);
  return asset ? personalConfig(asset) : undefined;
}

export function getPersonalAssetsByClass(assetClass: AssetClass): AssetConfig[] {
  const catalog = getSupportedAssetsByClass(assetClass);
  const symbols = new Set(catalog.map((asset) => asset.symbol));
  const personal = readUserAssets().flatMap((asset) => {
    if (asset.assetClass !== assetClass || symbols.has(asset.symbol)) return [];
    const config = personalConfig(asset);
    if (!config) return [];
    symbols.add(config.symbol);
    return [config];
  });
  return [...catalog, ...personal];
}

export function getPersonalListingIdentity(symbol: string): PersonalListingIdentity | undefined {
  const normalized = symbol.trim().toUpperCase();
  return readUserAssets().find((asset) => asset.symbol === normalized)?.listing;
}

/** Caller resolves the listing first; every later provider still checks actual metadata. */
export function saveResolvedPersonalListing(identity: PersonalListingIdentity): boolean {
  const listing = normalizePersonalListingIdentity(identity);
  if (!listing) return false;
  const assets = readUserAssets();
  const existing = assets.find((asset) => asset.symbol === listing.symbol);
  if (existing && (existing.assetClass !== listing.assetClass
    || (existing.yahooSymbol !== undefined && existing.yahooSymbol.toUpperCase() !== listing.providerSymbol)
    || (existing.listing !== undefined && (
      existing.listing.providerSymbol !== listing.providerSymbol
      || existing.listing.nativeCurrency !== listing.nativeCurrency
      || existing.listing.exchange !== listing.exchange
    )))) return false;

  const next: LocalUserAsset = {
    ...existing, symbol: listing.symbol, name: listing.name, assetClass: listing.assetClass, listing,
  };
  try {
    return writeUserAssets(existing
      ? assets.map((asset) => asset.symbol === listing.symbol ? next : asset)
      : [...assets, next]);
  } catch {
    return false;
  }
}
