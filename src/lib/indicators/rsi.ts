/**
 * Relative Strength Index (RSI) Calculator
 * Used as overbought/oversold filter in SMA-based strategies
 */

/**
 * Calculate RSI
 * @param data Closing prices
 * @param period RSI period (default 14)
 * @returns Array of RSI values (0-100, null where insufficient data)
 */
export function calculateRSI(data: number[], period: number = 14): (number | null)[] {
  if (period < 1 || !Number.isInteger(period)) {
    throw new Error(`RSI period must be a positive integer, got: ${period}`);
  }
  
  const result: (number | null)[] = new Array(data.length).fill(null);
  
  if (data.length < period + 1) return result;
  
  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  
  // First average gain and loss
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  // First RSI
  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - (100 / (1 + rs));
  }
  
  // Subsequent values using smoothed averages
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      result[i + 1] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i + 1] = 100 - (100 / (1 + rs));
    }
  }
  
  return result;
}

/**
 * Check if RSI indicates overbought condition
 */
export function isOverbought(rsi: number | null, threshold: number = 70): boolean | null {
  if (rsi === null) return null;
  return rsi >= threshold;
}

/**
 * Check if RSI indicates oversold condition
 */
export function isOversold(rsi: number | null, threshold: number = 30): boolean | null {
  if (rsi === null) return null;
  return rsi <= threshold;
}
