'use client';

import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { getPersonalAssetConfig as getAssetConfig, getPersonalListingIdentity } from '@/lib/config/personal-asset-registry';
import {
  availableField,
  createMoney,
  unavailableField,
  type CurrencyCode,
  type FieldProvenance,
  type QuoteSnapshot,
} from '@/lib/financial-data/contracts';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';
import { fetchPublicGoldSpot, fetchPublicMetalSpot, type PublicGoldSpot, type PublicMetalSpot } from './public-gold-spot';
import { fetchPublicCryptoSpot, type PublicCryptoSpot, type PublicCryptoSymbol } from './public-crypto-spot';
import { fetchPublicCoinPaprikaSpot, type CoinPaprikaSpot } from './public-coinpaprika-spot';
import { fetchPublicCoinGeckoSpot, type CoinGeckoSpot } from './public-coingecko-spot';
import { getPublicSourceConsentRevision, isPublicSourceApproved } from './public-source-consent';
import {
  TiingoBrowserError,
  loadTiingoBrowserDailySeries,
  hasTiingoBrowserCredential,
  supportsTiingoBrowserAsset,
  type TiingoBrowserDailySeries,
} from './tiingo-browser';

import { marketSourceOrder, readSourceSelection, SELF_HOSTED_MARKET, TIINGO_CONNECTABLE, type MarketSource } from './source-selection';
import { activeMarketOwner, hasTwelve, loadTwelve, loadTwelveDemo, supportsTwelve, type TwelveSeries, type TwelveDemoSeries } from './twelve-personal';
import { loadPublicExchangeSeries, type PublicExchangeSeries } from './public-exchange-browser';
import { loadMarketData, loadMarketDataMidpoints, hasMarketData, supportsMarketDataAsset, type MarketDataDailySeries, type MarketDataMidpoint } from './marketdata-personal';
import { loadYahooPersonalDailySeries, supportsYahooPersonalAsset } from './yahoo-personal';
import type { YahooPersonalDailySeries } from './yahoo-personal-server';
import { loadPersonalDailyHistory, schedulePersonalHistoryWarmup, type HybridDailySeries, type PersonalHistorySource } from './personal-history-service';
import { loadPersonalHistoryFx } from '../fx/personal-history-fx';
import { normalizePersonalHistoryRange, type PersonalHistoryRange } from '../history/request';
import { getEodhdTarget } from './eodhd-contract';

type DailySeries = TiingoBrowserDailySeries | TwelveSeries | TwelveDemoSeries | PublicExchangeSeries | MarketDataDailySeries | YahooPersonalDailySeries | HybridDailySeries;
const isPublicExchange = (series: DailySeries): series is PublicExchangeSeries =>
  series.providerId === 'binance_public_daily' || series.providerId === 'kraken_public_daily';
const isPublicFeed = (series: DailySeries): boolean =>
  isPublicExchange(series) || series.providerId === 'twelve_demo_daily'
  || series.providerId === 'yahoo_personal_daily';
function providerLabel(series: DailySeries): string {
  if (series.providerId === 'binance_public_daily') return 'Binance (public BTC/EUR or ETH/EUR EOD)';
  if (series.providerId === 'kraken_public_daily') return 'Kraken (public BTC/USD or ETH/USD EOD)';
  if (series.providerId === 'twelve_demo_daily') return 'Twelve Data (official AAPL demo history)';
  if (series.providerId === 'marketdata_personal_daily') return 'Market Data API (personal US EOD)';
  if (series.providerId === 'yahoo_personal_daily') return 'Yahoo Finance (personal research EOD)';
  if (series.providerId === 'eodhd_personal_daily') return 'EODHD (personal daily history)';
  return series.providerId === 'twelve_personal_daily' ? 'Twelve Data (personal EOD)' : 'Tiingo (personal EOD)';
}
const CURRENT_PATH = '/api/prices/current';
const HISTORY_PATH = '/api/prices/history';
const MAX_SYMBOLS = 25;
const CONCURRENCY = 2;
// Match the conservative seven-day maximum used for ECB reference-rate age.
// Never carry a historical FX observation through an unbounded provider gap.
const MAX_HISTORICAL_FX_CARRY_DAYS = 7;
const DAY_MS = 86_400_000;
const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=_-]{0,63}$/;

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

