import { getAssetConfig } from '@/lib/config/supported-assets';
import type { TiingoBrowserDailySeries } from './tiingo-browser';
import { normalizePersonalListingIdentity, type PersonalListingIdentity } from '@/lib/config/personal-instrument';
import { normalizePersonalHistoryRange, type PersonalHistoryRange } from '@/lib/financial-data/history/request';

// Yahoo chart is an unofficial endpoint. User-initiated personal research only:
// fixed host, exact instrument allowlist, no anti-bot bypass, no shared cache.
const CHART_ORIGIN = 'https://query1.finance.yahoo.com';
const MAX_BYTES = 160 * 1024;
const MAX_ROWS = 110;
const MAX_HISTORY_BYTES = 768 * 1024;
const MAX_HISTORY_ROWS = 2200;
const MAX_LATEST_AGE_MS = 7 * 86_400_000;
const MAX_CURRENT_FUTURE_MS = 5 * 60_000;
const DAY = 86_400_000;
const NASDAQ_EXCHANGES = ['NMS', 'NGM', 'NCM'] as const;
// Exact catalog listings, including Nasdaq ETFs and NYSE Arca ETFs. Never
// infer one US venue from currency or accept an unrelated listing's metadata.
const LISTING_EXCHANGES: Readonly<Record<string, readonly string[]>> = {
  AAPL: NASDAQ_EXCHANGES,
  MSFT: NASDAQ_EXCHANGES,
  NVDA: NASDAQ_EXCHANGES,
  AMZN: NASDAQ_EXCHANGES,
  GOOGL: NASDAQ_EXCHANGES,
  META: NASDAQ_EXCHANGES,
  TSLA: NASDAQ_EXCHANGES,
  'SAP.DE': ['GER'],
  'ASML.AS': ['AMS'],
  'SIE.DE': ['GER'],
  'IUSD.DE': ['GER'],
  'IUSF.DE': ['GER'],
  'IUSE.DE': ['GER'],
  HLAL: NASDAQ_EXCHANGES,
  UMMA: NASDAQ_EXCHANGES,
  SPUS: ['PCX'],
  SPWO: ['PCX'],
  SPTE: ['PCX'],
  SPRE: ['PCX'],
  'IGDA.L': ['LSE'],
};

export class YahooPersonalUpstreamError extends Error {
  constructor(public readonly status: number, public readonly retryAfterSeconds: number) {
    super('Yahoo daily endpoint unavailable');
    this.name = 'YahooPersonalUpstreamError';
  }
}

function retryAfterSeconds(response: Response): number {
  const value = response.headers.get('retry-after');
  const seconds = value && /^\d+$/.test(value)
    ? Number(value) : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : 0;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 90;
}

export type YahooPersonalDailySeries =
  Omit<TiingoBrowserDailySeries, 'providerId' | 'listingCurrency' | 'bars' | 'latestObservationAt'> & {
    providerId: 'yahoo_personal_daily';
    listingCurrency: 'USD' | 'EUR';
    latestObservationAt: string | null;
    bars: Array<Omit<TiingoBrowserDailySeries['bars'][number], 'volume'> & { volume: number | null }>;
    missingTradingDates?: string[];
    current?: { price: number; observedAt: string };
    exchange?: string;
    assetClass?: 'stock' | 'etf';
  };

export interface YahooPersonalOptions {
  listing?: PersonalListingIdentity;
  range?: PersonalHistoryRange;
  allowHistoricalTail?: boolean;
}

