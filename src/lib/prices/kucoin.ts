/**
 * KuCoin Public API Price Fetcher
 * Used as a third source for validating Silver (KAG)
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

export async function fetchKuCoinPrice(symbol: string): Promise<number | null> {
  try {
    // Map internal symbols to KuCoin pairs
    const pairMap: Record<string, string> = {
      'SILVER': 'KAG-USDT',
      'KAG': 'KAG-USDT',
      'BTC': 'BTC-USDT',
    };

    const kucoinSymbol = pairMap[symbol.toUpperCase()];
    if (!kucoinSymbol) return null;

    const response = await fetchProvider(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kucoinSymbol}`, {
      next: { revalidate: 60 }
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      code?: unknown;
      data?: { price?: unknown };
    };
    if (data.code !== '200000') return null;

    return parsePositivePrice(data.data?.price);
  } catch (error) {
    console.error(`KuCoin fetch error for ${symbol}:`, error);
    return null;
  }
}
