/**
 * Binance Public API Price Fetcher
 * Used as a third source for validating precious metal token prices (PAXG, etc.)
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

export async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    // Map internal symbols to Binance pairs
    const pairMap: Record<string, string> = {
      'GOLD': 'PAXGUSDT',
      'BTC': 'BTCUSDT',
      'ETH': 'ETHUSDT',
    };

    const binanceSymbol = pairMap[symbol.toUpperCase()];
    if (!binanceSymbol) return null;

    const response = await fetchProvider(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, {
      next: { revalidate: 60 }
    });

    if (!response.ok) return null;

    const data = await response.json() as { price?: unknown };
    return parsePositivePrice(data?.price);
  } catch (error) {
    console.error(`Binance fetch error for ${symbol}:`, error);
    return null;
  }
}
