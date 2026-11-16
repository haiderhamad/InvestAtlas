/**
 * Strategy Types and Interfaces
 * Core types for the SMA-centric backtesting engine
 */

import type { BacktestParameters, SimulatedTrade } from '@/lib/strategy/models';

export interface StrategySignal {
  index: number;
  date: string;
  type: 'buy' | 'sell';
  price: number;
  reason: string;
}

export interface BacktestResult {
  parameters: BacktestParameters;
  asset: string;
  startDate: string;
  endDate: string;
  signals: StrategySignal[];
  trades: SimulatedTrade[];
  metrics: BacktestMetrics;
  equityCurve: number[];
  drawdownCurve: number[];
}

export interface BacktestMetrics {
  totalReturnPct: number;
  annualizedReturnPct: number;
  buyHoldReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  falseSignalRate: number;
  timeInMarketPct: number;
  avgGainPerTrade: number;
  avgLossPerTrade: number;
  avgHoldingPeriod: number;
  compositeScore: number;
  // Advanced Metrics
  drawdownDurationDays: number;
  beta: number;
  calmarRatio: number;
  bestYear: { year: string; returnPct: number };
  worstYear: { year: string; returnPct: number };
}

export interface OptimizationConfig {
  asset: string;
  startDate: string;
  endDate: string;
  prices: number[];
  dates: string[];
  strategyType: 'single_sma' | 'dual_sma';
  // Ranges
  singleSmaRange?: { start: number; end: number };
  fastSmaRange?: { start: number; end: number };
  slowSmaRange?: { start: number; end: number };
  // Filter config

  // Shared config
  feePercent: number;
  feeMode?: 'percent' | 'flat';
  flatFeeAmount?: number;
  quoteCurrency?: 'eur' | 'usd';
  slippagePercent: number;
  initialCapital: number;
  // Overfitting protection
  trainTestSplit?: number; // 0.0 to 1.0, portion for training
}

export interface OptimizationProgress {
  completed: number;
  total: number;
  currentParams: string;
  bestSoFar: BacktestResult | null;
}

export type CategoryTag =
  | 'best_overall'
  | 'best_return'
  | 'best_winrate'
  | 'best_risk'
  | 'best_sharpe'
  | 'best_sma_only'
  | 'best_dual_sma';

export interface FullAnalysisResult {
  result: BacktestResult;
  strategyLabel: string;
  usedIndicators: { sma: boolean };
  endCapital: number;
  robustnessFlag: 'robust' | 'possibly_overfit' | 'insufficient_data';
  categoryTags: CategoryTag[];
}
