import { NextResponse } from 'next/server';
import {
  MarketRequestValidationError,
  parseHistoryDays,
  parseMarketSymbols,
  parseQuoteCurrency,
} from '@/lib/api/market-request';
import {
  enforceRateLimit,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import { getAssetConfig } from '@/lib/config/supported-assets';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

/**
 * Compatibility endpoint for older consumers. The data now comes from the
 * same consolidated engine as `/api/prices/history`; close-only observations
 * never masquerade as sourced OHLC.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_HISTORY_RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const [symbol] = parseMarketSymbols(searchParams.get('symbol'), 'BTC', 1);
    const days = parseHistoryDays(searchParams.get('days'));
    const currency = parseQuoteCurrency(searchParams.get('currency'));
    if (getAssetConfig(symbol)?.assetClass !== 'crypto') {
      return NextResponse.json(
        { error: `Unknown symbol: ${symbol}` },
        { status: 400 },
      );
    }

    const history = await buildConsolidatedHistory(
      symbol,
      currency,
      '1d',
      false,
      request.signal,
    );
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const data = history.prices
      .filter((bar) => Date.parse(`${bar.date}T00:00:00.000Z`) >= cutoff.getTime())
      .map((bar) => ({
        date: bar.date,
        open: bar.quality === 'close_only' ? null : bar.open,
        high: bar.quality === 'close_only' ? null : bar.high,
        low: bar.quality === 'close_only' ? null : bar.low,
        close: bar.close,
        volume: bar.volumeAvailable === false ? null : bar.volume,
        dataQuality: bar.quality ?? 'ohlc',
      }));
    const status = data.length === 0
      ? 'unavailable'
      : history.cache?.status !== 'hit_stale'
        && history.freshness !== 'stale'
        && history.isComplete
        && data.every((bar) => bar.dataQuality === 'ohlc')
        ? 'complete'
        : 'partial';

    return NextResponse.json(
      {
        status,
        symbol,
        days,
        currency,
        data,
        provenance: history.provenance,
        warnings: history.warnings,
        cache: history.cache,
        freshness: history.freshness ?? 'unknown',
        latestObservationAt: history.latestObservationAt ?? null,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': history.cache?.status === 'hit_stale'
            || history.freshness === 'stale'
            ? 'no-store'
            : 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Crypto-history request failed');
    return NextResponse.json(
      { error: 'Historical market data is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
