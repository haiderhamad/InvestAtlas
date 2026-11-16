/**
 * Exponential Moving Average (EMA) Calculator
 * Used as trend filter in SMA-based strategies
 */

/**
 * Calculate EMA for a given period
 * @param data Array of closing prices
 * @param period Integer period
 * @returns Array of EMA values (null where insufficient data)
 */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  if (period < 1 || !Number.isInteger(period)) {
    throw new Error(`EMA period must be a positive integer, got: ${period}`);
  }
  
  const result: (number | null)[] = new Array(data.length).fill(null);
  
  if (data.length < period) return result;
  
  // First EMA value = SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  
  const multiplier = 2 / (period + 1);
  result[period - 1] = sum / period;
  
  // Subsequent values use EMA formula
  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]!) * multiplier + result[i - 1]!;
  }
  
  return result;
}
