/**
 * Multi-Indicator Strategy Optimizer
 * Exhaustive search across all indicator combinations and parameter ranges
 * Supports: SMA, EMA, RSI, MACD — individually and in all combinations
 */

import { runBacktest } from './backtest-engine';
import type { BacktestParameters } from '@/lib/strategy/models';
import type { BacktestResult, FullAnalysisResult, CategoryTag, OptimizationProgress } from './types';

// ─── Configuration ───

export interface MultiOptConfig {
  asset: string;
  prices: number[];
  dates: string[];
  feePercent: number;
  feeMode?: 'percent' | 'flat';
  flatFeeAmount?: number;
  quoteCurrency?: 'eur' | 'usd';
  slippagePercent: number;
  initialCapital: number;
  intensity: 'fast' | 'normal' | 'thorough';
  step?: number;
  volumes?: (number | null)[];
  interval?: string;
}

interface ParamSet {
  label: string;
  params: BacktestParameters;
  indicators: { sma: boolean };
}

// ─── Parameter Ranges by Intensity ───

function getSmaValues(intensity: string, step: number = 1): number[] {
  switch (intensity) {
    case 'fast':     return range(5, 100, step);
    case 'thorough': return range(5, 300, step);
    default:         return range(5, 200, step);
  }
}

function getDualSmaPairs(intensity: string, step: number = 1): [number, number][] {
  const pairs: [number, number][] = [];
  let fastRange: number[], slowRange: number[];
  switch (intensity) {
    case 'fast':
      fastRange = range(5, 50, step);
      slowRange = range(20, 100, step);
      break;
    case 'thorough':
      fastRange = range(5, 100, step);
      slowRange = range(20, 300, step);
      break;
    default:
      fastRange = range(5, 80, step);
      slowRange = range(20, 200, step);
      break;
  }
  for (const f of fastRange) {
    for (const s of slowRange) {
      if (f < s) pairs.push([f, s]);
    }
  }
  return pairs;
}

/** Helper: generate range from start to end with given step */
function range(start: number, end: number, step: number = 1): number[] {
  const arr: number[] = [];
  for (let i = start; i <= end; i += step) arr.push(i);
  return arr;
}



// ─── Generate All Parameter Sets ───

function generateParamSets(config: MultiOptConfig): ParamSet[] {
  const sets: ParamSet[] = [];
  const { feePercent, feeMode, flatFeeAmount, quoteCurrency, slippagePercent, initialCapital, intensity, step = 1 } = config;
  const base = { feePercent, feeMode, flatFeeAmount, quoteCurrency, slippagePercent, initialCapital };

  const smaVals = getSmaValues(intensity, step);
  const dualPairs = getDualSmaPairs(intensity, step);

  // 1) SMA only (single)
  for (const sma of smaVals) {
    sets.push({
      label: `SMA(${sma})`,
      params: { ...base, strategyType: 'single_sma', smaPeriod: sma },
      indicators: { sma: true },
    });
  }

  // 2) Dual SMA only
  for (const [f, s] of dualPairs) {
    sets.push({
      label: `SMA(${f}/${s})`,
      params: { ...base, strategyType: 'dual_sma', fastPeriod: f, slowPeriod: s },
      indicators: { sma: true },
    });
  }

  return sets;
}

// ─── Highlight / Category Tagging ───

