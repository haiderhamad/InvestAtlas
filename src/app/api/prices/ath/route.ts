import { NextResponse } from 'next/server';
import { symbolToCoinGeckoId } from '@/lib/prices/coingecko';
import {
  MarketRequestValidationError,
  parseMarketSymbols,
  parseQuoteCurrency,
} from '@/lib/api/market-request';
import { fetchProvider } from '@/lib/data/provider-fetch';
import {
  enforceRateLimit,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const MAX_CURRENT_PRICE_AGE_MS = 5 * 60_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 5 * 60_000;

interface CoinGeckoMarketEntry {
  id: string;
  current_price?: number;
  ath?: number;
  ath_date?: string;
  last_updated?: string;
}

/**
 * GET /api/prices/ath?symbols=BTC,ETH,SOL
 * Returns current prices AND all-time-high data from CoinGecko.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_HISTORY_RATE_LIMIT);
  if (limited) return limited;

  if (!isFinancialDataProviderActive('coingecko_public')) {
    return NextResponse.json(
      {
        status: 'unavailable',
        prices: {},
        error: 'Market data is temporarily unavailable',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const symbols = parseMarketSymbols(
      searchParams.get('symbols'),
      'BTC,ETH,SOL',
    );
    const vsCurrency = parseQuoteCurrency(searchParams.get('currency'));

    // Map symbols to CoinGecko IDs
    const coinIds: string[] = [];
    const symbolToId: Record<string, string> = {};
    for (const sym of symbols) {
      const id = symbolToCoinGeckoId(sym);
      if (id) {
        coinIds.push(id);
        symbolToId[sym] = id;
      }
    }

    if (coinIds.length === 0) {
      return NextResponse.json({ error: 'No valid symbols provided' }, { status: 400 });
    }

    const ids = coinIds.join(',');
    const url = `${COINGECKO_API}/coins/markets?vs_currency=${vsCurrency}&ids=${ids}`;

    const response = await fetchProvider(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 300 }, // Cache for 5 minutes (ATH doesn't change every second)
    });

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json({ error: 'Rate limit reached. Try again in a minute.' }, { status: 429 });
      }
      throw new Error(`CoinGecko error: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoMarketEntry[];

    const prices: Record<string, {
      price: number;
      ath: number | null;
      athDate: string | null;
      athValDropPct: number | null;
      freshness: 'fresh';
      asOf: string;
    }> = {};
    const now = Date.now();

    // Coingecko returns an array of objects
    for (const [sym, cgId] of Object.entries(symbolToId)) {
      const coinData = data.find((coin) => coin.id === cgId);
      if (coinData) {
        const curPrice = coinData.current_price;
        if (
          typeof curPrice !== 'number'
          || !Number.isFinite(curPrice)
          || curPrice <= 0
        ) {
          continue;
        }
        const observedAt = typeof coinData.last_updated === 'string'
          ? Date.parse(coinData.last_updated)
          : Number.NaN;
        const age = now - observedAt;
        if (
          !Number.isFinite(observedAt)
          || age < -MAX_PROVIDER_CLOCK_SKEW_MS
          || age > MAX_CURRENT_PRICE_AGE_MS
        ) {
          continue;
        }
        const ath =
          typeof coinData.ath === 'number'
          && Number.isFinite(coinData.ath)
          && coinData.ath > 0
            ? coinData.ath
            : null;
        const athDate =
          typeof coinData.ath_date === 'string'
          && Number.isFinite(Date.parse(coinData.ath_date))
            ? coinData.ath_date
            : null;
        const athDrop = ath === null ? null : ((curPrice - ath) / ath) * 100;
        
        prices[sym] = {
          price: curPrice,
          ath: ath,
          athDate,
          athValDropPct: athDrop,
          freshness: 'fresh',
          asOf: new Date(observedAt).toISOString(),
        };
      }
    }

    const availableCount = Object.keys(prices).length;
    if (availableCount === 0) {
      return NextResponse.json(
        {
          status: 'unavailable',
          prices: {},
          currency: vsCurrency,
          error: 'Market data is temporarily unavailable',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    return NextResponse.json({
      status: availableCount === coinIds.length ? 'complete' : 'partial',
      prices,
      currency: vsCurrency,
      timestamp: new Date().toISOString(),
      source: 'CoinGecko',
      sourceAttribution: 'Powered by CoinGecko API',
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, must-revalidate',
      },
    });
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('ATH market-data request failed');
    return NextResponse.json(
      { error: 'Market data is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
