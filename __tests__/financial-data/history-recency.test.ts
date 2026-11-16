import { evaluateHistoryRecency } from '@/lib/financial-data/history/recency';

describe('historical observation recency', () => {
  it('allows the current daily session but rejects implausible future bars', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');

    expect(evaluateHistoryRecency(
      [{ date: '2026-08-01' }],
      '1d',
      'stock',
      now,
    ).freshness).toBe('fresh');
    expect(evaluateHistoryRecency(
      [{ date: '2026-08-10' }],
      '1d',
      'stock',
      now,
    ).freshness).toBe('stale');
  });

  it('rejects an intraday observation beyond the bounded clock skew', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');

    expect(evaluateHistoryRecency(
      [{ date: '2026-08-01T12:04:00.000Z' }],
      '1m',
      'crypto',
      now,
    ).freshness).toBe('fresh');
    expect(evaluateHistoryRecency(
      [{ date: '2026-08-01T12:06:00.000Z' }],
      '1m',
      'crypto',
      now,
    ).freshness).toBe('stale');
  });
});