function assignCategories(results: FullAnalysisResult[]): void {
  if (results.length === 0) return;

  const tag = (idx: number, t: CategoryTag) => {
    if (idx >= 0 && idx < results.length && !results[idx].categoryTags.includes(t)) {
      results[idx].categoryTags.push(t);
    }
  };

  const bestIndexBy = (
    candidates: number[],
    score: (result: FullAnalysisResult) => number,
  ): number => {
    if (candidates.length === 0) return -1;
    return candidates.reduce((best, current) =>
      score(results[current]) > score(results[best]) ? current : best,
    );
  };

  const allIndices = results.map((_, index) => index);

  // Overall best means the highest composite score, independent of the
  // return-based table order.
  tag(
    bestIndexBy(
      allIndices,
      (result) => result.result.metrics.compositeScore,
    ),
    'best_overall',
  );

  // Best return
  let bestReturnIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].result.metrics.totalReturnPct > results[bestReturnIdx].result.metrics.totalReturnPct) bestReturnIdx = i;
  }
  tag(bestReturnIdx, 'best_return');

  // Best win rate (min 3 trades)
  let bestWrIdx = -1;
  for (let i = 0; i < results.length; i++) {
    if (results[i].result.metrics.totalTrades >= 3) {
      if (bestWrIdx === -1 || results[i].result.metrics.winRate > results[bestWrIdx].result.metrics.winRate) bestWrIdx = i;
    }
  }
  if (bestWrIdx >= 0) tag(bestWrIdx, 'best_winrate');

  // Best risk (lowest max DD, min 3 trades)
  let bestRiskIdx = -1;
  for (let i = 0; i < results.length; i++) {
    if (results[i].result.metrics.totalTrades >= 3) {
      if (bestRiskIdx === -1 || results[i].result.metrics.maxDrawdownPct < results[bestRiskIdx].result.metrics.maxDrawdownPct) bestRiskIdx = i;
    }
  }
  if (bestRiskIdx >= 0) tag(bestRiskIdx, 'best_risk');

  // Best Sharpe
  let bestSharpeIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].result.metrics.sharpeRatio > results[bestSharpeIdx].result.metrics.sharpeRatio) bestSharpeIdx = i;
  }
  tag(bestSharpeIdx, 'best_sharpe');

  // Best composite score per actually distinct strategy family.
  const categories: {
    filter: (result: FullAnalysisResult) => boolean;
    tag: CategoryTag;
  }[] = [
    {
      filter: (result) =>
        result.result.parameters.strategyType === 'single_sma',
      tag: 'best_sma_only',
    },
    {
      filter: (result) =>
        result.result.parameters.strategyType === 'dual_sma',
      tag: 'best_dual_sma',
    },
  ];

  for (const cat of categories) {
    const matching = allIndices.filter((index) => cat.filter(results[index]));
    tag(
      bestIndexBy(
        matching,
        (result) => result.result.metrics.compositeScore,
      ),
      cat.tag,
    );
  }
}

// ─── Robustness Check ───

function assessRobustness(r: BacktestResult, dataPoints: number): 'robust' | 'possibly_overfit' | 'insufficient_data' {
  if (dataPoints < 100) return 'insufficient_data';
  const m = r.metrics;
  // Possibly overfit: very few trades, extremely high return, or win rate > 90%
  if (m.totalTrades < 5) return 'possibly_overfit';
  if (m.winRate > 90 && m.totalTrades < 20) return 'possibly_overfit';
  if (m.totalReturnPct > 1000 && m.totalTrades < 10) return 'possibly_overfit';
  return 'robust';
}

// ─── Public API ───

/**
 * Run exhaustive multi-indicator optimization
 */
export function runMultiOptimization(
  config: MultiOptConfig,
  onProgress?: (progress: OptimizationProgress) => void
): FullAnalysisResult[] {
  const paramSets = generateParamSets(config);
  const results: FullAnalysisResult[] = [];

  for (let i = 0; i < paramSets.length; i++) {
    const ps = paramSets[i];

    try {
      const result = runBacktest(config.prices, config.dates, ps.params, config.asset, config.volumes);
      const finalEquity =
        result.equityCurve[result.equityCurve.length - 1]
        ?? config.initialCapital;

      results.push({
        result,
        strategyLabel: ps.label,
        usedIndicators: ps.indicators,
        endCapital: finalEquity,
        robustnessFlag: assessRobustness(result, config.prices.length),
        categoryTags: [],
      });
    } catch {
      // Skip invalid configs (e.g. period > data length)
    }

    if (onProgress && (i % 50 === 0 || i === paramSets.length - 1)) {
      onProgress({
        completed: i + 1,
        total: paramSets.length,
        currentParams: ps.label,
        bestSoFar: results.length > 0
          ? results.reduce((best, r) => r.result.metrics.totalReturnPct > best.result.metrics.totalReturnPct ? r : best).result
          : null,
      });
    }
  }

  // Sort by Returns (Return/End Value) descending instead of composite score
  results.sort((a, b) => b.result.metrics.totalReturnPct - a.result.metrics.totalReturnPct);

  // Assign category tags
  assignCategories(results);

  return results;
}

/**
 * Get estimated total combinations for a given intensity
 */
export function estimateCombinations(intensity: 'fast' | 'normal' | 'thorough'): number {
  const config: MultiOptConfig = {
    asset: 'TEST', prices: [1], dates: ['x'], feePercent: 0.25, slippagePercent: 0.1, initialCapital: 100, intensity,
  };
  return generateParamSets(config).length;
}
