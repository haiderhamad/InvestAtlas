import type { AssetClass } from '@/lib/config/supported-assets';
import type { HistoryInterval } from '@/lib/data/history-request';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_INTRADAY_CLOCK_SKEW_MS = 5 * MINUTE_MS;

const INTRADAY_MAX_AGE_MS: Record<Exclude<HistoryInterval, '1d'>, number> = {
  '1m': 15 * MINUTE_MS,
  '5m': 30 * MINUTE_MS,
  '15m': 90 * MINUTE_MS,
  '1h': 4 * 60 * MINUTE_MS,
  '4h': 12 * 60 * MINUTE_MS,
};

type DatedObservation = {
  date?: unknown;
};

export interface HistoryRecency {
  freshness: 'fresh' | 'stale';
  latestObservationAt: string | null;
  maxAgeMs: number;
}

function observationTimestamp(value: unknown, interval: HistoryInterval): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  // Daily observations represent a whole UTC date. Compare from the end of
  // that date so an ordinary prior-session close is not aged from midnight.
  return interval === '1d' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? timestamp + DAY_MS
    : timestamp;
}

export function evaluateHistoryRecency(
  observations: DatedObservation[],
  interval: HistoryInterval,
  assetClass: AssetClass,
  now = Date.now(),
): HistoryRecency {
  const maxAgeMs = interval === '1d'
    ? assetClass === 'crypto' ? 3 * DAY_MS : 7 * DAY_MS
    : INTRADAY_MAX_AGE_MS[interval];
  const latestTimestamp = observations.reduce<number | null>((latest, observation) => {
    const timestamp = observationTimestamp(observation.date, interval);
    if (timestamp === null) return latest;
    return latest === null || timestamp > latest ? timestamp : latest;
  }, null);

  if (latestTimestamp === null) {
    return {
      freshness: 'stale',
      latestObservationAt: null,
      maxAgeMs,
    };
  }

  const ageMs = now - latestTimestamp;
  const maxFutureSkewMs = interval === '1d'
    ? DAY_MS
    : MAX_INTRADAY_CLOCK_SKEW_MS;

  return {
    freshness:
      ageMs >= -maxFutureSkewMs && ageMs <= maxAgeMs
        ? 'fresh'
        : 'stale',
    latestObservationAt: new Date(latestTimestamp).toISOString(),
    maxAgeMs,
  };
}
