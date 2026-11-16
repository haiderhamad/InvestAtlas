/**
 * Strategy Engine Tests
 */

import { runBacktest } from '../../src/lib/strategy/backtest-engine';
import { calculateMaxDrawdown } from '../../src/lib/strategy/metrics';
import type { BacktestParameters } from '../../src/lib/strategy/models';

function generateSinePrices(length: number, base: number = 100): { prices: number[]; dates: string[] } {
  const prices: number[] = [];
  const dates: string[] = [];
  const start = new Date('2020-01-01');
  
  for (let i = 0; i < length; i++) {
    prices.push(base + Math.sin(i * 0.05) * 20 + Math.random() * 5);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  
  return { prices, dates };
}

describe('runBacktest - Single SMA', () => {
  test('generates trades from sine wave data', () => {
    const { prices, dates } = generateSinePrices(500);
    const params: BacktestParameters = {
      strategyType: 'single_sma',
      smaPeriod: 20,
      feePercent: 0.25,
      slippagePercent: 0.1,
      initialCapital: 100,
    };
    
    const result = runBacktest(prices, dates, params, 'TEST');
    
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.metrics.totalTrades).toBe(result.trades.length);
    expect(result.equityCurve.length).toBe(prices.length);
    expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.winRate).toBeLessThanOrEqual(100);
  });

  test('metrics are valid ranges', () => {
    const { prices, dates } = generateSinePrices(300);
    const params: BacktestParameters = {
      strategyType: 'single_sma',
      smaPeriod: 10,
      feePercent: 0.25,
      slippagePercent: 0.1,
      initialCapital: 100,
    };
    
    const result = runBacktest(prices, dates, params, 'TEST');
    
    expect(result.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdownPct).toBeLessThanOrEqual(100);
    expect(result.metrics.timeInMarketPct).toBeGreaterThanOrEqual(0);
    expect(result.metrics.timeInMarketPct).toBeLessThanOrEqual(100);
    expect(result.metrics.falseSignalRate).toBeGreaterThanOrEqual(0);
  });

  test('throws on insufficient data', () => {
    expect(() => {
      runBacktest([1, 2], ['d1', 'd2'], {
        strategyType: 'single_sma', smaPeriod: 50,
        feePercent: 0.25, slippagePercent: 0.1, initialCapital: 100,
      }, 'TEST');
    }).toThrow();
  });
});

describe('runBacktest - Dual SMA', () => {
  test('enforces fast < slow conceptually', () => {
    const { prices, dates } = generateSinePrices(500);
    const params: BacktestParameters = {
      strategyType: 'dual_sma',
      fastPeriod: 10,
      slowPeriod: 50,
      feePercent: 0.25,
      slippagePercent: 0.1,
      initialCapital: 100,
    };
    
    const result = runBacktest(prices, dates, params, 'TEST');
    expect(result.trades.length).toBeGreaterThan(0);
  });
});

describe('calculateMaxDrawdown', () => {
  test('calculates correct drawdown', () => {
    const equity = [100, 110, 105, 95, 100, 115, 108];
    const dd = calculateMaxDrawdown(equity);
    // Peak 110, trough 95, drawdown = (110-95)/110 * 100 = 13.64%
    expect(dd).toBeCloseTo(13.636, 1);
  });

  test('returns 0 for monotonically increasing', () => {
    expect(calculateMaxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  test('handles single value', () => {
    expect(calculateMaxDrawdown([100])).toBe(0);
  });
});
