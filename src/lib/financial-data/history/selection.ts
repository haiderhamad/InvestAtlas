import { normalizePersonalHistoryRange } from '@/lib/financial-data/history/request';
import { isHistoryCurrent } from '@/lib/financial-data/history/trust';
import { spotPricePerGram } from '@/lib/metals/metal-purity';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRADE_REFERENCE_LOOKBACK_MS = 7 * DAY_MS;

type HistoricalCloseCandidate = {
  date?: unknown;
  close?: unknown;
};

export type HistoricalClose = {
  date: string;
  close: number;
};

function parseIsoDateOnly(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

/**
 * Selects a trustworthy transaction-price observation without looking ahead.
 * A seven-day window covers weekends and ordinary market holidays while
 * refusing to label an arbitrarily old close as the requested date's spot.
 */
export function findRecentHistoricalClose(
  points: HistoricalCloseCandidate[],
  targetDate: string,
  maxLookbackDays = 7,
): HistoricalClose | null {
  const targetTimestamp = parseIsoDateOnly(targetDate);
  if (
    targetTimestamp === null
    || !Number.isInteger(maxLookbackDays)
    || maxLookbackDays < 0
  ) {
    return null;
  }

  let selected: HistoricalClose | null = null;
  let selectedTimestamp = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const pointTimestamp = parseIsoDateOnly(point.date);
    const close = point.close;
    if (
      pointTimestamp === null
      || pointTimestamp > targetTimestamp
      || targetTimestamp - pointTimestamp > maxLookbackDays * DAY_MS
      || typeof close !== 'number'
      || !Number.isFinite(close)
      || close <= 0
      || pointTimestamp <= selectedTimestamp
    ) {
      continue;
    }

    selectedTimestamp = pointTimestamp;
    selected = { date: point.date as string, close };
  }

  return selected;
}

/** The personal browser history route accepts only its bounded completed window. */
export function tradeReferenceHistoryRange(
  tradeDay: string,
  now = Date.now(),
): { from: string; to: string } | null {
  const day = parseIsoDateOnly(tradeDay);
  if (day === null || !Number.isFinite(now)) return null;
  const supported = normalizePersonalHistoryRange({ range: '5y' }, now);
  if (!supported) return null;

  const from = Math.max(day - TRADE_REFERENCE_LOOKBACK_MS, Date.parse(supported.from));
  const to = Math.min(day - DAY_MS, Date.parse(supported.to));
  return from <= to
    ? { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10) }
    : null;
}

type TradeReferenceParams = {
  symbol: string;
  currency: 'eur' | 'usd';
  tradeDay: string;
  executionCutoff: number;
  fineness?: number;
};

type TradeReference = { date: string; price: number; source: string };
type HistorySource = { kind: 'market' | 'fx'; providerId: string; providerName: string };

function historyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function indexHistorySources(entries: unknown[]): Map<string, HistorySource | null> {
  const sources = new Map<string, HistorySource | null>();
  for (const value of entries) {
    const source = historyRecord(value);
    if (!source || typeof source.ref !== 'string' || !source.ref.trim()) continue;
    const { ref, kind } = source;
    const providerId = typeof source.providerId === 'string' ? source.providerId.trim() : '';
    const providerName = typeof source.providerName === 'string' ? source.providerName.trim() : '';
    const valid = !sources.has(ref) && (kind === 'market' || kind === 'fx')
      && providerId && providerId !== 'unknown_provider'
      && providerName && providerName.toLowerCase() !== 'unknown provider';
    sources.set(ref, valid ? { kind, providerId, providerName } : null);
  }
  return sources;
}

function hasVerifiedTradeReferenceConversion(
  value: unknown,
  sources: Map<string, HistorySource | null>,
  day: number,
  currency: TradeReferenceParams['currency'],
): boolean {
  const conversion = historyRecord(value);
  if (!conversion || typeof conversion.sourceRef !== 'string') return false;
  const source = sources.get(conversion.sourceRef);
  const asOf = parseIsoDateOnly(conversion.asOf);
  return source?.kind === 'fx' && source.providerId === 'ecb_reference_rates'
    && conversion.sourceCurrency === (currency === 'eur' ? 'USD' : 'EUR')
    && typeof conversion.rate === 'number' && Number.isFinite(conversion.rate) && conversion.rate > 0
    && asOf !== null && asOf <= day && day - asOf <= 7 * DAY_MS;
}

/** Selects a completed, sourced daily observation for optional copying into a trade. */
export function readTradeReference(payload: unknown, params: TradeReferenceParams): TradeReference | null {
  const history = historyRecord(payload);
  const day = parseIsoDateOnly(params.tradeDay);
  if (day === null || !Number.isFinite(params.executionCutoff)
    || !history || !isHistoryCurrent(history) || history.synthetic === true || history.dataMode === 'demo_snapshot'
    || history.symbol !== params.symbol || history.currency !== params.currency
    || !Array.isArray(history.sources) || !Array.isArray(history.prices)) return null;

  const metal = params.symbol === 'GOLD' || params.symbol === 'SILVER';
  const fineness = metal ? params.fineness : undefined;
  if (metal && (fineness === undefined || !Number.isFinite(fineness) || fineness <= 0 || fineness > 1000)) return null;

  const sources = indexHistorySources(history.sources);
  const earliest = day - TRADE_REFERENCE_LOOKBACK_MS;
  let latest: TradeReference | null = null;

  for (const value of history.prices) {
    const row = historyRecord(value);
    if (!row || typeof row.date !== 'string' || typeof row.sourceRef !== 'string'
      || typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0
      || (latest && row.date <= latest.date)) continue;
    const observedDay = parseIsoDateOnly(row.date);
    if (observedDay === null || observedDay < earliest || observedDay >= day
      || observedDay + DAY_MS > params.executionCutoff) continue;

    const source = sources.get(row.sourceRef);
    if (source?.kind !== 'market' || source.providerId === 'twelve_demo_daily'
      || metal !== (source.providerId === 'standard_bullion_daily')) continue;
    const converted = row.priceQuality === 'calculated' || row.conversion !== undefined;
    // Standard Bullion is natively quoted in USD per fine troy ounce.
    if ((metal && converted !== (params.currency === 'eur'))
      || (converted && !hasVerifiedTradeReferenceConversion(row.conversion, sources, observedDay, params.currency))) continue;

    const price = fineness === undefined ? row.close : spotPricePerGram(row.close, fineness);
    if (!Number.isFinite(price) || price <= 0) continue;
    latest = { date: row.date, price, source: source.providerName };
  }

  return latest;
}
