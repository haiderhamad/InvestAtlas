import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { fetchProvider } from '@/lib/data/provider-fetch';
import type { CurrencyCode, Freshness } from '@/lib/financial-data/contracts';
import {
  fetchEcbCurrentFx,
  fetchEcbFxHistory,
  resolveHistoricalFx,
} from '@/lib/financial-data/fx/ecb';

const YAHOO_API = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};
const MAX_YAHOO_HISTORY_POINTS = 5_000;
const FRESH_CURRENT_QUOTE_AGE_MS = 3 * 86_400_000;
const MAX_CURRENT_QUOTE_AGE_MS = 7 * 86_400_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 5 * 60_000;

type YahooChartMeta = {
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketVolume?: number;
  longName?: string;
  shortName?: string;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  instrumentType?: string;
  regularMarketTime?: number;
};

type YahooQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartResult = {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuote[];
  };
};

export interface YahooCurrentQuote {
  price: number;
  previousClose: number | null;
  volume: number | null;
  marketCap: number | null;
  currency: QuoteCurrency;
  displayName: string;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  instrumentType: string | null;
  nativeCurrency: QuoteCurrency;
  sourceSymbol: string;
  asOf: string | null;
  retrievedAt: string;
  marketFreshness: 'fresh' | 'stale';
  fx: YahooFxMetadata;
}

export interface YahooFxMetadata {
  providerId: string;
  providerName: string;
  rate: number;
  asOf: string | null;
  freshness: Freshness;
  retrievedAt: string;
  method?: string;
}

export interface YahooHistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceCurrency?: CurrencyCode;
  currency?: CurrencyCode;
  fx?: YahooFxMetadata;
  retrievedAt: string;
  volumeAvailable: boolean;
}

interface YahooHistoricalResponse {
  currency: QuoteCurrency;
  bars: YahooHistoricalBar[];
}

function normalizeCurrency(value?: string): QuoteCurrency | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'eur' || normalized === 'usd') {
    return normalized;
  }
  return null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toDateString(timestampSeconds: unknown): string | null {
  if (
    typeof timestampSeconds !== 'number'
    || !Number.isFinite(timestampSeconds)
    || timestampSeconds <= 0
  ) {
    return null;
  }

  const date = new Date(timestampSeconds * 1000);
  return Number.isFinite(date.getTime())
    ? date.toISOString().split('T')[0]
    : null;
}

