/**
 * Simple Moving Average (SMA) Calculator
 * Core indicator for the strategy engine - supports any integer period
 */

/**
 * Calculate SMA for a given period
 * @param data Array of closing prices
 * @param period Integer period (e.g., 2 to 400+)
 * @returns Array of SMA values (null where insufficient data)
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  if (period < 1 || !Number.isInteger(period)) {
    throw new Error(`SMA period must be a positive integer, got: ${period}`);
  }
  
  const result: (number | null)[] = new Array(data.length).fill(null);
  
  if (data.length < period) return result;
  
  // Calculate first SMA using simple sum
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result[period - 1] = sum / period;
  
  // Sliding window for remaining values
  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period] + data[i];
    result[i] = sum / period;
  }
  
  return result;
}

/**
 * Batch calculate SMA for multiple periods (optimized)
 * Used during exhaustive parameter search
 * @param data Closing prices
 * @param periods Array of periods to calculate
 * @returns Map of period -> SMA values
 */
export function calculateSMABatch(
  data: number[],
  periods: number[]
): Map<number, (number | null)[]> {
  const results = new Map<number, (number | null)[]>();
  
  for (const period of periods) {
    results.set(period, calculateSMA(data, period));
  }
  
  return results;
}

/**
 * Detect SMA crossover signals
 * @param price Price array
 * @param sma SMA values array
 * @returns Array of signals: 1 = price crosses above SMA, -1 = crosses below, 0 = no cross
 */
export function detectSMACrossover(
  price: number[],
  sma: (number | null)[]
): number[] {
  const signals: number[] = new Array(price.length).fill(0);
  
  for (let i = 1; i < price.length; i++) {
    if (sma[i] === null || sma[i - 1] === null) continue;
    
    const prevAbove = price[i - 1] > sma[i - 1]!;
    const currAbove = price[i] > sma[i]!;
    
    if (!prevAbove && currAbove) {
      signals[i] = 1; // Bullish crossover
    } else if (prevAbove && !currAbove) {
      signals[i] = -1; // Bearish crossover
    }
  }
  
  return signals;
}

/**
 * Detect dual-SMA crossover signals (Golden Cross / Death Cross)
 * @param fastSMA Fast SMA values
 * @param slowSMA Slow SMA values
 * @returns Array of signals: 1 = golden cross, -1 = death cross, 0 = no cross
 */
export function detectDualSMACrossover(
  fastSMA: (number | null)[],
  slowSMA: (number | null)[]
): number[] {
  const signals: number[] = new Array(fastSMA.length).fill(0);
  
  for (let i = 1; i < fastSMA.length; i++) {
    if (fastSMA[i] === null || fastSMA[i - 1] === null ||
        slowSMA[i] === null || slowSMA[i - 1] === null) continue;
    
    const prevFastAbove = fastSMA[i - 1]! > slowSMA[i - 1]!;
    const currFastAbove = fastSMA[i]! > slowSMA[i]!;
    
    if (!prevFastAbove && currFastAbove) {
      signals[i] = 1; // Golden Cross
    } else if (prevFastAbove && !currFastAbove) {
      signals[i] = -1; // Death Cross
    }
  }
  
  return signals;
}

/**
 * Generate all integer periods in a range
 * @param start Start of range (inclusive)
 * @param end End of range (inclusive)
 * @returns Array of integers
 */
export function generatePeriodRange(start: number, end: number): number[] {
  const periods: number[] = [];
  for (let i = Math.max(2, start); i <= end; i++) {
    periods.push(i);
  }
  return periods;
}
