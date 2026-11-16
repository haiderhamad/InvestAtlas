'use client';

import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { getAssetConfig } from '@/lib/config/supported-assets';
import {
  availableField,
  createMoney,
  unavailableField,
  type CurrencyCode,
  type FieldProvenance,
  type QuoteSnapshot,
} from '@/lib/financial-data/contracts';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';
import {
  AlphaVantageBrowserError,
  loadAlphaVantageDailySeries,
  supportsAlphaVantageBrowserAsset,
  type AlphaVantageDailySeries,
} from './alpha-vantage-browser';

const CURRENT_PATH = '/api/prices/current';
const HISTORY_PATH = '/api/prices/history';
const MAX_SYMBOLS = 25;
const CONCURRENCY = 2;
// Match the conservative seven-day maximum used for ECB reference-rate age.
// Never carry a historical FX observation through an unbounded provider gap.
const MAX_HISTORICAL_FX_CARRY_DAYS = 7;
const DAY_MS = 86_400_000;
const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/;

type FxRate = {
  value: number;
  observedAt: string | null;
  asOf: string | null;
  provenance: FieldProvenance;
};

type HistoryFxRow = {
  date: string;
  rate: number;
  asOf: string;
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json',
      'X-InvestAtlas-Data-Mode': 'personal_provider',
    },
  });
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.href);
    return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
}

function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function outputCurrency(value: QuoteCurrency): CurrencyCode {
  return value.toUpperCase() as CurrencyCode;
}

function providerProvenance(series: AlphaVantageDailySeries): FieldProvenance {
  return {
    providerId: series.providerId,
    providerName: 'Alpha Vantage (personal EOD)',
    retrievedAt: series.retrievedAt,
    method: 'unadjusted daily historical close from the user-owned provider account',
  };
}