function providerProvenance(series: DailySeries): FieldProvenance {
  return {
    providerId: series.providerId,
    providerName: providerLabel(series),
    retrievedAt: series.retrievedAt,
    method: isPublicExchange(series)
      ? `unadjusted, completed ${series.providerSymbol} daily exchange candle requested directly by the browser`
      : series.providerId === 'twelve_demo_daily'
        ? 'official provider sample data for AAPL charts only; not for portfolio valuation'
        : series.providerId === 'yahoo_personal_daily'
          ? 'unadjusted completed daily close from the unofficial Yahoo Chart endpoint for personal research'
          : 'unadjusted daily historical close from the user-owned provider account',
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
    || values.some((symbol) => !SYMBOL_PATTERN.test(symbol))
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

function convertListing(amount: number, listingCurrency: string, currency: QuoteCurrency, fx: FxRate | null): number | null {
  const value = listingCurrency.toLowerCase() === currency ? amount
    : fx && listingCurrency === 'USD' && currency === 'eur' ? amount * fx.value
      : fx && listingCurrency === 'EUR' && currency === 'usd' ? amount / fx.value : null;
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function quoteFromSeries(
  series: DailySeries,
  currency: QuoteCurrency,
  fx: FxRate | null,
): CurrentPriceSnapshot | null {
  const latest = series.bars.at(-1);
  if (!latest) return null;
  // Exchange BTC/EUR is directly EUR-denominated. Never label it as USD,
  // or treat crypto/USDT and crypto/USDC prices as fiat USD prices.
  const converted = series.listingCurrency.toLowerCase() !== currency;
  const price = convertListing(latest.close, series.listingCurrency, currency, fx);
  if (price === null) return null;
  const code = outputCurrency(currency);
  const marketSource = providerProvenance(series);
  const priceProvenance: FieldProvenance = converted && fx
    ? {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt: series.retrievedAt,
        method: `${providerLabel(series)} value converted with sourced ECB reference FX${series.listingCurrency === 'EUR' ? ' (inverse USD/EUR rate)' : ''}`,
        derivedFrom: [marketSource, fx.provenance],
      }
    : marketSource;
  const fields: QuoteSnapshot = {
    assetId: series.assetSymbol,
    listingCurrency: series.listingCurrency,
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
    volume: latest.volume === null ? unavailableField('not_provided') : availableField(latest.volume, {
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
    source: providerLabel(series),
    currency,
    dataStatus: 'partial',
    changePeriod: 'unavailable',
    fields,
    dataMode: isPublicFeed(series)
      ? 'public_market_api'
      : series.cacheStatus === 'miss' ? 'personal_provider' : 'cached_personal',
    priceTiming: 'end_of_day',
    realtime: false,
  };
}

function quoteFromPublicGold(
  gold: PublicGoldSpot | PublicMetalSpot,
  currency: QuoteCurrency,
  fx: FxRate | null,
): CurrentPriceSnapshot | null {
  const price = convert(gold.priceUsdPerTroyOunce, currency, fx);
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const code = outputCurrency(currency);
  const symbol = 'symbol' in gold ? gold.symbol : 'GOLD';
  const metal = symbol === 'SILVER' ? 'silver' : 'gold';
  const providerSymbol = symbol === 'SILVER' ? 'XAG' : 'XAU';
  const spotSource: FieldProvenance = {
    providerId: 'gold_api_public_spot',
    providerName: `Gold API (indicative ${providerSymbol}/USD spot)`,
    retrievedAt: gold.retrievedAt,
    method: `public spot ${providerSymbol}/USD quotation, USD per troy ounce of fine ${metal}`,
  };
  const calculated = currency === 'eur';
  const provenance: FieldProvenance = calculated && fx
    ? {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt: gold.retrievedAt,
        method: `indicative ${providerSymbol}/USD spot multiplied by ECB USD/EUR reference FX`,
        derivedFrom: [spotSource, fx.provenance],
      }
    : spotSource;
  const asOf = gold.observedAt.slice(0, 10);
  const fields: QuoteSnapshot = {
    assetId: symbol,
    listingCurrency: 'USD',
    outputCurrency: code,
    price: availableField(createMoney(price, code), {
      quality: calculated ? 'calculated' : 'observed',
      freshness: 'fresh',
      observedAt: gold.observedAt,
      asOf,
      provenance,
      limitations: ['single_source', 'delayed'],
    }),
    previousClose: unavailableField('not_provided'),
    changePercent: unavailableField('not_provided'),
    volume: unavailableField('not_provided'),
    marketCap: unavailableField('not_provided'),
    yearHigh: unavailableField('not_provided'),
    yearLow: unavailableField('not_provided'),
  };
  return {
    price,
    change24h: null,
    volume24h: null,
    marketCap: null,
    yearHigh: null,
    yearLow: null,
    displayName: getAssetConfig(symbol)?.name,
    instrumentType: 'metal',
    verified: false,
    source: `Gold API (indicative ${providerSymbol} spot)`,
    currency,
    dataStatus: 'partial',
    changePeriod: 'unavailable',
    fields,
    dataMode: 'public_market_api',
    priceTiming: 'delayed',
    realtime: false,
  };
}

function quoteFromPublicCrypto(
  spot: PublicCryptoSpot | CoinPaprikaSpot | CoinGeckoSpot,
  currency: QuoteCurrency,
  fx: FxRate | null,
): CurrentPriceSnapshot | null {
  const price = convert(spot.priceUsdPerCoin, currency, fx);
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const code = outputCurrency(currency);
  const fromCoinPaprika = 'providerId' in spot && spot.providerId === 'coinpaprika_public';
  const fromCoinGecko = 'providerId' in spot && spot.providerId === 'coingecko_public';
  const source: FieldProvenance = {
    providerId: fromCoinPaprika ? 'coinpaprika_public' : fromCoinGecko ? 'coingecko_public' : 'gold_api_public_crypto_spot',
    providerName: fromCoinPaprika ? 'CoinPaprika (personal-use public USD spot)' : fromCoinGecko ? 'CoinGecko (personal-use public USD spot)' : 'Gold API (indicative crypto USD spot)',
    retrievedAt: spot.retrievedAt,
    method: 'public spot USD per coin; not a completed daily closing price',
  };
  const converted = currency === 'eur';
  const provenance: FieldProvenance = converted && fx
    ? {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt: spot.retrievedAt,
        method: 'indicative crypto USD/coin spot multiplied by ECB USD/EUR reference FX',
        derivedFrom: [source, fx.provenance],
      }
    : source;
  const fields: QuoteSnapshot = {
    assetId: spot.symbol,
    listingCurrency: 'USD',
    outputCurrency: code,
    price: availableField(createMoney(price, code), {
      quality: converted ? 'calculated' : 'observed',
      freshness: 'fresh',
      observedAt: spot.observedAt,
      asOf: spot.observedAt.slice(0, 10),
      provenance,
      limitations: ['single_source', 'delayed'],
    }),
    previousClose: unavailableField('not_provided'),
    changePercent: unavailableField('not_provided'),
    volume: unavailableField('not_provided'),
    marketCap: unavailableField('not_provided'),
    yearHigh: unavailableField('not_provided'),
    yearLow: unavailableField('not_provided'),
  };
  return {
    price, change24h: null, volume24h: null, marketCap: null,
    yearHigh: null, yearLow: null,
    displayName: getAssetConfig(spot.symbol)?.name,
    instrumentType: 'crypto', verified: false,
    source: source.providerName,
    currency, dataStatus: 'partial', changePeriod: 'unavailable',
    fields, dataMode: 'public_market_api', priceTiming: 'delayed', realtime: false,
  };
}

function quoteFromYahoo(series: YahooPersonalDailySeries, currency: QuoteCurrency, fx: FxRate | null): CurrentPriceSnapshot | null {
  const eod = quoteFromSeries(series, currency, fx);
  if (!series.current || !eod) return eod;
  const price = convertListing(series.current.price, series.listingCurrency, currency, fx);
  if (price === null) return null;
  const converted = series.listingCurrency !== outputCurrency(currency);
  const source: FieldProvenance = {
    providerId: 'yahoo_personal_market', providerName: 'Yahoo Finance (personal research market quote)',
    retrievedAt: series.retrievedAt,
    method: 'last reported market price from the unofficial Yahoo Chart endpoint; exchange delay may apply',
  };
  return {
    ...eod, price, volume24h: null, source: source.providerName, priceTiming: 'delayed',
    fields: {
      ...eod.fields,
      price: availableField(createMoney(price, outputCurrency(currency)), {
        quality: converted ? 'calculated' : 'observed', freshness: 'fresh',
        observedAt: series.current.observedAt, asOf: series.current.observedAt.slice(0, 10),
        provenance: converted && fx ? {
          providerId: 'investatlas_calculation', providerName: 'InvestAtlas', retrievedAt: series.retrievedAt,
          method: `last reported Yahoo market price converted with sourced ECB reference FX${series.listingCurrency === 'EUR' ? ' (inverse USD/EUR rate)' : ''}`, derivedFrom: [source, fx.provenance],
        } : source,
        limitations: ['single_source', 'delayed'],
      }),
      volume: unavailableField('not_provided'),
    },
  };
}

function supportsMidpoint(symbol: string): boolean {
  if (supportsMarketDataAsset(symbol)) return true;
  const listing = getPersonalListingIdentity(symbol);
  return !!listing && listing.nativeCurrency === 'usd'
    && ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX'].includes(listing.exchange)
    && /^[A-Z][A-Z0-9-]{0,15}$/.test(listing.providerSymbol) && listing.symbol === listing.providerSymbol;
}

function quoteFromMidpoint(value: MarketDataMidpoint, currency: QuoteCurrency, fx: FxRate | null): CurrentPriceSnapshot | null {
  const price = convert(value.priceUsd, currency, fx);
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const source: FieldProvenance = {
    providerId: value.providerId, providerName: 'Market Data API (indicative SmartMid)', retrievedAt: value.retrievedAt,
    method: 'provider-calculated SmartMid model midpoint; not an exchange last trade or NBBO quotation',
  };
  // The endpoint can return the most recent trading observation on closed days.
  const recent = Date.now() - Date.parse(value.observedAt) <= 60_000;
  const converted = currency === 'eur';
  return {
    price, change24h: null, volume24h: null, marketCap: null, yearHigh: null, yearLow: null,
    displayName: getAssetConfig(value.assetSymbol)?.name, instrumentType: getAssetConfig(value.assetSymbol)?.assetClass ?? null,
    verified: false, source: source.providerName, currency, dataStatus: 'partial', changePeriod: 'unavailable',
    priceTiming: recent ? 'realtime' : 'delayed', realtime: recent, dataMode: 'personal_provider',
    fields: {
      assetId: value.assetSymbol, listingCurrency: 'USD', outputCurrency: outputCurrency(currency),
      price: availableField(createMoney(price, outputCurrency(currency)), {
        quality: 'calculated', freshness: 'fresh', observedAt: value.observedAt, asOf: value.observedAt.slice(0,10),
        provenance: converted && fx ? { providerId: 'investatlas_calculation', providerName: 'InvestAtlas', retrievedAt: value.retrievedAt,
          method: 'indicative SmartMid converted with sourced ECB reference FX', derivedFrom: [source, fx.provenance] } : source,
        limitations: recent ? ['single_source'] : ['single_source', 'delayed'],
      }),
      previousClose: unavailableField('not_provided'), changePercent: unavailableField('not_provided'),
      volume: unavailableField('not_provided'), marketCap: unavailableField('not_provided'),
      yearHigh: unavailableField('not_provided'), yearLow: unavailableField('not_provided'),
    },
  };
}

function eligible(source: MarketSource, owner: string, symbol: string, history: boolean,
  currency: QuoteCurrency, fxEnabled: boolean): boolean {
  const usdNeedsFx = currency === 'eur' && !fxEnabled;
  if (source === 'spot') return isPublicSourceApproved(owner, 'spot')
    && !history && !usdNeedsFx && ['GOLD', 'SILVER', 'BTC', 'ETH'].includes(symbol);
  if (source === 'coinpaprika') return isPublicSourceApproved(owner, 'coinpaprika')
    && !history && !usdNeedsFx && getAssetConfig(symbol)?.assetClass === 'crypto';
  if (source === 'coingecko') return isPublicSourceApproved(owner, 'coingecko')
    && !history && !usdNeedsFx && getAssetConfig(symbol)?.assetClass === 'crypto';
  if (source === 'binance') return isPublicSourceApproved(owner, 'binance')
    && currency === 'eur' && (symbol === 'BTC' || symbol === 'ETH');
  if (source === 'kraken') return isPublicSourceApproved(owner, 'kraken')
    && !usdNeedsFx && (symbol === 'BTC' || symbol === 'ETH');
  if (source === 'yahoo') return isPublicSourceApproved(owner, 'yahoo')
    && supportsYahooPersonalAsset(symbol)
    && (fxEnabled || getAssetConfig(symbol)?.nativeCurrency === currency);
  if (source === 'eodhd') {
    if (!history) return false;
    try { return !!getEodhdTarget(getPersonalListingIdentity(symbol) ?? symbol)
      && (fxEnabled || getAssetConfig(symbol)?.nativeCurrency === currency); } catch { return false; }
  }
  if (source === 'twelve_demo') return history && !usdNeedsFx && symbol === 'AAPL';
  if (usdNeedsFx) return false;
  if (source === 'twelve') return supportsTwelve(symbol) && hasTwelve(owner);
  if (source === 'marketdata') return (history ? supportsMarketDataAsset(symbol) : supportsMidpoint(symbol)) && hasMarketData(owner);
  return TIINGO_CONNECTABLE && supportsTiingoBrowserAsset(symbol) && hasTiingoBrowserCredential(owner);
}

async function firstAvailable<T>(owner: string, symbol: string, history: boolean, signal: AbortSignal | undefined,
  currency: QuoteCurrency, fxEnabled: boolean,
  read: (source: MarketSource) => Promise<T | null>): Promise<T | null> {
  const revision = getPublicSourceConsentRevision();
  const ensureActive = () => {
    if (signal?.aborted || !activeMarketOwner(owner) || getPublicSourceConsentRevision() !== revision) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };
  for (const source of marketSourceOrder(readSourceSelection(owner))) {
    ensureActive();
    if (!eligible(source, owner, symbol, history, currency, fxEnabled)) continue;
    try {
      const result = await read(source);
      ensureActive();
      if (result !== null) return result;
    } catch (error) {
      ensureActive();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // Never retry the same provider or rotate keys for a rate-limited account.
    }
  }
  return null;
}

function dailyFrom(source: MarketSource, owner: string, symbol: string, signal?: AbortSignal): Promise<DailySeries> {
  if (source === 'yahoo') return loadYahooPersonalDailySeries(owner, symbol, signal);
  if (source === 'twelve') return loadTwelve(owner, symbol, signal);
  if (source === 'marketdata') return loadMarketData(owner, symbol, signal);
  if (source === 'tiingo') return loadTiingoBrowserDailySeries(owner, symbol, signal);
  if (source === 'binance' || source === 'kraken') return loadPublicExchangeSeries(source, owner, symbol, signal);
  if (source === 'twelve_demo') return loadTwelveDemo(owner, symbol, signal);
  throw new Error('Spot quotes do not provide historical prices');
}

async function selectedCurrent(symbols: string[], currency: QuoteCurrency, owner: string, signal?: AbortSignal): Promise<Response> {
  const prefs = readSourceSelection(owner);
  const mayNeedConversion = symbols.some(symbol => marketSourceOrder(prefs).some(s =>
    eligible(s, owner, symbol, false, currency, prefs.fx)
      && (s === 'yahoo' ? getAssetConfig(symbol)?.nativeCurrency : s === 'binance' ? 'eur' : 'usd') !== currency));
  const fx = prefs.fx && mayNeedConversion && activeMarketOwner(owner)
    ? await fetchCurrentFx(signal) : null;
  const prices: Record<string, CurrentPriceSnapshot> = {};
  const issues: Array<{ symbol: string; code: string }> = [];
  let midpointBatch: Promise<Map<string, MarketDataMidpoint>> | undefined;
  const midpoints = () => midpointBatch ??= loadMarketDataMidpoints(owner,
    symbols.filter(s => supportsMidpoint(s)).map(s => getPersonalListingIdentity(s) ?? s), signal)
    .then(rows => new Map(rows.map(row => [row.assetSymbol, row])));
  const outcomes = await allSettledBounded(symbols, async symbol => {
    return firstAvailable(owner, symbol, false, signal, currency, prefs.fx && fx !== null, async source => {
      if (source === 'coinpaprika') {
        const spot = await fetchPublicCoinPaprikaSpot(symbol, signal);
        return spot && quoteFromPublicCrypto(spot, currency, fx);
      }
      if (source === 'coingecko') {
        const spot = await fetchPublicCoinGeckoSpot(symbol, signal);
        return spot && quoteFromPublicCrypto(spot, currency, fx);
      }
      if (source === 'yahoo') return quoteFromYahoo(await loadYahooPersonalDailySeries(owner, symbol, signal), currency, fx);
      if (source === 'marketdata') {
        const value = (await midpoints()).get(symbol);
        return value ? quoteFromMidpoint(value, currency, fx) : null;
      }
      if (source !== 'spot') return quoteFromSeries(await dailyFrom(source, owner, symbol, signal), currency, fx);
      if (symbol === 'GOLD' || symbol === 'SILVER') { const spot = await fetchPublicMetalSpot(symbol, signal); return spot && quoteFromPublicGold(spot, currency, fx); }
      if (symbol === 'BTC' || symbol === 'ETH') { const spot = await fetchPublicCryptoSpot(symbol, signal); return spot && quoteFromPublicCrypto(spot, currency, fx); }
      return null;
    });
  });
  if (signal?.aborted || !activeMarketOwner(owner)) throw new DOMException('Aborted','AbortError');
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled' && outcome.value) prices[symbols[i]] = outcome.value;
    else issues.push({symbol: symbols[i], code: !fx && mayNeedConversion ? 'fx_unavailable' : 'provider_unavailable'});
  });
  schedulePersonalHistoryWarmup(owner, symbols);
  const quotes = Object.values(prices), modes = new Set(quotes.map(q => q.dataMode)), timings = new Set(quotes.map(q => q.priceTiming));
  return json({status:quotes.length ? 'partial':'unavailable', prices, currency, timestamp:new Date().toISOString(),
    source:[...new Set(quotes.map(q=>q.source))].join(' + ') || 'n/a', issues:issues.length ? issues : undefined,
    refreshPolicy:'manual_only',dataMode:modes.size===1 && modes.has('public_market_api')?'public_market_api':'personal_provider',
    priceTiming:timings.size===1?quotes[0].priceTiming:'unknown', realtime:quotes.length > 0 && quotes.every(q => q.realtime === true), synthetic:false});
}

async function handleCurrent(url: URL, userId: string, signal?: AbortSignal): Promise<Response> {
  const symbols = parseSymbols(url.searchParams.get('symbols'));
  const currency = parseCurrency(url.searchParams.get('currency'));
  if (!symbols || !currency) return json({ error: 'Invalid current-price request' }, 400);
  if (SELF_HOSTED_MARKET) return selectedCurrent(symbols, currency, userId, signal);
  const activePersonalSession = hasTiingoBrowserCredential(userId);
  const publicCrypto = symbols.filter((symbol): symbol is PublicCryptoSymbol =>
    (symbol === 'BTC' || symbol === 'ETH') && !activePersonalSession);
  const supported = symbols.filter((symbol) => supportsTiingoBrowserAsset(symbol)
    && !publicCrypto.includes(symbol as PublicCryptoSymbol));
  const wantsPublicGold = symbols.includes('GOLD');
  const prices: Record<string, CurrentPriceSnapshot> = {};
  const issues: Array<{
    symbol: string;
    code: 'provider_unavailable' | 'fx_unavailable';
  }> = symbols
    .filter((symbol) => !supportsTiingoBrowserAsset(symbol) && symbol !== 'GOLD'
      && !publicCrypto.includes(symbol as PublicCryptoSymbol))
    .map((symbol) => ({ symbol, code: 'provider_unavailable' as const }));
  const fx = currency === 'eur' && (supported.length > 0 || wantsPublicGold || publicCrypto.length > 0)
    ? await fetchCurrentFx(signal)
    : null;
  if (currency === 'eur' && !fx) {
    issues.push(...supported.map((symbol) => ({ symbol, code: 'fx_unavailable' as const })));
    if (wantsPublicGold) issues.push({ symbol: 'GOLD', code: 'fx_unavailable' });
    issues.push(...publicCrypto.map((symbol) => ({ symbol, code: 'fx_unavailable' as const })));
  } else {
    const outcomes = await allSettledBounded(supported, (symbol) =>
      loadTiingoBrowserDailySeries(userId, symbol, signal)
    );
    outcomes.forEach((outcome, index) => {
      const symbol = supported[index];
      const quote = outcome.status === 'fulfilled'
        ? quoteFromSeries(outcome.value, currency, fx)
        : null;
      if (quote) prices[symbol] = quote;
      else issues.push({ symbol, code: 'provider_unavailable' });
    });
    for (const symbol of publicCrypto) {
      const spot = await fetchPublicCryptoSpot(symbol, signal);
      const quote = spot ? quoteFromPublicCrypto(spot, currency, fx) : null;
      if (quote) prices[symbol] = quote;
      else issues.push({ symbol, code: 'provider_unavailable' });
    }
    if (wantsPublicGold) {
      const spot = await fetchPublicGoldSpot(signal);
      const quote = spot ? quoteFromPublicGold(spot, currency, fx) : null;
      if (quote) prices.GOLD = quote;
      else issues.push({ symbol: 'GOLD', code: 'provider_unavailable' });
    }
  }
  const available = Object.keys(prices).length;
  const dataModes = new Set(Object.values(prices).map((price) => price.dataMode));
  return json({
    status: available === 0 ? 'unavailable' : 'partial',
    prices,
    currency,
    timestamp: new Date().toISOString(),
    source: available > 0
      ? [...new Set(Object.values(prices).map((quote) => quote.source))].join(' + ')
      : 'n/a',
    issues: issues.length > 0 ? issues : undefined,
    verificationLogs: undefined,
    dataMode: dataModes.size === 1 && dataModes.has('cached_personal')
      ? 'cached_personal'
      : dataModes.size === 1 && dataModes.has('public_market_api')
        ? 'public_market_api'
        : 'personal_provider',
    refreshPolicy: 'manual_only',
    priceTiming: dataModes.has('public_market_api')
      ? supported.some((symbol) => prices[symbol]) ? 'unknown' : 'delayed'
      : 'end_of_day',
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

async function selectedHistory(
  owner: string, symbol: string, range: PersonalHistoryRange, signal: AbortSignal | undefined,
  currency: QuoteCurrency, convertFx: (candidate: HybridDailySeries) => Promise<HistoryFxRow[] | null>,
): Promise<(HybridDailySeries & { convertedFx: HistoryFxRow[] | null }) | null> {
  const prefs = readSourceSelection(owner);
  const revision = getPublicSourceConsentRevision();
  const assertActive = () => {
    if (signal?.aborted || !activeMarketOwner(owner) || revision !== getPublicSourceConsentRevision()) {
      throw new DOMException('History session changed', 'AbortError');
    }
  };
  // Lawfully retained native history is reusable even after disconnecting its key.
  // Never merge candles from different providers, venues, or adjustment policies.
  const sources = [...new Set<MarketSource>(['eodhd', ...marketSourceOrder(prefs)])];
  let best: (HybridDailySeries & { convertedFx: HistoryFxRow[] | null }) | null = null;
  for (const [index, source] of sources.entries()) {
    assertActive();
    if (['spot','coinpaprika','coingecko'].includes(source)
      || !eligible(source, owner, symbol, true, currency, prefs.fx)) continue;
    try {
      const candidate = await loadPersonalDailyHistory(source as PersonalHistorySource, owner, symbol, range, signal);
      assertActive();
      if (!candidate?.bars.length) continue;
      const convertedFx = await convertFx(candidate);
      assertActive();
      if (candidate.listingCurrency.toLowerCase() !== currency && !convertedFx) continue;
      const value = { ...candidate, convertedFx };
      if (!best || (best.refreshFailed && !value.refreshFailed)
        || best.coverageLimited && !value.coverageLimited
        || best.coverageLimited === value.coverageLimited && value.bars.length > best.bars.length) best = value;
      if (!value.coverageLimited && !value.refreshFailed) return value;
      const broaderSourceRemains = sources.slice(index + 1).some(next =>
        (next === 'yahoo' || next === 'eodhd') && eligible(next, owner, symbol, true, currency, prefs.fx));
      if (!broaderSourceRemains && !value.refreshFailed) return best;
    } catch (error) {
      assertActive();
      if (error instanceof Error && error.name === 'AbortError') throw error;
    }
  }
  return best;
}

async function handleHistory(url: URL, userId: string, signal?: AbortSignal): Promise<Response> {
  const requested = url.searchParams.get('symbol')?.trim().toUpperCase() ?? '';
  const asset = getAssetConfig(requested);
  const currency = parseCurrency(url.searchParams.get('currency'));
  const interval = (url.searchParams.get('interval') ?? '1d').trim().toLowerCase();
  const requestedRange = normalizePersonalHistoryRange({
    ...(url.searchParams.has('range') ? { range: url.searchParams.get('range') } : {}),
    ...(url.searchParams.has('from') ? { from: url.searchParams.get('from') } : {}),
    ...(url.searchParams.has('to') ? { to: url.searchParams.get('to') } : {}),
  });
  if (!asset || !currency || interval !== '1d' || !requestedRange) {
    return json({ error: 'Unsupported personal-provider history request' }, 400);
  }
  if (!SELF_HOSTED_MARKET && !supportsTiingoBrowserAsset(asset.symbol)) {
    return unavailableHistory(asset.symbol, currency, 'This asset is not supported by the personal Tiingo connector.');
  }
  let series: DailySeries;
  let selectedFx: HistoryFxRow[] | null = null;
  try {
    const result = SELF_HOSTED_MARKET
      ? await selectedHistory(userId, asset.symbol, requestedRange, signal, currency,
        async candidate => {
          if (candidate.listingCurrency.toLowerCase() !== currency) {
            const first = candidate.bars[0]?.date;
            const last = candidate.bars.at(-1)?.date;
            if (!first || !last) return null;
            const rows = await loadPersonalHistoryFx(userId, first, last, signal);
            // Missing FX must not suppress a later, directly EUR-listed provider.
            if (!rows || !candidate.bars.some(bar => resolveHistoricalFx(rows, bar.date))) return null;
            return rows;
          } else {
            return [];
          }
        })
      : await loadTiingoBrowserDailySeries(userId, asset.symbol, signal);
    if (!result) return unavailableHistory(asset.symbol, currency, 'No enabled source supplies daily history for this instrument.');
    series = result;
    selectedFx = 'convertedFx' in result ? result.convertedFx as HistoryFxRow[] | null : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return unavailableHistory(asset.symbol, currency, 'No session key or usable personal cache can supply this history.');
  }
  const startDate = series.bars[0]?.date;
  const endDate = series.bars.at(-1)?.date;
  if (!startDate || !endDate) {
    return unavailableHistory(asset.symbol, currency, 'Personal provider history is unavailable.');
  }
  const needsHistoricalFx = series.listingCurrency.toLowerCase() !== currency;
  const fxRows = needsHistoricalFx
    ? selectedFx ?? (SELF_HOSTED_MARKET
      ? await loadPersonalHistoryFx(userId, startDate, endDate, signal)
      : await fetchHistoryFx(startDate, endDate, signal))
    : null;
  if (needsHistoricalFx && !fxRows) {
    return unavailableHistory(asset.symbol, currency, 'Historical ECB reference FX is unavailable.');
  }
  if (series.listingCurrency.toLowerCase() !== currency && !needsHistoricalFx) {
    return unavailableHistory(asset.symbol, currency, 'Native quote currency cannot be converted safely.');
  }
  const sourceRef = isPublicFeed(series) ? 'public_1' : 'personal_1';
  const mapped = series.bars.flatMap((bar) => {
    if (series.listingCurrency.toLowerCase() === currency) {
      return [{
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        dataQuality: 'ohlc',
        priceQuality: 'observed',
        sourceRef,
      }];
    }
    const fx = resolveHistoricalFx(fxRows ?? [], bar.date);
    if (!fx) return [];
    const rate = series.listingCurrency === 'EUR' ? 1 / fx.rate : fx.rate;
    if (!Number.isFinite(rate) || rate <= 0) return [];
    return [{
      date: bar.date,
      open: bar.open * rate,
      high: bar.high * rate,
      low: bar.low * rate,
      close: bar.close * rate,
      volume: bar.volume,
      dataQuality: 'ohlc',
      priceQuality: 'calculated',
      sourceRef,
      conversion: {
        sourceCurrency: series.listingCurrency,
        rate,
        asOf: fx.asOf,
        sourceRef: 'fx_1',
      },
    }];
  });
  if (mapped.length === 0) {
    return unavailableHistory(asset.symbol, currency, 'Historical ECB reference FX coverage is incomplete.');
  }
  const latestObservationAt = mapped.at(-1)!.date;
  const latestAt = parseIsoDate(latestObservationAt);
  if (latestAt === null) {
    return unavailableHistory(asset.symbol, currency, 'Converted daily history is stale or unavailable.');
  }
  const coverageLimited = 'coverageLimited' in series ? series.coverageLimited : true;
  const stale = series.cacheStatus === 'hit_stale'
    || Date.parse(requestedRange.to) - latestAt > MAX_HISTORICAL_FX_CARRY_DAYS * DAY_MS;
  const warnings = [
    series.providerId === 'twelve_demo_daily'
      ? 'Official provider demo sample: AAPL chart testing only; not for current portfolio valuation or redistribution.'
      : series.providerId === 'yahoo_personal_daily'
        ? 'Unofficial Yahoo Finance daily prices for permitted personal research only; no redistribution permission is implied.'
      : isPublicExchange(series)
        ? `${providerLabel(series)} supplies exchange-specific, raw daily EOD history only.`
        : series.providerId === 'twelve_personal_daily'
        ? 'Twelve Data supplies raw, unadjusted daily EOD history only.'
        : `${providerLabel(series)} supplies raw, unadjusted daily EOD history only.`,
    ...(coverageLimited ? ['Available provider history covers only part of the requested time range.'] : []),
    ...(stale
      ? ['A bounded cached personal response is being shown because refresh is unavailable.']
      : []),
    ...(needsHistoricalFx && mapped.length !== series.bars.length
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
        ref: sourceRef,
        kind: 'market',
        ...providerProvenance(series),
      },
      ...(needsHistoricalFx ? [{
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
      providerName: providerLabel(series),
      role: isPublicFeed(series) ? 'public_market_api' : 'personal_provider',
      dataPoints: mapped.length,
      status: 'partial',
      retrievedAt: series.retrievedAt,
    }],
    warnings,
    cache: { status: series.cacheStatus },
    freshness: stale ? 'stale' : 'fresh',
    latestObservationAt,
    requestedRange,
    availableRange: { from: mapped[0].date, to: latestObservationAt },
    coverageLimited,
    isComplete: false,
    generatedAt: new Date().toISOString(),
    dataMode: isPublicFeed(series)
      ? 'public_market_api'
      : series.cacheStatus === 'miss' ? 'personal_provider' : 'cached_personal',
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
  const revision = getPublicSourceConsentRevision();
  let response: Response | null = null;
  if (url.pathname === CURRENT_PATH) response = await handleCurrent(url, userId, init.signal ?? undefined);
  if (url.pathname === HISTORY_PATH && url.searchParams.get('metadata') !== 'true') {
    response = await handleHistory(url, userId, init.signal ?? undefined);
  }
  // FX conversion and batch assembly can outlive the underlying provider load.
  // Reject their results after any permission change, including same-owner reapproval.
  if (response && SELF_HOSTED_MARKET && getPublicSourceConsentRevision() !== revision) {
    throw new DOMException('Market source permission changed', 'AbortError');
  }
  return response;
}

export function isPersonalBrowserProviderError(error: unknown): boolean {
  return error instanceof TiingoBrowserError;
}

