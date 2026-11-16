export type HistoryTrustState = 'stale' | 'partial' | 'unavailable';

type HistoricalResponseTrustMetadata = {
  status?: unknown;
  freshness?: unknown;
  adjustment?: unknown;
  cache?: {
    status?: unknown;
  };
};

export function getHistoryTrustState(value: unknown): HistoryTrustState | null {
  if (!value || typeof value !== 'object') {
    return 'unavailable';
  }

  const payload = value as HistoricalResponseTrustMetadata;

  if (
    payload.cache?.status === 'hit_stale'
    || payload.freshness === 'stale'
  ) {
    return 'stale';
  }

  if (payload.status === 'partial') {
    return 'partial';
  }

  if (payload.status === 'unavailable') {
    return 'unavailable';
  }

  return payload.status === 'complete' ? null : 'unavailable';
}

export function isHistoryUsableForAi(value: unknown): boolean {
  if (!isHistoryCurrent(value) || !value || typeof value !== 'object') {
    return false;
  }

  // Raw, unadjusted series are acceptable for an explicitly labelled chart,
  // but must not become an apparently authoritative input to AI analysis.
  // Splits and dividends can materially distort the derived indicators.
  return (value as HistoricalResponseTrustMetadata).adjustment !== 'raw_unadjusted';
}

/**
 * Historical portfolio returns and backtests require adjusted observations.
 * An unadjusted series can show a split as an apparent gain or loss.
 */
export function isHistoryUsableForDerivedPerformance(value: unknown): boolean {
  return isHistoryCurrent(value)
    && Boolean(value)
    && typeof value === 'object'
    && (value as HistoricalResponseTrustMetadata).adjustment !== 'raw_unadjusted';
}

/**
 * Partial coverage can still contain valid current observations (for example
 * a young asset or a close-only provider). Stale fallbacks and unavailable
 * payloads must never flow into calculations as if they were current.
 */
export function isHistoryCurrent(value: unknown): boolean {
  const state = getHistoryTrustState(value);
  return state === null || state === 'partial';
}
