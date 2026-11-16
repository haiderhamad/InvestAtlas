import { NextResponse } from 'next/server';
import { fetchYahooHistoricalBars } from '@/lib/prices/yahoo';
import { BENCHMARK_OPTIONS } from '@/lib/portfolio/benchmark-options';
import {
  MarketRequestValidationError,
  parseQuoteCurrency,
  requireAllowlistedValue,
} from '@/lib/api/market-request';
import {
  enforceRateLimit,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import { evaluateHistoryRecency } from '@/lib/financial-data/history/recency';

const ALLOWED_YAHOO_BENCHMARKS = new Set(
  BENCHMARK_OPTIONS.flatMap((option) =>
    option.yahooSymbol ? [option.yahooSymbol] : [],
  ),
);

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_HISTORY_RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(req.url);
    const yahooSymbol = requireAllowlistedValue(
      searchParams.get('yahooSymbol'),
      ALLOWED_YAHOO_BENCHMARKS,
      'benchmark',
    );
    const currency = parseQuoteCurrency(searchParams.get('currency'));
    const result = await fetchYahooHistoricalBars(
      yahooSymbol,
      currency,
      undefined,
      req.signal,
    );
    const recency = evaluateHistoryRecency(
      result.bars,
      '1d',
      'stock',
    );
    if (result.bars.length === 0 || recency.freshness === 'stale') {
      return NextResponse.json(
        {
          status: 'unavailable',
          error: 'Benchmark data is temporarily unavailable',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }
    return NextResponse.json({
      status: 'complete',
      yahooSymbol,
      prices: result.bars.map((bar) => ({
        date: bar.date,
        close: bar.close,
      })),
      freshness: 'fresh',
      latestObservationAt: recency.latestObservationAt,
      provenance: {
        providerId: 'yahoo_finance',
        providerName: 'Yahoo Finance',
        retrievedAt: result.bars.at(-1)?.retrievedAt ?? null,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Benchmark-history request failed');
    return NextResponse.json(
      { error: 'Benchmark data is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
