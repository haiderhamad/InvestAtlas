import type { QuoteCurrency } from '@/lib/config/supported-assets';

/**
 * Convert an explicitly USD-denominated fallback quote. USDT and other stable
 * assets must not use this helper because a peg is not an FX observation.
 */
export function convertUsdFallbackPrice(
  value: number | null,
  targetCurrency: QuoteCurrency,
  usdToTargetRate: number | null,
): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (targetCurrency === 'usd') {
    return value;
  }

  if (
    usdToTargetRate === null
    || !Number.isFinite(usdToTargetRate)
    || usdToTargetRate <= 0
  ) {
    return null;
  }

  return value * usdToTargetRate;
}
