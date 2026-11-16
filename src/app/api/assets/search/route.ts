import { NextResponse } from 'next/server';
import {
  SUPPORTED_ASSETS,
  getAssetSearchTokens,
  getAssetTickers,
  normalizeAssetIdentifier,
  type AssetClass,
  type AssetConfig,
} from '@/lib/config/supported-assets';
import {
  MarketRequestValidationError,
  parseAssetSearchQuery,
} from '@/lib/api/market-request';
import {
  enforceRateLimit,
  PUBLIC_SEARCH_RATE_LIMIT,
} from '@/lib/api/rate-limit';

type AssetSearchResult = {
  id: string;
  symbol: string;
  canonicalSymbol?: string;
  name: string;
  type: AssetClass;
  exchange: string;
  source: string;
  thumb?: string;
  alreadyExists?: boolean;
  isin?: string;
  wkn?: string;
  tickers?: string[];
};

function toCuratedResult(asset: AssetConfig, source: string, exchange = 'InvestAtlas'): AssetSearchResult {
  return {
    id: `curated-${asset.symbol}`,
    symbol: asset.symbol,
    canonicalSymbol: asset.symbol,
    name: asset.name,
    type: asset.assetClass,
    exchange,
    source,
    alreadyExists: true,
    isin: asset.isin,
    wkn: asset.wkn,
    tickers: getAssetTickers(asset),
  };
}

function matchesAssetQuery(asset: AssetConfig, query: string): boolean {
  const normalizedQuery = normalizeAssetIdentifier(query);
  const lowerQuery = query.trim().toLowerCase();

  return getAssetSearchTokens(asset).some((token) => {
    const lowerToken = token.toLowerCase();
    const normalizedToken = normalizeAssetIdentifier(token);
    return lowerToken.includes(lowerQuery) || normalizedToken.includes(normalizedQuery);
  });
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_SEARCH_RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const query = parseAssetSearchQuery(searchParams.get('query'));

    const results: AssetSearchResult[] = [];
    const seen = new Set<string>();
    const pushResult = (result: AssetSearchResult) => {
      const canonical = result.canonicalSymbol ?? result.symbol;
      const key = `${result.type}-${normalizeAssetIdentifier(canonical)}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(result);
    };

    SUPPORTED_ASSETS
      .filter((asset) => matchesAssetQuery(asset, query))
      .slice(0, 8)
      .forEach((asset) => pushResult(toCuratedResult(asset, 'universe')));

    return NextResponse.json(
      { results },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        },
      },
    );
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Asset search request failed');
    return NextResponse.json(
      { error: 'Asset search is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
