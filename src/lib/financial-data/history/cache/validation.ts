import type { DailyHistoryBar, HistoryCacheKey, HistoryCacheRecord, HistoryRange } from './types';

export const DAY_MS = 86_400_000;
export const MAX_HISTORY_BARS = 5_000;
export const MAX_HISTORY_RECORDS = 128;
const MAX_COVERAGE_RANGES = 128;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function isHistoryIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function isHistoryInstallation(value: unknown): value is string {
  if (isHistoryIdentifier(value)) return true;
  if (typeof value !== 'string' || value.length > 512) return false;
  const parts = /^(.+):(legacy|local_personal|private_cloud|public_demo)(?::[A-Za-z0-9_-]{1,128})?$/.exec(value);
  if (!parts) return false;
  try {
    const url = new URL(parts[1]);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === parts[1];
  } catch { return false; }
}

export function dateDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    ? time / DAY_MS : null;
}

export function dayDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function closedUtcDay(now: number): number {
  if (!Number.isSafeInteger(now) || now < DAY_MS || now > 253_402_300_799_999) {
    throw new Error('Invalid history clock');
  }
  return Math.floor(now / DAY_MS) - 1;
}

export function normalizeHistoryRange(value: unknown): HistoryRange | null {
  const range = object(value);
  if (!range) return null;
  const from = dateDay(range.from);
  const to = dateDay(range.to);
  return from !== null && to !== null && from <= to
    ? { from: range.from as string, to: range.to as string } : null;
}

export function normalizeHistoryKey(value: unknown): HistoryCacheKey | null {
  const key = object(value);
  if (!key || !isHistoryInstallation(key.installation)
    || typeof key.exchange !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:@-]{0,159}$/.test(key.exchange)
    || !['owner', 'instrument', 'providerId', 'adjustment']
    .every(field => isHistoryIdentifier(key[field]))
    || (key.currency !== 'USD' && key.currency !== 'EUR') || key.interval !== '1d' || key.version !== 1) {
    return null;
  }
  return {
    installation: key.installation as string, owner: key.owner as string,
    instrument: key.instrument as string, exchange: key.exchange as string,
    providerId: key.providerId as string, currency: key.currency,
    interval: '1d', adjustment: key.adjustment as string, version: 1,
  };
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeBar(value: unknown, lastClosedDay: number): DailyHistoryBar | null {
  const bar = object(value);
  if (!bar) return null;
  const day = dateDay(bar.date);
  if (day === null || day > lastClosedDay || !positive(bar.open) || !positive(bar.high)
    || !positive(bar.low) || !positive(bar.close) || bar.high < Math.max(bar.open, bar.close, bar.low)
    || bar.low > Math.min(bar.open, bar.close)
    || (bar.volume !== null && (typeof bar.volume !== 'number' || !Number.isFinite(bar.volume) || bar.volume < 0))
    || (bar.adjustedClose !== undefined && !positive(bar.adjustedClose))) return null;
  return {
    date: bar.date as string, open: bar.open, high: bar.high, low: bar.low,
    close: bar.close, volume: bar.volume as number | null,
    ...(bar.adjustedClose === undefined ? {} : { adjustedClose: bar.adjustedClose as number }),
  };
}

/** Whitelist fields before returning or serializing; extra provider metadata never enters storage. */
export function normalizeHistoryRecord(value: unknown, now: number): HistoryCacheRecord | null {
  const record = object(value);
  if (!record) return null;
  const key = normalizeHistoryKey(record.key);
  if (!key || !Array.isArray(record.bars) || record.bars.length > MAX_HISTORY_BARS
    || !Array.isArray(record.coverage) || record.coverage.length > MAX_COVERAGE_RANGES
    || ![record.retrievedAt, record.lastCheckedAt].every(value =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= now)) return null;
  const lastClosedDay = closedUtcDay(now);
  const bars: DailyHistoryBar[] = [];
  for (const value of record.bars) {
    const bar = normalizeBar(value, lastClosedDay);
    if (!bar || (bars.length > 0 && bars[bars.length - 1].date >= bar.date)) return null;
    bars.push(bar);
  }
  const coverage: HistoryRange[] = [];
  for (const value of record.coverage) {
    const range = normalizeHistoryRange(value);
    if (!range || dateDay(range.to)! > lastClosedDay) return null;
    coverage.push(range);
  }
  return {
    key, bars, coverage, retrievedAt: record.retrievedAt as number,
    lastCheckedAt: record.lastCheckedAt as number,
  };
}

export function historyKeyId(key: HistoryCacheKey): string {
  return JSON.stringify([
    key.installation, key.owner, key.instrument, key.exchange, key.providerId,
    key.currency, key.interval, key.adjustment, key.version,
  ]);
}

export function historyOwnerId(installation: string, owner: string): string {
  if (!isHistoryInstallation(installation) || !isHistoryIdentifier(owner)) throw new Error('Invalid history owner');
  return JSON.stringify([installation, owner]);
}
