'use client';

import {
  availableField,
  createMoney,
  unavailableField,
  type QuoteSnapshot,
} from '@/lib/financial-data/contracts';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from './showcase-snapshot';

const DEMO_PROVIDER_ID = 'investatlas_demo_snapshot';
const DEMO_PROVIDER_NAME = 'InvestAtlas synthetic showcase data';

function priceUnitFor(symbol: string): 'troy_ounce' | 'unit' {
  return INVESTATLAS_SHOWCASE_SNAPSHOT.assets.find(
    (asset) => asset.symbol === symbol,
  )?.assetClass === 'metal' ? 'troy_ounce' : 'unit';
}

function apiPrice(symbol: string, price: number): number {
  // The stored fixture uses fine grams; all shared metal quote consumers use
  // the provider contract of pure-metal prices per troy ounce.
  return priceUnitFor(symbol) === 'troy_ounce' ? price * TROY_OUNCE_GRAMS : price;
}

function demoProvenance(symbol: string) {
  return {
    providerId: DEMO_PROVIDER_ID,
    providerName: DEMO_PROVIDER_NAME,
    retrievedAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.publishedAt,
    method: `Synthetic snapshot ${INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.datasetVersion}; EUR per ${priceUnitFor(symbol) === 'troy_ounce' ? 'troy ounce of fine metal' : 'instrument unit'}`,
  };
}

function demoMoneyField(symbol: string, value: number) {
  return availableField(createMoney(apiPrice(symbol, value), 'EUR'), {
    quality: 'demo',
    freshness: 'unknown',
    observedAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
    asOf: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
    provenance: demoProvenance(symbol),
    limitations: ['synthetic'],
  });
}

function demoNumberField(symbol: string, value: number | null) {
  return value === null
    ? unavailableField('not_provided')
    : availableField(value, {
        quality: 'demo',
        freshness: 'unknown',
        observedAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
        asOf: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
        provenance: demoProvenance(symbol),
        limitations: ['synthetic'],
      });
}

function quoteFor(symbol: string): (CurrentPriceSnapshot & { priceUnit: 'troy_ounce' | 'unit' }) | null {
  const series = INVESTATLAS_SHOWCASE_SNAPSHOT.history[symbol];
  if (!series || symbol === 'EUR') return null;
  const latest = series.points.at(-1);
  const previous = series.points.at(-2);
  if (!latest || !previous || previous.close <= 0) return null;

  const changePercent = ((latest.close - previous.close) / previous.close) * 100;
  const fields: QuoteSnapshot = {
    assetId: symbol,
    listingCurrency: 'EUR',
    outputCurrency: 'EUR',
    price: demoMoneyField(symbol, latest.close),
    previousClose: demoMoneyField(symbol, previous.close),
    changePercent: demoNumberField(symbol, changePercent),
    volume: demoNumberField(symbol, latest.volume),
    marketCap: unavailableField('not_provided'),
    // The snapshot contains 90 days, not a full 52-week observation window.
    // Do not relabel its range as an annual high/low.
    yearHigh: unavailableField('not_provided'),
    yearLow: unavailableField('not_provided'),
  };

  return {
    price: apiPrice(symbol, latest.close),
    priceUnit: priceUnitFor(symbol),
    change24h: changePercent,
    volume24h: latest.volume,
    marketCap: null,
    yearHigh: fields.yearHigh.status === 'available'
      ? fields.yearHigh.value.amount
      : null,
    yearLow: fields.yearLow.status === 'available'
      ? fields.yearLow.value.amount
      : null,
    displayName: INVESTATLAS_SHOWCASE_SNAPSHOT.assets.find(
      (asset) => asset.symbol === symbol,
    )?.name,
    instrumentType: INVESTATLAS_SHOWCASE_SNAPSHOT.assets.find(
      (asset) => asset.symbol === symbol,
    )?.assetClass ?? null,
    verified: false,
    source: DEMO_PROVIDER_NAME,
    currency: 'eur',
    dataStatus: 'partial',
    changePeriod: 'session',
    fields,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-InvestAtlas-Data-Mode': 'demo_snapshot',
    },
  });
}

