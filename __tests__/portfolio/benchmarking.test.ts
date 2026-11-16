import {
  buildBenchmarkComparisonSeries,
  buildInvestedPerformanceCashFlows,
  buildMonthlyReturnHeatmap,
} from '@/lib/portfolio/benchmarking';
import type { PortfolioMonitorPoint } from '@/lib/portfolio/ux-insights';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

const point = (
  date: string,
  marketValue: number,
  invested: number,
  totalReturn = marketValue,
): PortfolioMonitorPoint => ({
  date,
  shortDate: date,
  invested,
  marketValue,
  totalReturn,
  pnlGap: marketValue - invested,
  monthlyDividends: 0,
  cumulativeDividends: totalReturn - marketValue,
  crypto: marketValue,
  stocks: 0,
  etfs: 0,
  metals: 0,
});

describe('portfolio performance correctness', () => {
  it('keeps prior gains intact when fresh capital is contributed', () => {
    const result = buildBenchmarkComparisonSeries(
      [
        point('2024-01-01', 100, 100),
        point('2024-01-02', 110, 100),
        point('2024-01-03', 210, 200),
      ],
      [
        { date: '2024-01-01', close: 100 },
        { date: '2024-01-02', close: 100 },
        { date: '2024-01-03', close: 100 },
      ],
      0,
      new Map([['2024-01-03', 100]]),
    );

    expect(result.map((entry) => entry.portfolioPct)).toEqual([0, 10, 10]);
  });

  it('includes received dividends in portfolio total return', () => {
    const result = buildBenchmarkComparisonSeries(
      [
        point('2024-01-01', 100, 100),
        point('2024-01-02', 100, 100, 110),
      ],
      [
        { date: '2024-01-01', close: 100 },
        { date: '2024-01-02', close: 100 },
      ],
      0,
    );

    expect(result.at(-1)?.portfolioPct).toBe(10);
  });

  it('uses only the latest benchmark close available on or before each date', () => {
    const result = buildBenchmarkComparisonSeries(
      [
        point('2024-01-01', 100, 100),
        point('2024-01-02', 100, 100),
        point('2024-01-03', 100, 100),
      ],
      [
        { date: '2024-01-01', close: 100 },
        { date: '2024-01-03', close: 110 },
      ],
      0,
    );

    expect(result.map((entry) => entry.benchmarkPct)).toEqual([0, 0, 10]);
  });

  it('uses elapsed calendar time for inflation-adjusted return', () => {
    const result = buildBenchmarkComparisonSeries(
      [
        point('2024-01-01', 100, 100),
        point('2025-01-01', 110, 100),
      ],
      [
        { date: '2024-01-01', close: 100 },
        { date: '2025-01-01', close: 110 },
      ],
      10,
    );

    expect(result.at(-1)?.realPct).toBeCloseTo(0, 1);
  });

  it('calculates each heatmap cell as that month’s cash-flow-adjusted return', () => {
    const result = buildMonthlyReturnHeatmap(
      [
        point('2024-01-01', 100, 100),
        point('2024-01-31', 110, 100),
        point('2024-02-01', 210, 200),
        point('2024-02-29', 231, 200),
      ],
      new Map([['2024-02-01', 100]]),
    );

    expect(result).toEqual([
      { year: '2024', month: 'Jan', returnPct: 10 },
      { year: '2024', month: 'Feb', returnPct: 10 },
    ]);
  });

  it('treats buy fees as contributed capital rather than performance', () => {
    const transaction: InvestmentTransaction = {
      id: 'buy-1',
      date: '2024-01-02T12:00:00.000Z',
      venue: 'broker',
      type: 'buy',
      asset: 'AAPL',
      assetClass: 'stock',
      quote: 'EUR',
      amount: 1,
      price: 100,
      total: 100,
      fee: 2,
      taxType: 'acquisition',
    };

    expect(buildInvestedPerformanceCashFlows([transaction]).get('2024-01-02')).toBe(102);
  });

  it('treats external asset deposits and withdrawals as portfolio cash flows', () => {
    const base: InvestmentTransaction = {
      id: 'asset-flow',
      date: '2024-01-02T12:00:00.000Z',
      venue: 'wallet',
      type: 'deposit',
      asset: 'BTC',
      assetClass: 'crypto',
      quote: 'EUR',
      amount: 0.01,
      price: 10_000,
      total: 100,
      fee: 2,
      taxType: 'transfer_in',
    };
    const withdrawal: InvestmentTransaction = {
      ...base,
      id: 'asset-out',
      date: '2024-01-03T12:00:00.000Z',
      type: 'withdrawal',
      total: 40,
      fee: 1,
      taxType: 'transfer_out',
    };

    const flows = buildInvestedPerformanceCashFlows([base, withdrawal]);

    expect(flows.get('2024-01-02')).toBe(102);
    expect(flows.get('2024-01-03')).toBe(-39);
  });
});
