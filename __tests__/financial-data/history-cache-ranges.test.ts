import {
  mergeHistoryRecord,
  planHistoryRanges,
  type DailyHistoryBar,
  type HistoryCacheKey,
  type HistoryCacheRecord,
} from '@/lib/financial-data/history/cache';

const now = Date.UTC(2026, 10, 7, 12);
const key: HistoryCacheKey = {
  installation: 'local_personal', owner: 'owner-a', instrument: 'AAPL.US',
  exchange: 'NASDAQ', providerId: 'eodhd_personal_daily', currency: 'USD',
  interval: '1d', adjustment: 'raw_unadjusted', version: 1,
};
const bar = (date: string, close = 12): DailyHistoryBar => ({
  date, open: 10, high: 15, low: 9, close, volume: 100, adjustedClose: close / 2,
});
const record = (overrides: Partial<HistoryCacheRecord> = {}): HistoryCacheRecord => ({
  key, bars: [bar('2026-10-01')], coverage: [{ from: '2026-10-01', to: '2026-11-06' }],
  retrievedAt: now - 3_600_000, lastCheckedAt: now - 3_600_000, ...overrides,
});

describe('checked history range planning', () => {
  it('requests the entire missing window but excludes the open UTC day', () => {
    expect(planHistoryRanges(null, { from: '2026-10-01', to: '2026-11-07' }, now))
      .toEqual([{ from: '2026-10-01', to: '2026-11-06' }]);
  });

  it('requests only gaps in explicitly checked coverage, regardless of bar count', () => {
    expect(planHistoryRanges(record({
      coverage: [{ from: '2026-10-05', to: '2026-10-10' }, { from: '2026-10-15', to: '2026-11-06' }],
    }), { from: '2026-10-01', to: '2026-11-06' }, now)).toEqual([
      { from: '2026-10-01', to: '2026-10-04' },
      { from: '2026-10-11', to: '2026-10-14' },
    ]);
    expect(planHistoryRanges(record({ bars: [] }), { from: '2026-10-01', to: '2026-11-06' }, now))
      .toEqual([]);
  });

  it('refreshes a stale recent seven-day tail and coalesces it with a missing suffix', () => {
    expect(planHistoryRanges(record({
      coverage: [{ from: '2026-10-01', to: '2026-11-03' }], lastCheckedAt: now - 21_600_001,
    }), { from: '2026-10-01', to: '2026-11-06' }, now))
      .toEqual([{ from: '2026-10-31', to: '2026-11-06' }]);
  });

  it('does not repeatedly refresh old history or a fresh tail', () => {
    expect(planHistoryRanges(record({ lastCheckedAt: now - 100_000_000 }),
      { from: '2026-10-01', to: '2026-10-20' }, now)).toEqual([]);
    expect(planHistoryRanges(record({ lastCheckedAt: now - 21_600_000 }),
      { from: '2026-10-01', to: '2026-11-06' }, now)).toEqual([]);
    expect(planHistoryRanges(null, { from: '2026-11-07', to: '2026-11-08' }, now)).toEqual([]);
  });

  it.each([
    { from: '2026-02-30', to: '2026-11-06' },
    { from: '2026-1-01', to: '2026-11-06' },
    { from: '2026-11-06', to: '2026-10-01' },
  ])('rejects invalid calendar ranges: %j', range => {
    expect(() => planHistoryRanges(null, range, now)).toThrow();
  });
});

describe('native daily history merging', () => {
  it('keeps older native bars, replaces overlap, and records checked windows without filling dates', () => {
    const original = record({
      bars: [bar('2025-01-02'), bar('2026-10-01')],
      coverage: [{ from: '2025-01-01', to: '2025-01-05' }],
    });
    const incoming = record({
      bars: [bar('2026-10-01', 13), bar('2026-10-05')],
      coverage: [{ from: '2020-01-01', to: '2026-11-06' }],
      retrievedAt: now - 100,
    });
    const result = mergeHistoryRecord(original, incoming, { from: '2026-10-01', to: '2026-10-05' }, now);
    expect(result.bars).toEqual([bar('2025-01-02'), bar('2026-10-01', 13), bar('2026-10-05')]);
    expect(result.coverage).toEqual([
      { from: '2025-01-01', to: '2025-01-05' }, { from: '2026-10-01', to: '2026-10-05' },
    ]);
    expect(result.retrievedAt).toBe(now - 100);
    expect(result.lastCheckedAt).toBe(now);
    expect(original.bars[1].close).toBe(12);
    result.bars[0].close = 14;
    expect(original.bars[0].close).toBe(12);
  });

  it('merges adjacent checked windows even when no trading bar was returned', () => {
    const result = mergeHistoryRecord(record({ coverage: [{ from: '2026-10-01', to: '2026-10-03' }] }),
      record({ bars: [], coverage: [] }), { from: '2026-10-04', to: '2026-10-05' }, now);
    expect(result.coverage).toEqual([{ from: '2026-10-01', to: '2026-10-05' }]);
    expect(result.bars).toHaveLength(1);
  });

  it.each(['installation', 'owner', 'instrument', 'exchange', 'providerId', 'currency', 'adjustment'] as const)
  ('rejects incompatible %s identities instead of stitching series', field => {
    const incompatible = { ...key, [field]: field === 'currency' ? 'EUR' : 'another-value' };
    expect(() => mergeHistoryRecord(record(), record({ key: incompatible }),
      { from: '2026-10-01', to: '2026-10-02' }, now)).toThrow();
  });

  it.each([
    { bars: [bar('2026-02-30')] },
    { bars: [bar('2026-11-07')] },
    { bars: [bar('2026-10-01'), bar('2026-10-01')] },
    { bars: [bar('2026-10-02'), bar('2026-10-01')] },
    { bars: [{ ...bar('2026-10-01'), close: NaN }] },
    { bars: [{ ...bar('2026-10-01'), open: 0 }] },
    { bars: [{ ...bar('2026-10-01'), high: 11 }] },
    { bars: [{ ...bar('2026-10-01'), volume: -1 }] },
    { bars: [{ ...bar('2026-10-01'), adjustedClose: Infinity }] },
  ])('rejects malformed, duplicate, unsorted, or unclosed bars', ({ bars }) => {
    expect(() => mergeHistoryRecord(null, record({ bars }),
      { from: '2026-10-01', to: '2026-11-06' }, now)).toThrow();
  });

  it('preserves raw OHLC and distinct adjusted close without substituting either', () => {
    const result = mergeHistoryRecord(null, record({ bars: [{ ...bar('2026-10-01'), volume: null }] }),
      { from: '2026-10-01', to: '2026-10-01' }, now);
    expect(result.bars[0]).toEqual({
      date: '2026-10-01', open: 10, high: 15, low: 9, close: 12, volume: null, adjustedClose: 6,
    });
  });
});
