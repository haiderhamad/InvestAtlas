const DAY_MS = 24 * 60 * 60 * 1000;

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