function currentQuoteResponse(url: URL): Response {
  const currency = url.searchParams.get('currency')?.toLowerCase() ?? 'eur';
  if (currency !== 'eur') {
    return response({
      status: 'unavailable',
      prices: {},
      timestamp: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
      dataMode: 'demo_snapshot',
      refreshPolicy: 'manual_only',
      synthetic: true,
      realtime: false,
      error: 'The synthetic snapshot is available in EUR only.',
    }, 422);
  }

  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);
  const prices = Object.fromEntries(
    symbols.flatMap((symbol) => {
      const quote = quoteFor(symbol);
      return quote ? [[symbol, quote]] : [];
    }),
  );

  return response({
    // Demo quotes intentionally omit fundamentals and annual-range metrics.
    status: Object.keys(prices).length > 0 ? 'partial' : 'unavailable',
    prices,
    timestamp: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
    dataMode: 'demo_snapshot',
    refreshPolicy: 'manual_only',
    datasetVersion: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.datasetVersion,
    synthetic: true,
    realtime: false,
    source: DEMO_PROVIDER_NAME,
  });
}

function historyResponse(url: URL): Response {
  const symbol = url.searchParams.get('symbol')?.trim().toUpperCase();
  const currency = url.searchParams.get('currency')?.toLowerCase() ?? 'eur';
  const interval = url.searchParams.get('interval')?.toLowerCase() ?? '1d';
  const series = symbol
    ? INVESTATLAS_SHOWCASE_SNAPSHOT.history[symbol]
    : undefined;
  if (!symbol || !series || currency !== 'eur' || interval !== '1d') {
    return response({
      contractVersion: 'history.v2',
      status: 'unavailable',
      symbol: symbol ?? null,
      currency,
      prices: [],
      sources: [],
      dataMode: 'demo_snapshot',
      synthetic: true,
      realtime: false,
    }, 422);
  }

  return response({
    contractVersion: 'history.v2',
    status: 'partial',
    symbol,
    currency: 'eur',
    priceUnit: priceUnitFor(symbol),
    prices: series.points.map((point) => ({
      ...point,
      open: apiPrice(symbol, point.open),
      high: apiPrice(symbol, point.high),
      low: apiPrice(symbol, point.low),
      close: apiPrice(symbol, point.close),
      dataQuality: 'demo',
      priceQuality: 'demo',
      sourceRef: 'demo_1',
    })),
    sources: [{
      ref: 'demo_1',
      kind: 'market',
      ...demoProvenance(symbol),
    }],
    provenance: [{
      startDate: series.points[0]?.date ?? '',
      endDate: series.points.at(-1)?.date ?? '',
      providerId: DEMO_PROVIDER_ID,
      providerName: DEMO_PROVIDER_NAME,
      role: 'synthetic_showcase_snapshot',
      dataPoints: series.points.length,
      status: 'partial',
      retrievedAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.publishedAt,
    }],
    warnings: [
      'Synthetic 90-day showcase series. Not real-time or complete market history.',
    ],
    cache: { status: 'miss' },
    freshness: 'unknown',
    latestObservationAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
    isComplete: false,
    generatedAt: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.publishedAt,
    dataMode: 'demo_snapshot',
    datasetVersion: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.datasetVersion,
    synthetic: true,
    realtime: false,
  });
}

function athResponse(url: URL): Response {
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);
  const prices = Object.fromEntries(symbols.flatMap((symbol) => {
    const series = INVESTATLAS_SHOWCASE_SNAPSHOT.history[symbol];
    if (!series) return [];
    const latest = series.points.at(-1);
    if (!latest) return [];
    return [[symbol, {
      price: apiPrice(symbol, latest.close),
      priceUnit: priceUnitFor(symbol),
      // A 90-day synthetic range cannot establish an all-time high.
      ath: null,
      athDate: null,
      athValDropPct: null,
      freshness: 'unknown',
      asOf: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
      quality: 'demo',
      synthetic: true,
      limitation: 'all_time_high_unavailable',
    }]];
  }));
  return response({
    status: Object.keys(prices).length > 0 ? 'partial' : 'unavailable',
    prices,
    currency: 'eur',
    timestamp: INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf,
    source: DEMO_PROVIDER_NAME,
    dataMode: 'demo_snapshot',
    synthetic: true,
    realtime: false,
  });
}

export function handleDemoFinancialRequest(
  input: RequestInfo | URL,
): Response | null {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === '/api/prices/current') return currentQuoteResponse(url);
  if (url.pathname === '/api/prices/history') return historyResponse(url);
  if (url.pathname === '/api/prices/ath') return athResponse(url);
  return null;
}