function expectedListing(symbol: string, hint?: PersonalListingIdentity) {
  const asset = getAssetConfig(symbol);
  if (asset && (asset.assetClass === 'stock' || asset.assetClass === 'etf')
    && asset.yahooSymbol && Object.hasOwn(LISTING_EXCHANGES, asset.yahooSymbol)) {
    return {providerSymbol:asset.yahooSymbol,assetClass:asset.assetClass,nativeCurrency:asset.nativeCurrency,exchanges:LISTING_EXCHANGES[asset.yahooSymbol]};
  }
  const listing = normalizePersonalListingIdentity(hint);
  return listing?.symbol === symbol ? {providerSymbol:listing.providerSymbol,assetClass:listing.assetClass,nativeCurrency:listing.nativeCurrency,exchanges:[listing.exchange]} : null;
}

export function supportsYahooPersonalAsset(symbol: string, listing?: PersonalListingIdentity): boolean {
  return Boolean(expectedListing(symbol, listing));
}

function providerTicker(symbol: string, listing?: PersonalListingIdentity): string {
  const expected = expectedListing(symbol, listing);
  if (!expected) throw new Error('Unsupported personal Yahoo instrument');
  return expected.providerSymbol;
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e8;
}

export function parseYahooPersonalChart(
  symbol: string, payload: unknown, now = Date.now(), options: YahooPersonalOptions = {},
): YahooPersonalDailySeries {
  const ticker = providerTicker(symbol, options.listing);
  const expected = expectedListing(symbol, options.listing)!;
  const range = options.range ? normalizePersonalHistoryRange(options.range, now) : null;
  if (options.range && !range) throw new Error('Invalid Yahoo history range');
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Yahoo response');
  const root = payload as Record<string, unknown>;
  const chart = root.chart as Record<string, unknown> | undefined;
  const results = chart?.result;
  if (!Array.isArray(results) || results.length !== 1
    || !results[0] || typeof results[0] !== 'object') throw new Error('Yahoo series unavailable');
  const row = results[0] as Record<string, unknown>;
  const meta = row.meta as Record<string, unknown> | undefined;
  const currency = expected.nativeCurrency.toUpperCase();
  if (!meta || meta.symbol !== ticker || meta.currency !== currency
    || meta.instrumentType !== (expected.assetClass === 'stock' ? 'EQUITY' : 'ETF')
    || typeof meta.exchangeName !== 'string'
    || !expected.exchanges.includes(meta.exchangeName)) {
    throw new Error('Yahoo instrument, listing or currency mismatch');
  }
  const times = row.timestamp;
  const indicators = row.indicators as Record<string, unknown> | undefined;
  const quotes = indicators?.quote;
  const quote = Array.isArray(quotes) ? quotes[0] as Record<string, unknown> | undefined : undefined;
  if (!Array.isArray(times) || times.length < (range && options.allowHistoricalTail ? 0 : 2) || times.length > (range ? MAX_HISTORY_ROWS : MAX_ROWS)
    || !quote || !['open', 'high', 'low', 'close'].every((key) =>
      Array.isArray(quote[key]) && (quote[key] as unknown[]).length === times.length)) {
    throw new Error('Invalid Yahoo daily structure');
  }
  const daily: YahooPersonalDailySeries['bars'] = [];
  const missingTradingDates: string[] = [];
  const seen = new Set<string>();
  const currentDay = new Date(now).toISOString().slice(0, 10);
  for (let i = 0; i < times.length; i++) {
    const seconds = times[i];
    if (!Number.isSafeInteger(seconds)
      || seconds < 1_400_000_000 || seconds * 1000 > now + DAY) {
      throw new Error('Invalid Yahoo date');
    }
    const date = new Date(seconds * 1000).toISOString().slice(0, 10);
    if (seen.has(date)) throw new Error('Duplicate Yahoo trading date');
    seen.add(date);
    // Never call an unfinished daily candle a completed EOD observation.
    if (date >= currentDay) continue;
    if (range && (date < range.from || date > range.to)) throw new Error('Yahoo candle outside requested range');
    const open = (quote.open as unknown[])[i];
    const high = (quote.high as unknown[])[i];
    const low = (quote.low as unknown[])[i];
    const close = (quote.close as unknown[])[i];
    // Yahoo sometimes includes a trading timestamp with explicitly absent OHLC.
    // Keep the gap visible; mixed/invalid prices still reject the whole response.
    if ([open, high, low, close].every(value => value === null)) {
      missingTradingDates.push(date);
      continue;
    }
    if (![open, high, low, close].every(number)
      || (high as number) < Math.max(open as number, close as number)
      || (low as number) > Math.min(open as number, close as number)) {
      throw new Error('Invalid Yahoo unadjusted OHLC');
    }
    const rawVolume = Array.isArray(quote.volume) ? quote.volume[i] : null;
    const volume = typeof rawVolume === 'number' && Number.isSafeInteger(rawVolume)
      && rawVolume >= 0 ? rawVolume : null;
    daily.push({
      date, open: open as number, high: high as number, low: low as number,
      close: close as number, volume,
    });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));
  const bars = daily.slice(-(range ? MAX_HISTORY_ROWS : 100));
  const last = bars.at(-1);
  if (!(range && options.allowHistoricalTail) && (!last || bars.length < 2
    || now - Date.parse(last.date + 'T23:59:59Z') > MAX_LATEST_AGE_MS)) {
    throw new Error('Yahoo daily close is unavailable or stale');
  }
  const marketTime = meta.regularMarketTime;
  const marketMs = typeof marketTime === 'number' && Number.isSafeInteger(marketTime)
    ? marketTime * 1000 : NaN;
  // Optional last market observation, not a realtime guarantee or an EOD bar.
  // Invalid current metadata must not discard otherwise valid daily history.
  const current = !!last && !options.allowHistoricalTail && number(meta.regularMarketPrice) && Number.isSafeInteger(marketMs)
    && marketMs >= now - MAX_LATEST_AGE_MS && marketMs <= now + MAX_CURRENT_FUTURE_MS
    && marketMs >= Date.parse(last.date + 'T00:00:00Z')
    ? { price: meta.regularMarketPrice, observedAt: new Date(marketMs).toISOString() }
    : undefined;
  return {
    providerId: 'yahoo_personal_daily', assetSymbol: symbol,
    providerSymbol: ticker, listingCurrency: currency as 'USD' | 'EUR',
    retrievedAt: new Date(now).toISOString(), latestObservationAt: last?.date ?? null,
    cacheStatus: 'miss', bars,
    ...(missingTradingDates.length ? { missingTradingDates: missingTradingDates.sort() } : {}),
    exchange: meta.exchangeName, assetClass: expected.assetClass,
    ...(current ? { current } : {}),
  };
}

