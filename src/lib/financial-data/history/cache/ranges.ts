import type { HistoryCacheRecord, HistoryRange } from './types';
import {
  closedUtcDay, dateDay, dayDate, historyKeyId, MAX_HISTORY_BARS,
  normalizeHistoryRange, normalizeHistoryRecord,
} from './validation';

function mergeRanges(ranges: HistoryRange[]): HistoryRange[] {
  const sorted = ranges.map(range => ({ ...range })).sort((a, b) => a.from.localeCompare(b.from));
  const merged: HistoryRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && dateDay(range.from)! <= dateDay(previous.to)! + 1) {
      if (range.to > previous.to) previous.to = range.to;
    } else merged.push(range);
  }
  return merged;
}

export function planHistoryRanges(record: HistoryCacheRecord | null, requested: HistoryRange, now: number): HistoryRange[] {
  const range = normalizeHistoryRange(requested);
  if (!range) throw new Error('Invalid requested history range');
  const lastClosed = closedUtcDay(now);
  const first = dateDay(range.from)!;
  const last = Math.min(dateDay(range.to)!, lastClosed);
  if (first > last) return [];
  const normalized = record === null ? null : normalizeHistoryRecord(record, now);
  const missing: HistoryRange[] = [];
  let next = first;
  for (const covered of mergeRanges(normalized?.coverage ?? [])) {
    const from = dateDay(covered.from)!;
    const to = dateDay(covered.to)!;
    if (to < next || from > last) continue;
    if (from > next) missing.push({ from: dayDate(next), to: dayDate(Math.min(last, from - 1)) });
    next = Math.max(next, to + 1);
    if (next > last) break;
  }
  if (next <= last) missing.push({ from: dayDate(next), to: dayDate(last) });
  if (normalized && now - normalized.lastCheckedAt > 6 * 3_600_000 && last >= lastClosed - 6) {
    missing.push({ from: dayDate(Math.max(first, last - 6)), to: dayDate(last) });
  }
  return mergeRanges(missing);
}

export function mergeHistoryRecord(record: HistoryCacheRecord | null, incoming: HistoryCacheRecord, checkedRange: HistoryRange, now: number): HistoryCacheRecord {
  const previous = record === null ? null : normalizeHistoryRecord(record, now);
  const next = normalizeHistoryRecord(incoming, now);
  const checked = normalizeHistoryRange(checkedRange);
  if ((record !== null && !previous) || !next || !checked || dateDay(checked.to)! > closedUtcDay(now)) {
    throw new Error('Invalid history cache record');
  }
  if (previous && historyKeyId(previous.key) !== historyKeyId(next.key)) {
    throw new Error('Incompatible history identities');
  }
  const bars = new Map((previous?.bars ?? []).map(bar => [bar.date, bar]));
  for (const bar of next.bars) bars.set(bar.date, bar);
  if (bars.size > MAX_HISTORY_BARS) throw new Error('History bar limit exceeded');
  const merged: HistoryCacheRecord = {
    key: next.key,
    bars: [...bars.values()].sort((a, b) => a.date.localeCompare(b.date)),
    // A provider's short reply proves only the explicitly checked window.
    coverage: mergeRanges([...(previous?.coverage ?? []), checked]),
    retrievedAt: Math.max(previous?.retrievedAt ?? 0, next.retrievedAt),
    lastCheckedAt: now,
  };
  if (!normalizeHistoryRecord(merged, now)) throw new Error('History coverage limit exceeded');
  return merged;
}
