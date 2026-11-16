/**
 * Volume Moving Average Indicator
 * Calculates volume MA to filter out buy signals during low-volume periods
 */

/**
 * Calculate SMA of volume data
 * @param volumes Array of volume values
 * @param period MA period (e.g., 20)
 * @returns Array of volume MA values (null where insufficient data)
 */
export function calculateVolumeMA(volumes: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(volumes.length).fill(null);
  if (volumes.length < period) return result;

  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < period; i++) {
    if (volumes[i] != null) {
      sum += volumes[i]!;
      validCount++;
    }
  }

  if (validCount === period) {
    result[period - 1] = sum / period;
  }

  for (let i = period; i < volumes.length; i++) {
    const oldVal = volumes[i - period];
    const newVal = volumes[i];

    if (oldVal != null && newVal != null) {
      sum = sum - oldVal + newVal;
      result[i] = sum / period;
    } else {
      // Recalculate from scratch if nulls are encountered
      let s = 0;
      let c = 0;
      for (let j = i - period + 1; j <= i; j++) {
        if (volumes[j] != null) { s += volumes[j]!; c++; }
      }
      result[i] = c === period ? s / period : null;
    }
  }

  return result;
}

/**
 * Check if current volume is above the MA threshold
 * @param volume Current volume
 * @param avgVolume Volume MA value
 * @param threshold Multiplier (1.0 = equal to MA, 1.5 = 50% above MA)
 */
export function isVolumeAboveMA(volume: number | null, avgVolume: number | null, threshold: number): boolean {
  if (volume == null || avgVolume == null || avgVolume === 0) return true; // Pass through if data missing
  return volume >= avgVolume * threshold;
}
