'use client';

import { getAssetConfig } from '@/lib/config/supported-assets';
import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import type { TiingoBrowserDailySeries } from './tiingo-browser';
import { SOURCE_CHANGE } from './source-selection';
import { hasYahooPersonalListingAttestation, resolveYahooPersonalListing } from './yahoo-personal-discovery';

/**
 * A fixed, documented, browser-only Market Data API adapter for a user's
 * personal non-public installation. Never proxy keys through an InvestAtlas
 * server or send them to user-configured URLs.
 */
export type MarketDataDailySeries = Omit<TiingoBrowserDailySeries, 'providerId'> & {
  providerId: 'marketdata_personal_daily';
};
export interface MarketDataMidpointInstrument {
  symbol: string;
  providerSymbol: string;
  assetClass: 'stock' | 'etf';
  nativeCurrency: 'eur' | 'usd';
  exchange: string;
}
export interface MarketDataMidpoint {
  providerId: 'marketdata_personal_midpoint';
  assetSymbol: string;
  providerSymbol: string;
  listingCurrency: 'USD';
  priceUsd: number;
  observedAt: string;
  retrievedAt: string;
  priceType: 'indicative_model_midpoint';
  cacheStatus: 'miss';
}
const BASE = 'https://api.marketdata.app/v1/stocks/candles/D/';
const MIDPOINT_BASE = 'https://api.marketdata.app/v1/stocks/prices/';
const MAX_BODY = 96 * 1024;
const MAX_BARS = 100;
const MAX_AGE_MS = 5 * 86_400_000;
const CACHE_MS = 3 * 60_000;
const MAX_TOKENS_24H = 80;
const MAX_TOKENS_HOUR = 25;
const credentialPattern = /^[A-Za-z0-9._~-]{16,2048}$/;

type Credential = { owner: string; token: string };
let credential: Credential | null = null;
let pendingOwner: string | null = null;
let generation = 0;
const pending = new Set<AbortController>();
const historyCache = new Map<string, { until: number; value: MarketDataDailySeries }>();
const inFlight = new Map<string, Promise<MarketDataDailySeries>>();
const requests = new Map<string, number[]>();
const cooldowns = new Map<string, { status: number; until: number }>();

export class MarketDataPersonalError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number) {
    super('Personal Market Data request unavailable');
    this.name = 'MarketDataPersonalError';
  }
}

export function supportsMarketDataAsset(symbol: string): boolean {
  const asset = getAssetConfig(symbol);
  return Boolean(asset && (asset.assetClass === 'stock' || asset.assetClass === 'etf')
    && asset.nativeCurrency === 'usd' && asset.yahooSymbol === symbol
    && /^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol));
}
function activeOwner(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  return INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud'
    ? !!owner && current === owner
    : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
      && current === null && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID
      && readAnonymousWorkspaceMode() === 'local_workspace';
}
function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOURCE_CHANGE));
}
export function clearMarketData(): void {
  generation += 1;
  credential = null;
  pendingOwner = null;
  historyCache.clear();
  inFlight.clear();
  pending.forEach((controller) => controller.abort());
  pending.clear();
  for (const [owner, value] of cooldowns) if (value.until <= Date.now()) cooldowns.delete(owner);
  emit();
}
export function reconcileMarketData(owner: string | null): void {
  if ((credential && credential.owner !== owner)
    || (pendingOwner && pendingOwner !== owner)) clearMarketData();
}
export function hasMarketData(owner: string): boolean {
  return activeOwner(owner) && credential?.owner === owner;
}

function validateToken(value: string): string {
  const token = value.trim();
  if (!credentialPattern.test(token)) throw new Error('Invalid personal Market Data token');
  return token;
}

