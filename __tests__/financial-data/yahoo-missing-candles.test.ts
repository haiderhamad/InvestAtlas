import { parseYahooPersonalChart } from '@/lib/financial-data/providers/yahoo-personal-server';

const now = Date.parse('2026-11-08T12:00:00Z');
const range = { from: '2025-11-07', to: '2026-11-07' };
// Yahoo IUSD.DE's 2026-03-06 row is present but every OHLC field is null.
function missingCandle() {
  return { chart: { result: [{
    meta: { symbol: 'IUSD.DE', currency: 'EUR', instrumentType: 'ETF', exchangeName: 'GER' },
    timestamp: [1772697600, 1772784000, 1793952000],
    indicators: { quote: [{
      open: [51.65999984741211, null, 57.58000183105469],
      high: [51.83000183105469, null, 58.45000076293945],
      low: [51.369998931884766, null, 57.54999923706055],
      close: [51.369998931884766, null, 58.45000076293945], volume: [2785, null, 17175],
    }] },
  }], error: null } };
}

test('retains authentic ETF bars around an explicitly absent Yahoo candle without inventing a price', () => {
  const result = parseYahooPersonalChart('ISWD', missingCandle(), now, { range, allowHistoricalTail: true });
  expect(result.bars).toEqual([
    { date: '2026-03-05', open: 51.65999984741211, high: 51.83000183105469, low: 51.369998931884766, close: 51.369998931884766, volume: 2785 },
    { date: '2026-11-06', open: 57.58000183105469, high: 58.45000076293945, low: 57.54999923706055, close: 58.45000076293945, volume: 17175 },
  ]);
  expect(result).toHaveProperty('missingTradingDates', ['2026-03-06']);
  expect(result).not.toHaveProperty('current');
});

test.each([0, -1, '55', 55])('rejects mixed or invalid OHLC even beside a genuine missing row: %s', invalid => {
  const data = missingCandle();
  (data.chart.result[0].indicators.quote[0].open as unknown[])[1] = invalid;
  expect(() => parseYahooPersonalChart('ISWD', data, now, { range, allowHistoricalTail: true })).toThrow('OHLC');
});

test('a missing latest candle never substitutes retrieval time or a zero price', () => {
  const data = missingCandle();
  data.chart.result[0].timestamp[2] = Date.parse('2026-03-09T08:00:00Z') / 1000;
  for (const field of ['open', 'high', 'low', 'close'] as const) data.chart.result[0].indicators.quote[0][field][2] = null;
  expect(() => parseYahooPersonalChart('ISWD', data, now)).toThrow();
});
