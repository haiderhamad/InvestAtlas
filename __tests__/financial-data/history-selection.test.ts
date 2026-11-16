import { findRecentHistoricalClose } from '@/lib/financial-data/history/selection';

describe('historical close selection', () => {
  const points = [
    { date: '2026-07-23', close: 98 },
    { date: '2026-07-30', close: 101 },
    { date: '2026-08-01', close: 103 },
  ];

  it('uses the exact requested observation when available', () => {
    expect(findRecentHistoricalClose(points, '2026-08-01')).toEqual({
      date: '2026-08-01',
      close: 103,
    });
  });

  it('uses only a recent earlier observation and never a future one', () => {
    expect(findRecentHistoricalClose(points, '2026-07-31')).toEqual({
      date: '2026-07-30',
      close: 101,
    });
  });

  it('fails closed when the nearest earlier observation is too old', () => {
    expect(findRecentHistoricalClose(points, '2026-08-09')).toBeNull();
  });

  it('rejects invalid dates and non-positive or non-finite closes', () => {
    expect(findRecentHistoricalClose([
      { date: '2026-08-01', close: 0 },
      { date: '2026-07-31', close: Number.NaN },
    ], '2026-08-01')).toBeNull();
    expect(findRecentHistoricalClose(points, 'not-a-date')).toBeNull();
  });
});
