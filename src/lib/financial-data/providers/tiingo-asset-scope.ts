import { getAssetConfig } from '@/lib/config/supported-assets';

// Shared exact allowlist for the per-user Tiingo BYOK client and server.
// Separate crypto pairs use Tiingo's documented Crypto Prices endpoint.
const SYMBOLS = new Set([
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA',
  'HLAL', 'UMMA', 'SPUS', 'SPWO', 'SPTE', 'SPRE',
  'BTC', 'ETH',
]);

export function supportsPersonalTiingoAsset(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  const asset = getAssetConfig(normalized);
  return SYMBOLS.has(normalized)
    && Boolean(asset && ['stock', 'etf', 'crypto'].includes(asset.assetClass) && asset.nativeCurrency === 'usd');
}
