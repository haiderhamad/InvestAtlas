import { runBacktest } from '@/lib/strategy/backtest-engine';
import { calculateMetrics } from '@/lib/strategy/metrics';
import type {
  BacktestParameters,
  SimulatedTrade,
} from '@/lib/strategy/models';

const params = (
  overrides: Partial<BacktestParameters> = {},
): BacktestParameters => ({
  strategyType: 'single_sma',
  smaPeriod: 3,
  feePercent: 0,
  slippagePercent: 0,
  initialCapital: 100,
  ...overrides,
});

const datesFor = (length: number) =>
  Array.from({ length }, (_, index) => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });

const prices = [
  10, 10, 10, 9, 8, 12, 13, 14, 15,
  14, 13, 8, 7, 6, 7, 12, 13, 14,
];

describe('strategy execution correctness', () => {
  it('rejects invalid capital, costs, and non-chronological price histories', () => {
    const dates = datesFor(prices.length);

    expect(() =>
      runBacktest(prices, dates, params({ initialCapital: 0 }), 'TEST'),
    ).toThrow('Backtest inputs are invalid');
    expect(() =>
      runBacktest(prices, dates, params({ feePercent: 10.01 }), 'TEST'),
    ).toThrow('Backtest inputs are invalid');
    expect(() =>
      runBacktest(prices, dates, params({ slippagePercent: -0.01 }), 'TEST'),
    ).toThrow('Backtest inputs are invalid');

    const duplicateDates = [...dates];
    duplicateDates[5] = duplicateDates[4];
    expect(() =>
      runBacktest(prices, duplicateDates, params(), 'TEST'),
    ).toThrow('Backtest inputs are invalid');

    const reversedDates = [...dates].reverse();
    expect(() =>
      runBacktest(prices, reversedDates, params(), 'TEST'),
    ).toThrow('Backtest inputs are invalid');
  });

  it('confirms that a crossover regime persists for the configured candles', () => {
    const result = runBacktest(
      prices,
      datesFor(prices.length),
      params({ candleConfirmation: 3 }),
      'TEST',
    );

    expect(result.signals.map(({ index, type }) => ({ index, type }))).toEqual([
      { index: 7, type: 'buy' },
      { index: 11, type: 'sell' },
      { index: 16, type: 'buy' },
    ]);
  });

  it('executes a close-derived signal on the next available bar', () => {
    const dates = datesFor(prices.length);
    const result = runBacktest(prices, dates, params(), 'TEST');

    expect(result.signals[0]).toMatchObject({
      index: 5,
      date: dates[5],
      type: 'buy',
    });
    expect(result.trades[0]).toMatchObject({
      entryDate: dates[6],
      entryPrice: prices[6],
      exitDate: dates[10],
      exitPrice: prices[10],
    });
  });
});

describe('strategy performance metric correctness', () => {
  const noTrades: SimulatedTrade[] = [];

  it('annualizes from elapsed calendar time instead of treating bars as days', () => {
    const metrics = calculateMetrics(
      noTrades,
      [100, 110],
      [100, 110],
      100,
      2,
      ['2024-01-01', '2024-07-01'],
      '1d',
    );

    expect(metrics.annualizedReturnPct).toBeCloseTo(21.06, 1);
  });

  it('annualizes the Sortino ratio exactly once', () => {
    const metrics = calculateMetrics(
      noTrades,
      [100, 110, 104.5, 114.95],
      [100, 110, 104.5, 114.95],
      100,
      4,
      ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      '1d',
    );

    expect(metrics.sortinoRatio).toBeGreaterThan(30);
    expect(metrics.sortinoRatio).toBeLessThan(35);
    expect(metrics.volatility).toBeGreaterThan(160);
    expect(metrics.volatility).toBeLessThan(170);
  });

  it('reports drawdown duration in elapsed days, not observation bars', () => {
    const metrics = calculateMetrics(
      noTrades,
      [100, 90, 95, 100],
      [100, 90, 95, 100],
      100,
      4,
      ['2024-01-01', '2024-01-02', '2024-01-10', '2024-01-20'],
      '1d',
    );

    expect(metrics.drawdownDurationDays).toBe(19);
  });

  it('does not report a flat-period drawdown duration', () => {
    const metrics = calculateMetrics(
      noTrades,
      [100, 100, 100],
      [100, 100, 100],
      100,
      3,
      ['2024-01-01', '2024-01-10', '2024-01-20'],
      '1d',
    );

    expect(metrics.drawdownDurationDays).toBe(0);
  });

  it('preserves a zero terminal equity instead of replacing it with start capital', () => {
    const metrics = calculateMetrics(
      noTrades,
      [100, 0],
      [100, 0],
      100,
      2,
      ['2024-01-01', '2025-01-01'],
      '1d',
    );

    expect(metrics.totalReturnPct).toBe(-100);
    expect(metrics.annualizedReturnPct).toBe(-100);
  });
});