export function parseMarketDataDaily(
  payload: unknown, symbol: string, now = Date.now(),
): MarketDataDailySeries {
  if (!supportsMarketDataAsset(symbol) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Unsupported Market Data instrument');
  }
  const data = payload as Record<string, unknown>;
  const keys = ['t', 'o', 'h', 'l', 'c', 'v'] as const;
  const columns = keys.map((key) => data[key]);
  if (data.s !== 'ok' || columns.some((col) => !Array.isArray(col))) {
    throw new Error('Market Data returned no valid candles');
  }
  const rows = columns as number[][];
  const count = rows[0].length;
  if (!count || count > MAX_BARS || rows.some((col) => col.length !== count)) {
    throw new Error('Invalid Market Data candle count');
  }
  const observed = new Set<string>();
  const today = new Date(now).toISOString().slice(0, 10);
  const bars: MarketDataDailySeries['bars'] = [];
  for (let i = 0; i < count; i++) {
    const [t, open, high, low, close, volume] = rows.map((col) => col[i]);
    if (!Number.isSafeInteger(t) || t < 1_400_000_000 || t * 1000 > now + 86_400_000
      || ![open, high, low, close].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7)
      || !Number.isSafeInteger(volume) || volume < 0
      || high < Math.max(open, close) || low > Math.min(open, close)) {
      throw new Error('Invalid Market Data price, volume or timestamp');
    }
    const date = new Date(t * 1000).toISOString().slice(0, 10);
    if (observed.has(date)) throw new Error('Repeated Market Data daily candle');
    observed.add(date);
    if (date >= today) continue; // No in-progress exchange day as complete EOD data.
    bars.push({ date, open, high, low, close, volume });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  const latest = bars.at(-1);
  if (!latest || now - Date.parse(latest.date + 'T23:59:59Z') > MAX_AGE_MS) {
    throw new Error('Market Data daily observation is stale');
  }
  return {
    providerId: 'marketdata_personal_daily', assetSymbol: symbol, providerSymbol: symbol,
    listingCurrency: 'USD', retrievedAt: new Date(now).toISOString(),
    latestObservationAt: latest.date, cacheStatus: 'miss', bars,
  };
}

function consume(owner: string, count = 1): void {
  const now = Date.now();
  const blocked = cooldowns.get(owner);
  if (blocked && blocked.until > now) throw new MarketDataPersonalError(blocked.status, Math.max(1, Math.ceil((blocked.until - now) / 1000)));
  const seen = (requests.get(owner) ?? []).filter((stamp) => stamp > now - 86_400_000);
  if (!Number.isSafeInteger(count) || count < 1 || seen.length + count > MAX_TOKENS_24H
    || seen.filter((stamp) => stamp > now - 3_600_000).length + count > MAX_TOKENS_HOUR) {
    throw new Error('Personal Market Data request budget exhausted');
  }
  requests.set(owner, [...seen, ...Array<number>(count).fill(now)]);
}

function upstreamError(response: Response, owner: string): MarketDataPersonalError {
  const value = response.headers.get('retry-after');
  const parsed = value && /^\d+$/.test(value) ? Number(value)
    : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : NaN;
  const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.min(604800, Math.ceil(parsed))
    : [401, 402, 403].includes(response.status) ? 3600 : 90;
  if ([401, 402, 403, 429].includes(response.status)) cooldowns.set(owner, { status: response.status, until: Date.now() + seconds * 1000 });
  return new MarketDataPersonalError(response.status, seconds);
}

type MidpointHint = { symbol: string; ticker: string; custom: MarketDataMidpointInstrument | null };
function midpointInstrument(input: string | MarketDataMidpointInstrument): MidpointHint {
  if (typeof input === 'string') {
    if (!supportsMarketDataAsset(input)) throw new Error('Unsupported exact Market Data US listing');
    return { symbol: input, ticker: input, custom: null };
  }
  // /prices supplies no currency/venue metadata. Only a separately resolved
  // exact US listing may enter this path; USD alone is insufficient evidence.
  if (!input || typeof input !== 'object'
    || !['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX'].includes(input.exchange)
    || input.nativeCurrency !== 'usd' || !['stock', 'etf'].includes(input.assetClass)
    || !/^[A-Z][A-Z0-9-]{0,15}$/.test(input.providerSymbol)
    || !/^[A-Z][A-Z0-9-]{0,15}$/.test(input.symbol)) {
    throw new Error('Unsupported exact Market Data US listing');
  }
  const configured = getAssetConfig(input.symbol);
  if (configured ? configured.yahooSymbol !== input.providerSymbol
    || configured.assetClass !== input.assetClass || configured.nativeCurrency !== input.nativeCurrency
    || !supportsMarketDataAsset(input.symbol) : input.symbol !== input.providerSymbol) {
    throw new Error('Market Data listing metadata mismatch');
  }
  return { symbol: input.symbol, ticker: input.providerSymbol, custom: configured ? null : {
    symbol: input.symbol, providerSymbol: input.providerSymbol, assetClass: input.assetClass,
    nativeCurrency: input.nativeCurrency, exchange: input.exchange,
  } };
}

