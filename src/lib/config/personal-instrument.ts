import { getAssetConfig } from './supported-assets';

/** Portable listing metadata is a request hint; providers must revalidate it. */
export interface PersonalListingIdentity {
  version: 1;
  symbol: string;
  providerSymbol: string;
  name: string;
  assetClass: 'stock' | 'etf';
  nativeCurrency: 'eur' | 'usd';
  exchange: string;
  source: 'yahoo_chart';
  resolvedAt: string;
}

const FIELDS = new Set([
  'version', 'symbol', 'providerSymbol', 'name', 'assetClass',
  'nativeCurrency', 'exchange', 'source', 'resolvedAt',
]);
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const EXCHANGE = /^[A-Z0-9][A-Z0-9 ._-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function normalizedIdentifier(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum + 2 || !/^[\x20-\x7e]*$/.test(value)) return null;
  return value.trim().toUpperCase();
}

function normalizeResolutionDate(value: unknown): string | null {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  // Date.parse rolls invalid calendar dates forward instead of rejecting them.
  const canonicalInput = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) =>
    `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return normalized === canonicalInput ? normalized : null;
}

export function normalizePersonalListingIdentity(value: unknown): PersonalListingIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== FIELDS.size
    || Object.keys(record).some((key) => !FIELDS.has(key))) return null;

  const symbol = normalizedIdentifier(record.symbol, 32);
  const providerSymbol = normalizedIdentifier(record.providerSymbol, 32);
  const exchange = normalizedIdentifier(record.exchange, 64);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const resolvedAt = normalizeResolutionDate(record.resolvedAt);
  if (record.version !== 1 || record.source !== 'yahoo_chart'
    || !symbol || !SYMBOL.test(symbol) || !providerSymbol || !SYMBOL.test(providerSymbol)
    || !exchange || !EXCHANGE.test(exchange)
    || typeof record.name !== 'string' || record.name.length > 256
    || !name || CONTROL.test(name) || !resolvedAt
    || (record.assetClass !== 'stock' && record.assetClass !== 'etf')
    || (record.nativeCurrency !== 'eur' && record.nativeCurrency !== 'usd')) return null;

  const catalogAsset = getAssetConfig(symbol);
  if (catalogAsset) {
    if (catalogAsset.assetClass !== record.assetClass
      || catalogAsset.nativeCurrency !== record.nativeCurrency
      || catalogAsset.yahooSymbol !== providerSymbol) return null;
  } else if (symbol !== providerSymbol) {
    return null;
  }

  return {
    version: 1, symbol, providerSymbol, name,
    assetClass: record.assetClass, nativeCurrency: record.nativeCurrency,
    exchange, source: 'yahoo_chart', resolvedAt,
  };
}
