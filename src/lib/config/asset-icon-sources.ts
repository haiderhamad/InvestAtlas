import type { AssetClass } from '@/lib/config/supported-assets';

/**
 * Asset display imagery, not a market-data source.
 * - Crypto: version-pinned CC0-1.0 cryptocurrency-icons distribution.
 * - Stocks/ETFs: always render a neutral, ticker-labeled tile in the UI.
 *   No company logo requests, trademarks, or arbitrary stored image URLs.
 * - Metals: drawn from the installed ISC-licensed Lucide icon set in UI.
 * Unsupported tickers return null so callers use a local accessible fallback.
 */
export function getAssetIconUrl(symbol: string, assetClass: AssetClass): string | null {
  const ticker = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(ticker)) return null;
  if (assetClass === 'crypto') {
    return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${ticker.toLowerCase()}.svg`;
  }
  return null;
}
