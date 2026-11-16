export type ChartRange = '1h' | '1D' | '7D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'All';

export const RANGE_LOOKBACK_MS: Record<Exclude<ChartRange, 'All'>, number> = {
  '1h': 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  '6M': 180 * 24 * 60 * 60 * 1000,
  '1Y': 365 * 24 * 60 * 60 * 1000,
  '3Y': 3 * 365 * 24 * 60 * 60 * 1000,
  '5Y': 5 * 365 * 24 * 60 * 60 * 1000,
};

export function parseChartDate(date: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date);
}

/** Draft edits may be incomplete; calculation state must remain a bounded integer. */
export function parseSmaPeriod(draft: string): number | null {
  if (!draft.trim()) return null;
  const period = Number(draft);
  return Number.isInteger(period) && period >= 2 && period <= 400 ? period : null;
}

export function latestIndicator(values: readonly (number | null)[]): number | null {
  const value = values[values.length - 1];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function trendDeltaPercent(price: number, average: number | null): number | null {
  return average !== null && average > 0 && Number.isFinite(price)
    ? ((price - average) / average) * 100
    : null;
}

export function getChartPanBounds(history: readonly { date: string }[], range: ChartRange) {
  const maxEnd = history.length ? parseChartDate(history[history.length - 1].date).getTime() : 0;
  const first = history.length ? parseChartDate(history[0].date).getTime() : maxEnd;
  const minEnd = range === 'All' ? maxEnd : Math.min(first + RANGE_LOOKBACK_MS[range], maxEnd);
  return { minEnd, maxEnd };
}

export function clampChartEnd(end: number, bounds: { minEnd: number; maxEnd: number }): number {
  return Math.min(Math.max(end, bounds.minEnd), bounds.maxEnd);
}

export function sliceChartWindow<T extends { date: string }>(history: readonly T[], range: ChartRange, endMs: number | null): T[] {
  if (range === 'All') return [...history];
  const end = endMs ?? (history.length ? parseChartDate(history[history.length - 1].date).getTime() : 0);
  const cutoff = end - RANGE_LOOKBACK_MS[range];
  return history.filter((point) => {
    const ms = parseChartDate(point.date).getTime();
    return ms >= cutoff && ms <= end;
  });
}

export function formatAssetAxisDate(date: string, range: ChartRange, interval: string, locale: string): string {
  const parsed = parseChartDate(date);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    calendar: 'gregory',
    ...(interval !== '1d'
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } as const
      : range === '3Y' || range === '5Y' || range === 'All'
        ? { month: 'short', year: '2-digit' } as const
        : { month: 'short', day: 'numeric' } as const),
  }).format(parsed);
}
