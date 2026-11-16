import { runBacktest } from '@/lib/strategy/backtest-engine';
import { runMultiOptimization } from '@/lib/strategy/multi-optimizer';
import type { BacktestParameters } from '@/lib/strategy/models';
import type {
  BacktestMetrics,
  BacktestResult,
} from '@/lib/strategy/types';

jest.mock('@/lib/strategy/backtest-engine', () => ({
  runBacktest: jest.fn(),
}));

const mockedRunBacktest = jest.mocked(runBacktest);

function metrics(
  overrides: Partial<BacktestMetrics>,
): BacktestMetrics {
  return {
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    buyHoldReturnPct: 0,
    totalTrades: 5,
    winningTrades: 3,
    losingTrades: 2,
    winRate: 60,
    profitFactor: 1.5,
    maxDrawdownPct: 20,
    volatility: 10,
    sharpeRatio: 1,
    sortinoRatio: 1,
    falseSignalRate: 40,
    timeInMarketPct: 50,
    avgGainPerTrade: 5,
    avgLossPerTrade: -3,
    avgHoldingPeriod: 10,
    compositeScore: 10,
    drawdownDurationDays: 20,
    beta: 1,
    calmarRatio: 1,
    bestYear: { year: '2024', returnPct: 10 },
    worstYear: { year: '2023', returnPct: -5 },
    ...overrides,
  };
}

function result(
  parameters: BacktestParameters,
  resultMetrics: BacktestMetrics,
): BacktestResult {
  return {
    parameters,
    asset: 'TEST',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    signals: [],
    trades: [],
    metrics: resultMetrics,
    equityCurve: [100, 100 * (1 + resultMetrics.totalReturnPct / 100)],
    drawdownCurve: [0, -resultMetrics.maxDrawdownPct],
  };
}

describe('multi-optimizer category tags', () => {
  beforeEach(() => {
    mockedRunBacktest.mockImplementation(
      (_prices, _dates, parameters) => {
        if (parameters.strategyType === 'single_sma') {
          return result(
            parameters,
            metrics({
              totalReturnPct: 100,
              compositeScore: 10,
              sharpeRatio: 1,
              winRate: 60,
              maxDrawdownPct: 20,
            }),
          );
        }

        return result(
          parameters,
          metrics({
            totalReturnPct: 50,
            compositeScore: 90,
            sharpeRatio: 2,
            winRate: 70,
            maxDrawdownPct: 10,
          }),
        );
      },
    );
  });

  it('assigns overall and strategy-family tags by their stated metric', () => {
    const prices = Array.from({ length: 300 }, (_, index) => 100 + index);
    const dates = prices.map(
      (_, index) => `2024-${String((index % 12) + 1).padStart(2, '0')}-01`,
    );

    const results = runMultiOptimization({
      asset: 'TEST',
      prices,
      dates,
      feePercent: 0,
      slippagePercent: 0,
      initialCapital: 100,
      intensity: 'fast',
      step: 100,
    });

    const single = results.find(
      (entry) => entry.result.parameters.strategyType === 'single_sma',
    );
    const dual = results.find(
      (entry) => entry.result.parameters.strategyType === 'dual_sma',
    );

    expect(results[0]).toBe(single);
    expect(single?.categoryTags).toEqual(
      expect.arrayContaining(['best_return', 'best_sma_only']),
    );
    expect(single?.categoryTags).not.toContain('best_overall');
    expect(single?.categoryTags).not.toContain('best_dual_sma');

    expect(dual?.categoryTags).toEqual(
      expect.arrayContaining(['best_overall', 'best_dual_sma']),
    );
    expect(dual?.categoryTags).not.toContain('best_sma_only');
  });
});