async function fetchCurrentFx(signal?: AbortSignal): Promise<FxRate | null> {
  try {
    const response = await fetch('/api/financial-data/fx?from=USD&to=EUR', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      data?: { baseCurrency?: unknown; quoteCurrency?: unknown; rate?: unknown };
    };
    const rate = payload.data?.rate as {
      status?: unknown;
      value?: unknown;
      freshness?: unknown;
      observedAt?: unknown;
      asOf?: unknown;
      provenance?: unknown;
    } | undefined;
    const referenceAt = parseIsoDate(rate?.asOf);
    const provenance = rate?.provenance as Partial<FieldProvenance> | undefined;
    if (
      payload.data?.baseCurrency !== 'USD'
      || payload.data?.quoteCurrency !== 'EUR'
      || rate?.status !== 'available'
      || rate.freshness !== 'fresh'
      || typeof rate.value !== 'number'
      || !Number.isFinite(rate.value)
      || rate.value <= 0
      || referenceAt === null
      || referenceAt > Date.now()
      || Date.now() - referenceAt > MAX_HISTORICAL_FX_CARRY_DAYS * DAY_MS
      || !provenance
      || provenance.providerId !== 'ecb_reference_rates'
    ) return null;
    return {
      value: rate.value,
      observedAt: typeof rate.observedAt === 'string' ? rate.observedAt : null,
      asOf: typeof rate.asOf === 'string' ? rate.asOf : null,
      provenance: rate.provenance as FieldProvenance,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

async function fetchHistoryFx(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<HistoryFxRow[] | null> {
  try {
    const params = new URLSearchParams({
      from: 'USD',
      to: 'EUR',
      startDate,
      endDate,
    });
    const response = await fetch(`/api/financial-data/fx/history?${params}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data) || payload.data.length > 400) return null;
    const rows: HistoryFxRow[] = [];
    const seenDates = new Set<string>();
    for (const value of payload.data) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const row = value as Partial<HistoryFxRow>;
      if (
        parseIsoDate(row.date) === null
        || row.asOf !== row.date
        || row.date! > endDate
        || typeof row.rate !== 'number'
        || !Number.isFinite(row.rate)
        || row.rate <= 0
        || seenDates.has(row.date!)
      ) return null;
      seenDates.add(row.date!);
      rows.push({ date: row.date!, asOf: row.asOf!, rate: row.rate });
    }
    return rows.length > 0
      ? rows.sort((left, right) => left.date.localeCompare(right.date))
      : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

async function allSettledBounded<T, R>(
  values: readonly T[],
  worker: (value: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(values[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(CONCURRENCY, Math.max(1, values.length)) },
    () => run(),
  ));
  return results;
}

function parseSymbols(raw: string | null): string[] | null {
  if (!raw) return null;
  const values = [...new Set(raw.split(',').map((symbol) => symbol.trim().toUpperCase()))];
  if (
    values.length < 1
    || values.length > MAX_SYMBOLS
    || values.some((symbol) => !SYMBOL_PATTERN.test(symbol) || !getAssetConfig(symbol))
  ) return null;
  return values;
}

function parseCurrency(raw: string | null): QuoteCurrency | null {
  const value = (raw ?? 'eur').trim().toLowerCase();
  return value === 'eur' || value === 'usd' ? value : null;
}

function convert(amount: number, currency: QuoteCurrency, fx: FxRate | null): number | null {
  if (currency === 'usd') return amount;
  return fx ? amount * fx.value : null;
}

function quoteFromSeries(
  series: AlphaVantageDailySeries,
  currency: QuoteCurrency,
  fx: FxRate | null,
): CurrentPriceSnapshot | null {
  const latest = series.bars.at(-1);
  if (!latest) return null;
  const price = convert(latest.close, currency, fx);
  if (price === null) return null;
  const code = outputCurrency(currency);
  const marketSource = providerProvenance(series);
  const converted = currency === 'eur';
  const priceProvenance: FieldProvenance = converted && fx
    ? {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt: series.retrievedAt,
        method: 'Alpha Vantage EOD value multiplied by sourced ECB reference FX',
        derivedFrom: [marketSource, fx.provenance],
      }
    : marketSource;
  const fields: QuoteSnapshot = {
    assetId: series.assetSymbol,
    listingCurrency: 'USD',
    outputCurrency: code,
    price: availableField(createMoney(price, code), {
      quality: converted ? 'calculated' : 'observed',
      freshness: 'fresh',
      observedAt: latest.date,
      asOf: latest.date,
      provenance: priceProvenance,
      limitations: ['single_source', 'delayed'],
    }),
    // TIME_SERIES_DAILY is raw/unadjusted. A two-close percentage can be
    // materially wrong around corporate actions, so v1.2.4 fails closed.
    previousClose: unavailableField('not_provided'),
    changePercent: unavailableField('not_provided'),
    volume: availableField(latest.volume, {
      quality: 'observed',
      freshness: 'fresh',
      observedAt: latest.date,
      asOf: latest.date,
      provenance: marketSource,
      limitations: ['single_source', 'delayed'],
    }),
    marketCap: unavailableField('not_provided'),
    yearHigh: unavailableField('not_provided'),
    yearLow: unavailableField('not_provided'),
  };
  return {
    price,
    change24h: null,
    volume24h: latest.volume,
    marketCap: null,
    yearHigh: null,
    yearLow: null,
    displayName: getAssetConfig(series.assetSymbol)?.name,
    instrumentType: getAssetConfig(series.assetSymbol)?.assetClass ?? null,
    verified: false,
    source: 'Alpha Vantage (personal EOD)',
    currency,
    dataStatus: 'partial',
    changePeriod: 'unavailable',
    fields,
    dataMode: series.cacheStatus === 'miss' ? 'personal_provider' : 'cached_personal',
    priceTiming: 'end_of_day',
    realtime: false,
  };
}

async function handleCurrent(url: URL, userId: string, signal?: AbortSignal): Promise<Response> {
  const symbols = parseSymbols(url.searchParams.get('symbols'));
  const currency = parseCurrency(url.searchParams.get('currency'));
  if (!symbols || !currency) return json({ error: 'Invalid current-price request' }, 400);
  const supported = symbols.filter(supportsAlphaVantageBrowserAsset);
  const prices: Record<string, CurrentPriceSnapshot> = {};
  const issues: Array<{
    symbol: string;
    code: 'provider_unavailable' | 'fx_unavailable';
  }> = symbols
    .filter((symbol) => !supportsAlphaVantageBrowserAsset(symbol))
    .map((symbol) => ({ symbol, code: 'provider_unavailable' as const }));
  const fx = currency === 'eur' && supported.length > 0
    ? await fetchCurrentFx(signal)
    : null;
  if (currency === 'eur' && !fx) {
    issues.push(...supported.map((symbol) => ({ symbol, code: 'fx_unavailable' as const })));
  } else {
    const outcomes = await allSettledBounded(supported, (symbol) =>
      loadAlphaVantageDailySeries(userId, symbol, signal)
    );
    outcomes.forEach((outcome, index) => {
      const symbol = supported[index];
      const quote = outcome.status === 'fulfilled'
        ? quoteFromSeries(outcome.value, currency, fx)
        : null;
      if (quote) prices[symbol] = quote;
      else issues.push({ symbol, code: 'provider_unavailable' });
    });
  }
  const available = Object.keys(prices).length;
  const dataModes = new Set(Object.values(prices).map((price) => price.dataMode));
  return json({
    status: available === 0 ? 'unavailable' : 'partial',
    prices,
    currency,
    timestamp: new Date().toISOString(),
    source: available > 0 ? 'Alpha Vantage (personal EOD)' : 'n/a',
    issues: issues.length > 0 ? issues : undefined,
    verificationLogs: undefined,
    dataMode: dataModes.size === 1 && dataModes.has('cached_personal')
      ? 'cached_personal'
      : 'personal_provider',
    refreshPolicy: 'manual_only',
    priceTiming: 'end_of_day',
    realtime: false,
    synthetic: false,
  });
}

function resolveHistoricalFx(rows: HistoryFxRow[], date: string): HistoryFxRow | null {
  const marketAt = parseIsoDate(date);
  if (marketAt === null) return null;
  let resolved: HistoryFxRow | null = null;
  for (const row of rows) {
    if (row.date > date) break;
    resolved = row;
  }
  if (!resolved) return null;
  const referenceAt = parseIsoDate(resolved.date);
  const ageMs = referenceAt === null ? -1 : marketAt - referenceAt;
  return ageMs >= 0 && ageMs <= MAX_HISTORICAL_FX_CARRY_DAYS * DAY_MS
    ? resolved
    : null;
}

function unavailableHistory(symbol: string, currency: QuoteCurrency, warning: string): Response {
  return json({
    contractVersion: 'history.v2',
    status: 'unavailable',
    symbol,
    currency,
    prices: [],
    sources: [],
    provenance: [],
    warnings: [warning],
    cache: { status: 'miss' },
    freshness: 'unknown',
    latestObservationAt: null,
    isComplete: false,
    generatedAt: new Date().toISOString(),
    dataMode: 'personal_provider',
    synthetic: false,
    realtime: false,
  });
}

async function handleHistory(url: URL, userId: string, signal?: AbortSignal): Promise<Response> {
  const requested = url.searchParams.get('symbol')?.trim().toUpperCase() ?? '';
  const asset = getAssetConfig(requested);
  const currency = parseCurrency(url.searchParams.get('currency'));
  const interval = (url.searchParams.get('interval') ?? '1d').trim().toLowerCase();
  if (!asset || !currency || interval !== '1d') {
    return json({ error: 'Unsupported personal-provider history request' }, 400);
  }
  if (!supportsAlphaVantageBrowserAsset(asset.symbol)) {
    return unavailableHistory(asset.symbol, currency, 'This asset is not supported by the personal Alpha Vantage connector.');
  }
  let series: AlphaVantageDailySeries;
  try {
    series = await loadAlphaVantageDailySeries(
      userId,
      asset.symbol,
      signal,
      { allowStale: true },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return unavailableHistory(asset.symbol, currency, 'No session key or usable personal cache can supply this history.');
  }
  const startDate = series.bars[0]?.date;
  const endDate = series.bars.at(-1)?.date;
  if (!startDate || !endDate) {
    return unavailableHistory(asset.symbol, currency, 'Personal provider history is unavailable.');
  }
  const fxRows = currency === 'eur'
    ? await fetchHistoryFx(startDate, endDate, signal)
    : null;
  if (currency === 'eur' && !fxRows) {
    return unavailableHistory(asset.symbol, currency, 'Historical ECB reference FX is unavailable.');
  }
  const mapped = series.bars.flatMap((bar) => {
    if (currency === 'usd') {
      return [{
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        dataQuality: 'ohlc',
        priceQuality: 'observed',
        sourceRef: 'personal_1',
      }];
    }
    const fx = resolveHistoricalFx(fxRows ?? [], bar.date);
    if (!fx) return [];
    return [{
      date: bar.date,
      open: bar.open * fx.rate,
      high: bar.high * fx.rate,
      low: bar.low * fx.rate,
      close: bar.close * fx.rate,
      volume: bar.volume,
      dataQuality: 'ohlc',
      priceQuality: 'calculated',
      sourceRef: 'personal_1',
      conversion: {
        sourceCurrency: 'USD',
        rate: fx.rate,
        asOf: fx.asOf,
        sourceRef: 'fx_1',
      },
    }];
  });
  if (mapped.length === 0) {
    return unavailableHistory(asset.symbol, currency, 'Historical ECB reference FX coverage is incomplete.');
  }
  const stale = series.cacheStatus === 'hit_stale';
  const warnings = [
    'The personal Alpha Vantage connector supplies raw, unadjusted daily EOD history only.',
    'The compact response contains at most the latest 100 daily observations.',
    ...(stale
      ? ['A bounded cached personal response is being shown because refresh is unavailable.']
      : []),
    ...(currency === 'eur' && mapped.length !== series.bars.length
      ? ['Historical ECB reference FX coverage is incomplete.']
      : []),
  ];
  return json({
    contractVersion: 'history.v2',
    status: 'partial',
    symbol: asset.symbol,
    currency,
    prices: mapped,
    sources: [
      {
        ref: 'personal_1',
        kind: 'market',
        ...providerProvenance(series),
      },
      ...(currency === 'eur' ? [{
        ref: 'fx_1',
        kind: 'fx',
        providerId: 'ecb_reference_rates',
        providerName: 'European Central Bank',
        retrievedAt: new Date().toISOString(),
        method: 'date-aligned ECB EUR reference-rate conversion',
      }] : []),
    ],
    provenance: [{
      startDate: mapped[0].date,
      endDate: mapped.at(-1)?.date ?? mapped[0].date,
      providerId: series.providerId,
      providerName: 'Alpha Vantage (personal EOD)',
      role: 'personal_provider',
      dataPoints: mapped.length,
      status: 'partial',
      retrievedAt: series.retrievedAt,
    }],
    warnings,
    cache: { status: series.cacheStatus },
    freshness: stale ? 'stale' : 'fresh',
    latestObservationAt: series.latestObservationAt,
    isComplete: false,
    generatedAt: new Date().toISOString(),
    dataMode: series.cacheStatus === 'miss' ? 'personal_provider' : 'cached_personal',
    priceTiming: 'end_of_day',
    adjustment: 'raw_unadjusted',
    synthetic: false,
    realtime: false,
  });
}

export async function handlePersonalBrowserMarketRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  userId: string,
): Promise<Response | null> {
  const url = requestUrl(input);
  if (!url || url.origin !== window.location.origin) return null;
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return null;
  if (url.pathname === CURRENT_PATH) return handleCurrent(url, userId, init.signal ?? undefined);
  if (url.pathname === HISTORY_PATH && url.searchParams.get('metadata') !== 'true') {
    return handleHistory(url, userId, init.signal ?? undefined);
  }
  return null;
}

export function isPersonalBrowserProviderError(error: unknown): boolean {
  return error instanceof AlphaVantageBrowserError;
}
