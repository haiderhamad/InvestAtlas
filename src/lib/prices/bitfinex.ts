/**
 * Bitfinex Public API Price Fetcher
 * Excellent source for XAUT (Tether Gold) and occasionally silver tokens
 */

import { fetchProvider } from '@/lib/data/provider-fetch';

function parsePositivePrice(value: unknown): number | null {
  if (
    (typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function fetchBitfinexPrice(
  symbol: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const pairMap: Record<string, string> = {
      'GOLD': 'tXAUT:USD',
      'BTC': 'tBTCUSD',
      'ETH': 'tETHUSD',
    };

    const bitfinexSymbol = pairMap[symbol.toUpperCase()];
    if (!bitfinexSymbol) return null;

    const response = await fetchProvider(`https://api-pub.bitfinex.com/v2/ticker/${bitfinexSymbol}`, {
      cache: 'no-store',
      signal,
    });

    if (!response.ok) return null;

    const data = await response.json() as unknown;
    // Bitfinex ticker format: [BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_RELATIVE, LAST_PRICE, VOLUME, HIGH, LOW]
    return Array.isArray(data) ? parsePositivePrice(data[6]) : null;
  } catch {
    console.error(`Bitfinex request failed for ${symbol}`);
    return null;
  }
}
