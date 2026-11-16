import { runBacktest } from '@/lib/strategy/backtest-engine';
import { runStabilityAnalysis } from '@/lib/strategy/stability-analyzer';
import type { BacktestParameters } from '@/lib/strategy/models';
import type {
  BacktestMetrics,
  BacktestResult,
  FullAnalysisResult,
} from '@/lib/strategy/types';

jest.mock('@/lib/strategy/backtest-engine', () => ({
  runBacktest: jest.fn(),
}));

const mockedRunBacktest = jest.mocked(runBacktest);

function metrics(compositeScore: number): BacktestMetrics {
  return {
    totalReturnPct: compositeScore,
    annualizedReturnPct: compositeScore,
    buyHoldReturnPct: 0,
    totalTrades: 5,
    winningTrades: 3,
    losingTrades: 2,
    winRate: 60,
    profitFactor: 1.5,
    maxDrawdownPct: 10,
    volatility: 15,
    sharpeRatio: 1,
    sortinoRatio: 1,
    falseSignalRate: 40,
    timeInMarketPct: 50,
    avgGainPerTrade: 5,
    avgLossPerTrade: -3,
    avgHoldingPeriod: 10,
    compositeScore,
    drawdownDurationDays: 20,
    beta: 1,
    calmarRatio: 1,
    bestYear: { year: '2024', returnPct: compositeScore },
    worstYear: { year: '2024', returnPct: compositeScore },
  };
}

function backtestResult(
  parameters: BacktestParameters,
  startDate: string,
  endDate: string,
  compositeScore: number,
): BacktestResult {
  return {
    parameters,
    asset: 'TEST',
    startDate,
    endDate,
    signals: [],
    trades: [],
    metrics: metrics(compositeScore),
    equityCurve: [100, 100 + compositeScore],
    drawdownCurve: [0, compositeScore < 0 ? compositeScore : 0],
  };
}

describe('strategy stability score classification', () => {
  it('does not discard non-positive segment scores when measuring variance', () => {
    const parameters: BacktestParameters = {
      strategyType: 'single_sma',
      smaPeriod: 20,
      feePercent: 0,
      slippagePercent: 0,
      initialCapital: 100,
    };
    const fullResult = backtestResult(
      parameters,
      '2020-01-01',
      '2025-01-01',
      50,
    );
    const strategy: FullAnalysisResult = {
      result: fullResult,
      strategyLabel: 'SMA(20)',
      usedIndicators: { sma: true },
      endCapital: 150,
      robustnessFlag: 'robust',
      categoryTags: [],
    };
    const dates = Array.from({ length: 1_828 }, (_, index) => {
      const date = new Date('2020-01-01T00:00:00.000Z');
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const prices = dates.map((_, index) => 100 + index / 100);

    mockedRunBacktest.mockImplementation(
      (_prices, segmentDates, segmentParameters) => {
        const score = segmentDates[0].startsWith('2020') ? 40 : -40;
        return backtestResult(
          segmentParameters,
          segmentDates[0],
          segmentDates.at(-1) ?? segmentDates[0],
          score,
        );
      },
    );

    const report = runStabilityAnalysis(
      [strategy],
      prices,
      dates,
      'TEST',
    );
    const stability = report.stabilityScores[0];

    expect(
      stability.segmentScores.some(({ score }) => score < 0),
    ).toBe(true);
    expect(stability.stabilityFlag).toBe('regime_dependent');
  });
});
