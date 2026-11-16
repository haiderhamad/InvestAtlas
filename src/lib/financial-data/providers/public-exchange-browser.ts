'use client';

import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import type { TiingoBrowserDailySeries } from './tiingo-browser';

/**
 * Fixed, unauthenticated browser-to-exchange reads. Not a proxy and never a
 * substitute for the USD price of an instrument traded in another currency.
 * The exchange sees the browser's IP address when its toggle is enabled.
 */
export type PublicExchange = 'binance' | 'kraken';
export type PublicExchangeSeries = Omit<TiingoBrowserDailySeries, 'providerId' | 'listingCurrency'> & {
  providerId: 'binance_public_daily' | 'kraken_public_daily';
  listingCurrency: 'EUR' | 'USD';
};

const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 192 * 1024;
const MAX_BARS = 100;
const MAX_AGE_MS = 3 * DAY_MS;
const BASE_URLS: Record<PublicExchange, string> = {
  binance: 'https://data-api.binance.vision',
  kraken: 'https://api.kraken.com',
};
const CURRENCY: Record<PublicExchange, PublicExchangeSeries['listingCurrency']> = {
  binance: 'EUR',
  kraken: 'USD',
};
const PAIRS: Record<PublicExchange, Record<string, string>> = {
  binance: { BTC: 'BTCEUR', ETH: 'ETHEUR' },
  kraken: { BTC: 'XXBTZUSD', ETH: 'XETHZUSD' },
};
const KRAKEN_REQUEST_PAIRS: Record<string, string> = {
  BTC: 'XBTUSD', ETH: 'ETHUSD',
};
const recentRequests = new Map<string, number[]>();

function assertSupported(exchange: PublicExchange, symbol: string): string {
  const pair = PAIRS[exchange]?.[symbol];
  if (!pair) throw new Error('This exchange does not list the requested instrument');
  return pair;
}

function parseNumber(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value))) {
    throw new Error('Malformed exchange value');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error('Exchange value out of range');
  return n;
}

function completedBars(raw: Array<{ openTime: number; values: unknown[] }>, now: number): PublicExchangeSeries['bars'] {
  if (!raw.length || raw.length > 1_000) throw new Error('Invalid daily response length');
  const seen = new Set<number>();
  const bars: PublicExchangeSeries['bars'] = [];
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  for (const { openTime, values } of raw) {
    if (!Number.isSafeInteger(openTime) || openTime < Date.UTC(2010, 0, 1)
      || openTime > now + DAY_MS || openTime % DAY_MS !== 0 || seen.has(openTime)
      || values.length !== 5) throw new Error('Invalid or duplicated daily candle');
    seen.add(openTime);
    if (openTime >= today) continue; // Today's daily bar is incomplete.
    const [open, high, low, close, volume] = values.map(parseNumber);
    if (Math.min(open, high, low, close) <= 0 || high < Math.max(open, close)
      || low > Math.min(open, close) || high < low) throw new Error('Invalid exchange OHLC');
    bars.push({ date: new Date(openTime).toISOString().slice(0, 10), open, high, low, close, volume });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  const compact = bars.slice(-MAX_BARS);
  const last = compact.at(-1);
  if (!last || now - Date.parse(last.date + 'T00:00:00Z') > MAX_AGE_MS) {
    throw new Error('Daily exchange history is stale or incomplete');
  }
  return compact;
}

function series(exchange: PublicExchange, symbol: string, raw: Array<{ openTime: number; values: unknown[] }>, now: number): PublicExchangeSeries {
  const bars = completedBars(raw, now);
  return {
    providerId: exchange === 'binance' ? 'binance_public_daily' : 'kraken_public_daily',
    assetSymbol: symbol,
    providerSymbol: assertSupported(exchange, symbol),
    listingCurrency: CURRENCY[exchange],
    retrievedAt: new Date(now).toISOString(),
    latestObservationAt: bars.at(-1)!.date,
    cacheStatus: 'miss',
    bars,
  };
}

/** Binance daily BTC/EUR and ETH/EUR candles. No USDT=USD substitution. */
export function parseBinanceDaily(payload: unknown, symbol: string, now = Date.now()): PublicExchangeSeries {
  assertSupported('binance', symbol);
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > 100) {
    throw new Error('Invalid Binance response');
  }
  const raw = payload.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 12) throw new Error('Invalid Binance candle');
    return { openTime: entry[0] as number, values: entry.slice(1, 6) };
  });
  return series('binance', symbol, raw, now);
}

/** Kraken daily BTC/USD and ETH/USD candles; exact exchange pair enforced. */
export function parseKrakenDaily(payload: unknown, symbol: string, now = Date.now()): PublicExchangeSeries {
  const pair = assertSupported('kraken', symbol);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Kraken response');
  const data = payload as { error?: unknown; result?: Record<string, unknown> };
  if (!Array.isArray(data.error) || data.error.length > 0
    || !data.result || !Array.isArray(data.result[pair])) throw new Error('Invalid Kraken pair');
  const rows = data.result[pair] as unknown[];
  if (rows.length < 1 || rows.length > 1_000) throw new Error('Invalid Kraken response length');
  return series('kraken', symbol, rows.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 8) throw new Error('Invalid Kraken candle');
    const seconds = entry[0];
    return { openTime: typeof seconds === 'number' ? seconds * 1000 : NaN,
      values: [entry[1], entry[2], entry[3], entry[4], entry[6]] };
  }), now);
}

function activeOwner(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  if (INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud') return !!owner && current === owner;
  return INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    && current === null && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID
    && readAnonymousWorkspaceMode() === 'local_workspace';
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) {
    throw new Error('Exchange data unavailable');
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error('Exchange response too large');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BODY_BYTES) throw new Error('Exchange response too large');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return JSON.parse(body + decoder.decode());
}

export async function loadPublicExchangeSeries(
  exchange: PublicExchange,
  owner: string,
  symbol: string,
  signal?: AbortSignal,
): Promise<PublicExchangeSeries> {
  assertSupported(exchange, symbol);
  if (signal?.aborted || !activeOwner(owner)) throw new DOMException('Aborted', 'AbortError');
  const bucket = owner + ':' + exchange;
  const now = Date.now();
  const recent = (recentRequests.get(bucket) ?? []).filter(at => now - at < 60_000);
  if (recent.length >= 8) throw new Error('Exchange rate limit');
  recentRequests.set(bucket, [...recent, now]);
  const url = new URL(exchange === 'binance' ? '/api/v3/klines' : '/0/public/OHLC', BASE_URLS[exchange]);
  url.search = exchange === 'binance'
    ? new URLSearchParams({ symbol: assertSupported(exchange, symbol), interval: '1d', limit: '100' }).toString()
    : new URLSearchParams({ pair: KRAKEN_REQUEST_PAIRS[symbol], interval: '1440' }).toString();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    const payload = await readJson(response, controller.signal);
    if (!activeOwner(owner) || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return exchange === 'binance'
      ? parseBinanceDaily(payload, symbol)
      : parseKrakenDaily(payload, symbol);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