async function boundedJson(response: Response, maximumBytes = MAX_BYTES): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new YahooPersonalUpstreamError(response.status, retryAfterSeconds(response));
  }
  if (!response.headers.get('content-type')?.includes('application/json')
    || !response.body) throw new Error('Yahoo daily endpoint unavailable');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maximumBytes) throw new Error('Yahoo response too large');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error('Yahoo response too large');
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(body);
}

export async function fetchYahooPersonalDaily(
  symbol: string, signal?: AbortSignal, options: YahooPersonalOptions = {},
): Promise<YahooPersonalDailySeries> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const ticker = providerTicker(symbol, options.listing);
  const range = options.range ? normalizePersonalHistoryRange(options.range) : null;
  if (options.range && !range) throw new Error('Invalid Yahoo history range');
  const url = new URL('/v8/finance/chart/' + encodeURIComponent(ticker), CHART_ORIGIN);
  url.search = new URLSearchParams(range ? {
    interval:'1d',period1:String(Date.parse(range.from+'T00:00:00Z')/1000),
    period2:String(Date.parse(range.to+'T00:00:00Z')/1000+86400),
  } : { interval:'1d',range:'3mo' }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    const data = await boundedJson(response, range ? MAX_HISTORY_BYTES : MAX_BYTES);
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return parseYahooPersonalChart(symbol, data, Date.now(), options);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