async function fetchChart(
  symbol: string,
  query: string,
  signal?: AbortSignal,
): Promise<YahooChartResult> {
  const response = await fetchProvider(`${YAHOO_API}/${encodeURIComponent(symbol)}?${query}`, {
    headers: YAHOO_HEADERS,
    next: { revalidate: 30 },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance error for ${symbol}: ${response.status}`);
  }

  const json = await response.json() as {
    chart?: { result?: YahooChartResult[]; error?: { description?: string } | null };
  };
  const result = json.chart?.result?.[0];

  if (!result) {
    const message = json.chart?.error?.description || `No chart result for ${symbol}`;
    throw new Error(message);
  }

  return result;
}

async function fetchChartWithFallback(
  symbols: string[],
  query: string,
  signal?: AbortSignal,
): Promise<{ result: YahooChartResult; sourceSymbol: string }> {
  let lastError: Error = new Error('No symbols provided');
  for (const symbol of symbols) {
    try {
      return {
        result: await fetchChart(symbol, query, signal),
        sourceSymbol: symbol,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

function toCurrencyCode(currency: QuoteCurrency): CurrencyCode {
  return currency.toUpperCase() as CurrencyCode;
}

function toFxMetadata(
  observation: Awaited<ReturnType<typeof fetchEcbCurrentFx>>,
): YahooFxMetadata {
  if (observation.rate.status !== 'available') {
    throw new Error(
      `No FX rate available for ${observation.baseCurrency}/${observation.quoteCurrency}`,
    );
  }
  if (observation.rate.freshness === 'stale') {
    throw new Error(
      `Current FX rate is stale for ${observation.baseCurrency}/${observation.quoteCurrency}`,
    );
  }
  if (observation.rate.provenance.retrievedAt === null) {
    throw new Error('FX retrieval time is unavailable');
  }
  return {
    providerId: observation.rate.provenance.providerId,
    providerName: observation.rate.provenance.providerName,
    rate: observation.rate.value,
    asOf: observation.rate.asOf,
    freshness: observation.rate.freshness,
    retrievedAt: observation.rate.provenance.retrievedAt,
    ...(observation.rate.provenance.method
      ? { method: observation.rate.provenance.method }
      : {}),
  };
}

/**
 * Compatibility mapper for callers that only need the numeric rate. New code
 * should consume the complete ECB observation so provenance is not discarded.
 */
export async function fetchFxRate(
  from: QuoteCurrency,
  to: QuoteCurrency,
  now = new Date(),
): Promise<number> {
  const observation = await fetchEcbCurrentFx(
    toCurrencyCode(from),
    toCurrencyCode(to),
    now,
  );
  if (
    observation.rate.status !== 'available'
    || observation.rate.freshness === 'stale'
  ) {
    throw new Error(`No FX rate available for ${from}/${to}`);
  }
  return observation.rate.value;
}

function applyRate(value: number, rate: number): number {
  if (
    !Number.isFinite(value)
    || value <= 0
    || !Number.isFinite(rate)
    || rate <= 0
  ) {
    throw new Error('Invalid price conversion input');
  }
  const converted = Number((value * rate).toFixed(6));
  if (!Number.isFinite(converted) || converted <= 0) {
    throw new Error('Invalid converted price');
  }
  return converted;
}

export async function fetchYahooCurrentQuote(
  symbol: string | string[],
  targetCurrency: QuoteCurrency,
  now = new Date(),
  signal?: AbortSignal,
): Promise<YahooCurrentQuote> {
  const symbols = Array.isArray(symbol) ? symbol : [symbol];
  
  try {
    const { result, sourceSymbol } = await fetchChartWithFallback(
      symbols,
      'interval=1d&range=5d',
      signal,
    );
    const meta = result.meta ?? {};
    const quote = result.indicators?.quote?.[0];
    const closes = quote?.close ?? [];
    const volumes = quote?.volume ?? [];
    const latestClose = [...closes].reverse().find(isFiniteNumber);
    const latestVolume = [...volumes].reverse().find(isFiniteNumber)
      ?? (isFiniteNumber(meta.regularMarketVolume) ? meta.regularMarketVolume : null);
    const price = isFiniteNumber(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : latestClose;
    const previousClose = isFiniteNumber(meta.chartPreviousClose)
      ? meta.chartPreviousClose
      : isFiniteNumber(meta.previousClose)
        ? meta.previousClose
        : null;
    if (!isFiniteNumber(price) || price <= 0) {
      throw new Error(`No current Yahoo price available for ${symbols[0]}`);
    }
    if (!isFiniteNumber(meta.regularMarketTime)) {
      throw new Error(`Yahoo quote timestamp is unavailable for ${symbols[0]}`);
    }
    const marketTimestamp = meta.regularMarketTime * 1_000;
    const marketAge = now.getTime() - marketTimestamp;
    if (
      marketAge < -MAX_PROVIDER_CLOCK_SKEW_MS
      || marketAge > MAX_CURRENT_QUOTE_AGE_MS
    ) {
      throw new Error(`Yahoo quote timestamp is stale for ${symbols[0]}`);
    }
    const sourceCurrency = normalizeCurrency(meta.currency);
    if (sourceCurrency === null) {
      throw new Error(`Unsupported Yahoo source currency for ${symbols[0]}`);
    }
    const fxObservation = await fetchEcbCurrentFx(
      toCurrencyCode(sourceCurrency),
      toCurrencyCode(targetCurrency),
      now,
      signal,
    );
    const fx = toFxMetadata(fxObservation);
    const rate = fx.rate;
    const asOf = new Date(marketTimestamp).toISOString();

    return {
      price: applyRate(price, rate),
      previousClose: previousClose === null || previousClose <= 0
        ? null
        : applyRate(previousClose, rate),
      volume:
        latestVolume !== null && latestVolume >= 0
          ? latestVolume
          : null,
      marketCap: null,
      currency: targetCurrency,
      displayName: meta.longName || meta.shortName || symbols[0],
      fiftyTwoWeekHigh:
        isFiniteNumber(meta.fiftyTwoWeekHigh)
        && meta.fiftyTwoWeekHigh > 0
          ? applyRate(meta.fiftyTwoWeekHigh, rate)
          : null,
      fiftyTwoWeekLow:
        isFiniteNumber(meta.fiftyTwoWeekLow)
        && meta.fiftyTwoWeekLow > 0
          ? applyRate(meta.fiftyTwoWeekLow, rate)
          : null,
      instrumentType: meta.instrumentType ?? null,
      nativeCurrency: sourceCurrency,
      sourceSymbol,
      asOf,
      retrievedAt: now.toISOString(),
      marketFreshness:
        marketAge <= FRESH_CURRENT_QUOTE_AGE_MS ? 'fresh' : 'stale',
      fx,
    };
  } catch (error) {
    // The old HTML fallback had no trustworthy source-currency metadata and
    // could therefore relabel a USD price as EUR. Fail closed instead.
    throw error;
  }
}

export async function fetchYahooHistoricalBars(
  symbol: string | string[],
  targetCurrency: QuoteCurrency,
  lastDate?: string,
  signal?: AbortSignal,
): Promise<YahooHistoricalResponse> {
  const symbols = Array.isArray(symbol) ? symbol : [symbol];
  let query = 'interval=1d&range=10y';

  if (lastDate) {
    const period1 = Math.floor((new Date(`${lastDate}T00:00:00Z`).getTime() + 86_400_000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    if (period1 < period2) {
      query = `interval=1d&period1=${period1}&period2=${period2}`;
    }
  }

  const { result } = await fetchChartWithFallback(symbols, query, signal);
  const retrievedAt = new Date().toISOString();
  const sourceCurrency = normalizeCurrency(result.meta?.currency);
  if (sourceCurrency === null) {
    throw new Error(`Unsupported Yahoo source currency for ${symbols[0]}`);
  }
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];

  if (!quote || !Array.isArray(timestamps)) {
    throw new Error(`Invalid Yahoo historical response for ${symbols[0]}`);
  }

  if (timestamps.length === 0) {
    return { currency: targetCurrency, bars: [] };
  }
  if (
    timestamps.length > MAX_YAHOO_HISTORY_POINTS
    || (quote.open?.length ?? 0) > MAX_YAHOO_HISTORY_POINTS
    || (quote.high?.length ?? 0) > MAX_YAHOO_HISTORY_POINTS
    || (quote.low?.length ?? 0) > MAX_YAHOO_HISTORY_POINTS
    || (quote.close?.length ?? 0) > MAX_YAHOO_HISTORY_POINTS
    || (quote.volume?.length ?? 0) > MAX_YAHOO_HISTORY_POINTS
  ) {
    throw new Error(`Yahoo history exceeded the allowed size for ${symbols[0]}`);
  }

  const rawBars: YahooHistoricalBar[] = [];
  const seenDates = new Set<string>();

  for (let index = 0; index < timestamps.length; index += 1) {
    const date = toDateString(timestamps[index]);
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];

    if (
      date === null ||
      seenDates.has(date) ||
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low ||
      high < open ||
      high < close ||
      low > open ||
      low > close
    ) {
      continue;
    }

    seenDates.add(date);
    rawBars.push({
      date,
      open,
      high,
      low,
      close,
      volume:
        isFiniteNumber(volume) && volume >= 0
          ? volume
          : 0,
      volumeAvailable: isFiniteNumber(volume) && volume >= 0,
      sourceCurrency: toCurrencyCode(sourceCurrency),
      currency: toCurrencyCode(sourceCurrency),
      retrievedAt,
    });
  }
  rawBars.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  if (rawBars.length === 0) {
    throw new Error(`Invalid Yahoo historical response for ${symbols[0]}`);
  }

  if (sourceCurrency === targetCurrency) {
    return { currency: targetCurrency, bars: rawBars };
  }

  const fxObservations = await fetchEcbFxHistory(
    toCurrencyCode(sourceCurrency),
    toCurrencyCode(targetCurrency),
    rawBars[0].date,
    rawBars[rawBars.length - 1].date,
    new Date(),
    signal,
  );
  if (fxObservations.length === 0) {
    throw new Error('Historical FX data is unavailable');
  }

  const converted: YahooHistoricalBar[] = [];
  for (const bar of rawBars) {
    const fxObservation = resolveHistoricalFx(fxObservations, bar.date);
    if (fxObservation?.rate.status !== 'available') {
      continue;
    }
    if (fxObservation.rate.provenance.retrievedAt === null) {
      continue;
    }
    const rate = fxObservation.rate.value;

    converted.push({
      ...bar,
      open: applyRate(bar.open, rate),
      high: applyRate(bar.high, rate),
      low: applyRate(bar.low, rate),
      close: applyRate(bar.close, rate),
      currency: toCurrencyCode(targetCurrency),
      fx: {
        providerId: fxObservation.rate.provenance.providerId,
        providerName: fxObservation.rate.provenance.providerName,
        rate,
        asOf: fxObservation.rate.asOf,
        freshness: fxObservation.rate.freshness,
        retrievedAt: fxObservation.rate.provenance.retrievedAt,
        ...(fxObservation.rate.provenance.method
          ? { method: fxObservation.rate.provenance.method }
          : {}),
      },
    });
  }

  if (converted.length === 0) {
    throw new Error('Historical FX data is unavailable');
  }

  return { currency: targetCurrency, bars: converted };
}