async function verifyMidpointHints(
  owner: string, hints: MidpointHint[], version: number, signal?: AbortSignal,
): Promise<MidpointHint[]> {
  const assertSession = () => {
    if (signal?.aborted || version !== generation || !hasMarketData(owner)) throw new DOMException('Market Data session inactive', 'AbortError');
  };
  const approved = hints.map(hint => hint.custom === null);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < hints.length) {
      const index = next++;
      const hint = hints[index];
      if (!hint.custom) continue;
      assertSession();
      try {
        if (!hasYahooPersonalListingAttestation(owner, hint.custom)) {
          await resolveYahooPersonalListing(owner, hint.ticker, signal);
          assertSession();
        }
        approved[index] = hasYahooPersonalListingAttestation(owner, hint.custom);
      } catch {
        assertSession();
        // The hint remains unsupported. Its failure cannot erase known USD US listings.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, hints.length) }, () => worker()));
  assertSession();
  return hints.filter((_hint, index) => approved[index]);
}

export function parseMarketDataMidpoints(
  payload: unknown, instruments: readonly (string | MarketDataMidpointInstrument)[], now = Date.now(), owner?: string,
): MarketDataMidpoint[] {
  const expected = instruments.map(midpointInstrument);
  if (!expected.length || expected.length > 80 || new Set(expected.map(row => row.ticker)).size !== expected.length
    || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid Market Data midpoint batch');
  }
  const data = payload as Record<string, unknown>;
  const symbols = data.symbol;
  const mids = data.mid;
  const updated = data.updated;
  if (data.s !== 'ok' || !Array.isArray(symbols) || !Array.isArray(mids) || !Array.isArray(updated)
    || symbols.length !== expected.length || mids.length !== expected.length || updated.length !== expected.length) {
    throw new Error('Invalid Market Data midpoint columns');
  }
  const byTicker = new Map(expected.map(row => [row.ticker, row.symbol]));
  const approved = new Set(expected.filter(row => row.custom === null
    || (owner && hasYahooPersonalListingAttestation(owner, row.custom))).map(row => row.ticker));
  if (!approved.size) throw new Error('Market Data custom listing requires current session metadata verification');
  const seen = new Set<string>();
  const result: MarketDataMidpoint[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const ticker: unknown = symbols[i];
    const mid: unknown = mids[i];
    const stamp: unknown = updated[i];
    if (typeof ticker !== 'string' || !byTicker.has(ticker) || seen.has(ticker)
      || typeof mid !== 'number' || !Number.isFinite(mid) || mid <= 0 || mid >= 1e8
      || typeof stamp !== 'number' || !Number.isSafeInteger(stamp)
      || stamp * 1000 < now - MAX_AGE_MS || stamp * 1000 > now + 5 * 60_000) {
      throw new Error('Invalid Market Data midpoint identity, price or observation time');
    }
    seen.add(ticker);
    if (!approved.has(ticker)) continue;
    result.push({ providerId: 'marketdata_personal_midpoint', assetSymbol: byTicker.get(ticker)!,
      providerSymbol: ticker, listingCurrency: 'USD', priceUsd: mid,
      observedAt: new Date(stamp * 1000).toISOString(), retrievedAt: new Date(now).toISOString(),
      priceType: 'indicative_model_midpoint', cacheStatus: 'miss' });
  }
  return result;
}

export async function loadMarketDataMidpoints(
  owner: string, instruments: readonly (string | MarketDataMidpointInstrument)[], signal?: AbortSignal,
): Promise<MarketDataMidpoint[]> {
  if (!hasMarketData(owner) || !credential) throw new Error('Market Data not connected');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!Array.isArray(instruments) || !instruments.length || instruments.length > 80) throw new Error('Invalid Market Data midpoint batch');
  const version = generation;
  const hints = instruments.flatMap(input => {
    try { return [midpointInstrument(input)]; } catch { return []; }
  });
  const verified = hints.some(hint => hint.custom) ? await verifyMidpointHints(owner, hints, version, signal) : hints;
  const identities = verified.filter(hint => !hint.custom || hasYahooPersonalListingAttestation(owner, hint.custom));
  if (!identities.length
    || new Set(identities.map(row => row.ticker)).size !== identities.length) throw new Error('Invalid Market Data midpoint batch');
  const url = new URL(MIDPOINT_BASE);
  url.search = new URLSearchParams({ symbols: identities.map(row => row.ticker).join(',') }).toString();
  if (url.href.length > 4094) throw new Error('Market Data midpoint batch URL is too long');
  consume(owner, identities.length); // Each symbol consumes a credit, even within one HTTP batch.
  const token = credential.token;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  pending.add(controller);
  const timer = setTimeout(abort, 8_000);
  try {
    const response = await fetch(url, { method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    // 203 is documented successful cached data; its updated[] times remain authoritative.
    if (!response.ok) { await response.body?.cancel(); throw upstreamError(response, owner); }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel();
      throw new Error('Market Data midpoint response unavailable');
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BODY) {
      await response.body.cancel(); throw new Error('Market Data response exceeds bounded size');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BODY) { await reader.cancel(); throw new Error('Market Data response exceeds bounded size'); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    if (controller.signal.aborted || version !== generation || !hasMarketData(owner)) {
      throw new DOMException('Market Data session inactive', 'AbortError');
    }
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new Error('Invalid Market Data midpoint response'); }
    return parseMarketDataMidpoints(payload, identities.map(row => row.custom ?? row.symbol), Date.now(), owner);
  } finally {
    clearTimeout(timer);
    pending.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
}

async function request(
  owner: string, token: string, symbol: string, signal?: AbortSignal,
): Promise<MarketDataDailySeries> {
  if (!activeOwner(owner) || !supportsMarketDataAsset(symbol) || signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  consume(owner);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  pending.add(controller);
  const timer = setTimeout(abort, 8_000);
  const version = generation;
  try {
    const url = new URL(BASE + encodeURIComponent(symbol) + '/');
    url.search = new URLSearchParams({
      countback: '100', adjustsplits: 'false', adjustdividends: 'false',
    }).toString();
    const response = await fetch(url, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) { await response.body?.cancel(); throw upstreamError(response, owner); }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Market Data response was unavailable');
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) throw new Error('Market Data response exceeds bounded size');
    if (!response.body) throw new Error('Market Data body unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BODY) {
          await reader.cancel();
          throw new Error('Market Data response exceeds bounded size');
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    if (controller.signal.aborted || version !== generation || !activeOwner(owner)) {
      throw new Error('Market Data response is no longer valid');
    }
    const parsed = parseMarketDataDaily(JSON.parse(body), symbol);
    historyCache.set(owner + ':' + symbol, { until: Date.now() + CACHE_MS, value: parsed });
    return parsed;
  } finally {
    clearTimeout(timer);
    pending.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
}

export async function connectMarketData(owner: string, raw: string, signal?: AbortSignal): Promise<void> {
  const token = validateToken(raw);
  clearMarketData();
  const version = generation;
  pendingOwner = owner;
  try {
    await request(owner, token, 'AAPL', signal);
    if (version !== generation || !activeOwner(owner) || signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    credential = { owner, token };
    emit();
  } finally {
    if (version === generation) pendingOwner = null;
  }
}

export async function loadMarketData(owner: string, symbol: string, signal?: AbortSignal): Promise<MarketDataDailySeries> {
  if (!hasMarketData(owner) || !credential) throw new Error('Market Data not connected');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const cached = historyCache.get(owner + ':' + symbol);
  if (cached && cached.until > Date.now()) return cached.value;
  const key = owner + ':' + symbol;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = request(owner, credential.token, symbol, signal);
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}
