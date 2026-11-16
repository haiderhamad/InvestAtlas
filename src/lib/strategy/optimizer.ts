/**
 * SMA Parameter Optimizer
 * Exhaustive search over integer ranges for optimal SMA parameters
 */

import { runBacktest } from './backtest-engine';
import type { BacktestParameters } from '@/lib/strategy/models';
import type { BacktestResult, OptimizationConfig, OptimizationProgress } from './types';

/**
 * Run exhaustive single-SMA parameter search
 * Tests every integer SMA period in the given range
 */
export function optimizeSingleSMA(
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void
): BacktestResult[] {
  const { start, end } = config.singleSmaRange || { start: 2, end: 200 };
  const results: BacktestResult[] = [];
  const total = end - start + 1;
  
  for (let period = start; period <= end; period++) {
    const params: BacktestParameters = {
      strategyType: 'single_sma',
      smaPeriod: period,
      feePercent: config.feePercent,
      feeMode: config.feeMode,
      flatFeeAmount: config.flatFeeAmount,
      quoteCurrency: config.quoteCurrency,
      slippagePercent: config.slippagePercent,
      initialCapital: config.initialCapital,
    };
    
    try {
      const result = runBacktest(config.prices, config.dates, params, config.asset);
      results.push(result);
    } catch {
      // Skip invalid configs
    }
    
    if (onProgress) {
      onProgress({
        completed: period - start + 1,
        total,
        currentParams: `SMA(${period})`,
        bestSoFar: results.length > 0
          ? results.reduce((best, r) => 
              r.metrics.compositeScore > best.metrics.compositeScore ? r : best
            )
          : null,
      });
    }
  }
  
  // Sort by composite score descending
  results.sort((a, b) => b.metrics.compositeScore - a.metrics.compositeScore);
  return results;
}

/**
 * Run exhaustive dual-SMA parameter search
 * Tests all valid fast/slow combinations where fast < slow
 */
export function optimizeDualSMA(
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void
): BacktestResult[] {
  const fastRange = config.fastSmaRange || { start: 2, end: 100 };
  const slowRange = config.slowSmaRange || { start: 5, end: 400 };
  const results: BacktestResult[] = [];
  
  // Count total valid combinations
  let total = 0;
  for (let fast = fastRange.start; fast <= fastRange.end; fast++) {
    for (let slow = Math.max(slowRange.start, fast + 1); slow <= slowRange.end; slow++) {
      total++;
    }
  }
  
  let completed = 0;
  
  for (let fast = fastRange.start; fast <= fastRange.end; fast++) {
    for (let slow = Math.max(slowRange.start, fast + 1); slow <= slowRange.end; slow++) {
      const params: BacktestParameters = {
        strategyType: 'dual_sma',
        fastPeriod: fast,
        slowPeriod: slow,
        feePercent: config.feePercent,
        feeMode: config.feeMode,
        flatFeeAmount: config.flatFeeAmount,
        quoteCurrency: config.quoteCurrency,
        slippagePercent: config.slippagePercent,
        initialCapital: config.initialCapital,
      };
      
      try {
        const result = runBacktest(config.prices, config.dates, params, config.asset);
        results.push(result);
      } catch {
        // Skip invalid configs
      }
      
      completed++;
      
      if (onProgress && completed % 100 === 0) {
        onProgress({
          completed,
          total,
          currentParams: `SMA(${fast}/${slow})`,
          bestSoFar: results.length > 0
            ? results.reduce((best, r) =>
                r.metrics.compositeScore > best.metrics.compositeScore ? r : best
              )
            : null,
        });
      }
    }
  }
  
  results.sort((a, b) => b.metrics.compositeScore - a.metrics.compositeScore);
  return results;
}

/**
 * Run optimization with train/test split for overfitting protection
 */
export function optimizeWithValidation(
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void
): { trainResults: BacktestResult[]; testResults: BacktestResult[]; bestRobust: BacktestResult | null } {
  const split = config.trainTestSplit || 0.7;
  const splitIndex = Math.floor(config.prices.length * split);
  
  const trainConfig: OptimizationConfig = {
    ...config,
    prices: config.prices.slice(0, splitIndex),
    dates: config.dates.slice(0, splitIndex),
  };
  
  const testConfig: OptimizationConfig = {
    ...config,
    prices: config.prices.slice(splitIndex),
    dates: config.dates.slice(splitIndex),
  };
  
  // Optimize on training data
  let trainResults: BacktestResult[];
  if (config.strategyType === 'single_sma') {
    trainResults = optimizeSingleSMA(trainConfig, onProgress);
  } else {
    trainResults = optimizeDualSMA(trainConfig, onProgress);
  }
  
  // Evaluate top parameters on test data
  const topN = Math.min(20, trainResults.length);
  const testResults: BacktestResult[] = [];
  
  for (let i = 0; i < topN; i++) {
    try {
      const result = runBacktest(
        testConfig.prices,
        testConfig.dates,
        trainResults[i].parameters,
        config.asset
      );
      testResults.push(result);
    } catch {
      // Skip if test data insufficient
    }
  }
  
  testResults.sort((a, b) => b.metrics.compositeScore - a.metrics.compositeScore);
  
  // Find the most robust result (good on both train and test)
  let bestRobust: BacktestResult | null = null;
  let bestRobustScore = -Infinity;
  
  for (const testResult of testResults) {
    const trainMatch = trainResults.find(
      tr => JSON.stringify(tr.parameters) === JSON.stringify(testResult.parameters)
    );
    
    if (trainMatch) {
      const robustScore = (trainMatch.metrics.compositeScore + testResult.metrics.compositeScore) / 2;
      if (robustScore > bestRobustScore) {
        bestRobustScore = robustScore;
        bestRobust = testResult;
      }
    }
  }
  
  return { trainResults, testResults, bestRobust };
}

/**
 * Calculate robustness score by testing across different time windows
 */
export function calculateRobustnessScore(
  prices: number[],
  dates: string[],
  params: BacktestParameters,
  asset: string,
  windowCount: number = 5
): number {
  const windowSize = Math.floor(prices.length / windowCount);
  if (windowSize < 30) return 0;
  
  const scores: number[] = [];
  
  for (let i = 0; i < windowCount; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, prices.length);
    
    try {
      const result = runBacktest(
        prices.slice(start, end),
        dates.slice(start, end),
        params,
        asset
      );
      scores.push(result.metrics.compositeScore);
    } catch {
      scores.push(0);
    }
  }
  
  // Robustness = consistency across windows (lower variance = more robust)
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // Coefficient of variation
  
  // Score: high mean + low variation = good robustness  
  return Math.max(0, mean * (1 - Math.min(cv, 1)));
}
