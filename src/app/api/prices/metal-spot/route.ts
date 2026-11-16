import { NextResponse } from 'next/server';
import { getAssetConfig } from '@/lib/config/supported-assets';
import { fetchYahooCurrentQuote, fetchYahooHistoricalBars } from '@/lib/prices/yahoo';
import {
  MarketRequestValidationError,
  parseIsoDate,
  parseQuoteCurrency,
} from '@/lib/api/market-request';
import {
  enforceRateLimit,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';

const MAX_NEAREST_TRADING_DAY_DISTANCE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * GET /api/prices/metal-spot?symbol=GOLD&date=2025-06-15&currency=eur
 *
 * Returns the spot price per troy ounce for the given metal on the given
 * date (or today if omitted).  The caller is responsible for applying the
 * purity ratio and converting oz → gram.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_HISTORY_RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'GOLD').toUpperCase();
    const dateParam = parseIsoDate(searchParams.get('date'));
    const currency = parseQuoteCurrency(searchParams.get('currency'));

    const assetConfig = getAssetConfig(symbol);
    if (!assetConfig || assetConfig.assetClass !== 'metal') {
      return NextResponse.json({ error: `Unknown metal symbol: ${symbol}` }, { status: 400 });
    }

    const yahooSymbol = assetConfig.yahooSymbol;
    if (!yahooSymbol) {
      return NextResponse.json({ error: `No Yahoo symbol for ${symbol}` }, { status: 400 });
    }
    const yahooSymbols = [yahooSymbol, assetConfig.yahooFallbackSymbol].filter(Boolean) as string[];

    // No date or date is today → use current quote
    const today = new Date().toISOString().split('T')[0];
    if (dateParam && dateParam > today) {
      throw new MarketRequestValidationError('Future dates are not supported');
    }
    const isToday = !dateParam || dateParam === today;

    if (isToday) {
      const quote = await fetchYahooCurrentQuote(yahooSymbols, currency);
      if (
        quote.marketFreshness !== 'fresh'
        || quote.fx.freshness !== 'fresh'
      ) {
        return NextResponse.json(
          { error: 'Current metal market data is temporarily unavailable' },
          {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      }
      return NextResponse.json({
        symbol,
        date: today,
        spotPricePerOz: quote.price,
        currency,
        source: 'Yahoo Finance (current)',
        freshness: 'fresh',
        asOf: quote.asOf,
      });
    }

    // Historical date — fetch chart data around that date
    const targetDateStr = dateParam!;
    
    // Use the robust helper that supports fallbacks and historical FX conversion
    const historicalData = await fetchYahooHistoricalBars(yahooSymbols, currency);
    const bars = historicalData.bars;

    if (!bars || bars.length === 0) {
      throw new Error(`No historical data found for ${symbol}`);
    }

    // Use only the latest completed trading day on or before the requested
    // transaction date; a later market observation would be look-ahead data.
    const targetMs = new Date(`${targetDateStr}T12:00:00Z`).getTime();
    const eligibleBars = bars
      .map((bar) => ({
        bar,
        timestamp: Date.parse(`${bar.date}T12:00:00.000Z`),
      }))
      .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= targetMs)
      .sort((left, right) => right.timestamp - left.timestamp);
    const selected = eligibleBars[0];
    const bestDistance = selected ? targetMs - selected.timestamp : Infinity;

    if (
      !selected
      || bestDistance > MAX_NEAREST_TRADING_DAY_DISTANCE_MS
    ) {
      return NextResponse.json(
        { error: 'No historical market data is available near the requested date' },
        {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const spotPrice = selected.bar.close;
    const actualDate = selected.bar.date;

    return NextResponse.json({
      symbol,
      date: actualDate,
      requestedDate: dateParam,
      spotPricePerOz: Number(spotPrice.toFixed(4)),
      currency,
      source: 'Yahoo Finance (historical via bars)',
    });
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Metal spot-price request failed');
    return NextResponse.json(
      { error: 'Metal market data is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
