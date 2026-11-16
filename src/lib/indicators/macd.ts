/**
 * MACD (Moving Average Convergence Divergence) Calculator
 * Used as confirmation filter in SMA-based strategies
 */

import { calculateEMA } from './ema';

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/**
 * Calculate MACD
 * @param data Closing prices
 * @param fastPeriod Fast EMA period (default 12)
 * @param slowPeriod Slow EMA period (default 26)
 * @param signalPeriod Signal EMA period (default 9)
 */
export function calculateMACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  // MACD line = Fast EMA - Slow EMA
  const macdLine: (number | null)[] = new Array(data.length).fill(null);
  const macdValues: number[] = [];
  const macdIndices: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine[i] = fastEMA[i]! - slowEMA[i]!;
      macdValues.push(macdLine[i]!);
      macdIndices.push(i);
    }
  }
  
  // Signal line = EMA of MACD line
  const signalEMA = calculateEMA(macdValues, signalPeriod);
  const signalLine: (number | null)[] = new Array(data.length).fill(null);
  
  for (let j = 0; j < signalEMA.length; j++) {
    if (signalEMA[j] !== null) {
      signalLine[macdIndices[j]] = signalEMA[j];
    }
  }
  
  // Histogram = MACD - Signal
  const histogram: (number | null)[] = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i]! - signalLine[i]!;
    }
  }
  
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Check if MACD is bullish (MACD line above signal line)
 */
export function isMACDBullish(macdResult: MACDResult, index: number): boolean | null {
  if (macdResult.macd[index] === null || macdResult.signal[index] === null) return null;
  return macdResult.macd[index]! > macdResult.signal[index]!;
}
