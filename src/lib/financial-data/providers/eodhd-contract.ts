import { getAssetConfig } from '@/lib/config/supported-assets';

/** Listing metadata is a hint until the EODHD search endpoint verifies it. */
export interface EodhdInstrument {
  symbol: string;
  providerSymbol: string;
  assetClass: 'stock' | 'etf';
  nativeCurrency: 'eur' | 'usd';
  exchange: string;
}
export interface EodhdHistoryRange { from: string; to: string }
export interface EodhdMapping {
  instrument: EodhdInstrument;
  providerSymbol: string;
  exchange: string;
  listingCurrency: 'EUR' | 'USD';
}
export interface EodhdCoverage {
  requested: EodhdHistoryRange;
  checked: EodhdHistoryRange;
  available: EodhdHistoryRange | null;
  historyYears: 1 | 5;
  limited: boolean;
}
export interface EodhdDailySeries {
  providerId: 'eodhd_personal_daily';
  assetSymbol: string;
  providerSymbol: string;
  listingCurrency: 'EUR' | 'USD';
  exchange: string;
  retrievedAt: string;
  latestObservationAt: string | null;
  cacheStatus: 'miss';
  adjustment: 'raw_unadjusted';
  /** EODHD volume is split adjusted even when OHLC remain raw. */
  volumeAdjustment: 'splits';
  bars: Array<{
    date: string; open: number; high: number; low: number; close: number;
    volume: number | null; adjustedClose?: number;
  }>;
  coverage: EodhdCoverage;
}
export const EODHD_MAX_BYTES = 2 * 1024 * 1024;
export const EODHD_MAX_BARS = 2000;
export const EODHD_US_EXCHANGES = ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX'] as const;
const TICKER = /^[A-Z][A-Z0-9.-]{0,31}$/;
const STATIC_US_EXCHANGES: Readonly<Record<string, string>> = {
  AAPL: 'NMS', MSFT: 'NMS', NVDA: 'NMS', AMZN: 'NMS', GOOGL: 'NMS', META: 'NMS', TSLA: 'NMS',
  HLAL: 'NMS', UMMA: 'NMS', SPUS: 'PCX', SPWO: 'PCX', SPTE: 'PCX', SPRE: 'PCX',
};

export function normalizeEodhdInstrument(input: unknown): EodhdInstrument {
  let value = input;
  if (typeof input === 'string') {
    const asset = getAssetConfig(input);
    const ticker = asset?.yahooSymbol;
    if (!asset || asset.symbol !== input || !ticker) throw new Error('Unsupported EODHD instrument');
    const exchange = ticker.endsWith('.DE') ? 'GER' : ticker.endsWith('.AS') ? 'AMS'
      : ticker.endsWith('.L') ? 'LSE' : STATIC_US_EXCHANGES[input];
    value = { symbol: asset.symbol, providerSymbol: ticker, assetClass: asset.assetClass,
      nativeCurrency: asset.nativeCurrency, exchange };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid EODHD instrument');
  const row = value as Record<string, unknown>;
  const allowed = ['symbol', 'providerSymbol', 'assetClass', 'nativeCurrency', 'exchange', 'version', 'name', 'source', 'resolvedAt'];
  if (Object.keys(row).some(key => !allowed.includes(key))
    || typeof row.symbol !== 'string' || !TICKER.test(row.symbol)
    || typeof row.providerSymbol !== 'string' || !TICKER.test(row.providerSymbol)
    || (row.assetClass !== 'stock' && row.assetClass !== 'etf')
    || (row.nativeCurrency !== 'eur' && row.nativeCurrency !== 'usd')
    || typeof row.exchange !== 'string' || !/^[A-Z][A-Z0-9]{1,11}$/.test(row.exchange)) {
    throw new Error('Invalid EODHD instrument');
  }
  // A catalogue alias cannot be repointed to another listing by request data.
  const configured = getAssetConfig(row.symbol);
  if (configured && (configured.yahooSymbol !== row.providerSymbol
    || configured.assetClass !== row.assetClass || configured.nativeCurrency !== row.nativeCurrency)) {
    throw new Error('EODHD catalogue listing mismatch');
  }
  if (!configured && row.symbol !== row.providerSymbol) throw new Error('EODHD personal listing mismatch');
  return { symbol: row.symbol, providerSymbol: row.providerSymbol, assetClass: row.assetClass,
    nativeCurrency: row.nativeCurrency, exchange: row.exchange };
}

/** A strict cross-provider counterpart, never a name/ISIN/currency-only guess. */
export function getEodhdTarget(input: unknown): EodhdMapping {
  const instrument = normalizeEodhdInstrument(input);
  const { providerSymbol, exchange, nativeCurrency } = instrument;
  let code: string;
  let venue: string;
  if ((EODHD_US_EXCHANGES as readonly string[]).includes(exchange)
    && nativeCurrency === 'usd' && !providerSymbol.includes('.')) {
    code = providerSymbol; venue = 'US';
  } else if (exchange === 'GER' && providerSymbol.endsWith('.DE') && nativeCurrency === 'eur') {
    code = providerSymbol.slice(0, -3); venue = 'XETRA';
  } else if (exchange === 'AMS' && providerSymbol.endsWith('.AS') && nativeCurrency === 'eur') {
    code = providerSymbol.slice(0, -3); venue = 'AS';
  } else if (exchange === 'LSE' && providerSymbol.endsWith('.L') && nativeCurrency === 'usd') {
    code = providerSymbol.slice(0, -2); venue = 'LSE';
  } else {
    throw new Error('Unsupported exact EODHD venue/currency counterpart');
  }
  if (!/^[A-Z][A-Z0-9-]{0,23}$/.test(code)) throw new Error('Unsupported EODHD ticker');
  return { instrument, providerSymbol: code + '.' + venue, exchange,
    listingCurrency: nativeCurrency === 'eur' ? 'EUR' : 'USD' };
}

export function validEodhdDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

export function eodhdYearCutoff(now: number, years: 1 | 5): string {
  const date = new Date(now);
  const year = date.getUTCFullYear() - years;
  const month = date.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last))).toISOString().slice(0, 10);
}

export function boundEodhdRange(
  input: unknown, historyYears: 1 | 5, now = Date.now(),
): { requested: EodhdHistoryRange; checked: EodhdHistoryRange; historyYears: 1 | 5 } {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (historyYears !== 1 && historyYears !== 5)) {
    throw new Error('Invalid EODHD history range');
  }
  const row = input as Record<string, unknown>;
  const today = new Date(now).toISOString().slice(0, 10);
  if (Object.keys(row).length !== 2 || !validEodhdDate(row.from) || !validEodhdDate(row.to)
    || row.from > row.to || row.to > today || row.from < eodhdYearCutoff(now - 86_400_000, 5)) {
    throw new Error('EODHD requests must fit the supported five-year window');
  }
  const yesterday = new Date(Math.floor(now / 86_400_000) * 86_400_000 - 86_400_000).toISOString().slice(0, 10);
  const from = row.from < eodhdYearCutoff(now, historyYears) ? eodhdYearCutoff(now, historyYears) : row.from;
  const to = row.to > yesterday ? yesterday : row.to;
  if (from > to) throw new Error('Requested history is outside the configured EODHD entitlement depth');
  return {
    requested: { from: row.from, to: row.to },
    checked: { from, to }, historyYears,
  };
}

export function validateEodhdKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{16,2048}$/.test(value.trim())) {
    throw new Error('Invalid personal EODHD key');
  }
  return value.trim();
}
