'use client';

import { getAssetConfig, type AssetConfig } from '@/lib/config/supported-assets';
import {
  readWorkspaceStorageItem,
  removeWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

const ALPHA_VANTAGE_ORIGIN = 'https://www.alphavantage.co';
const ALPHA_VANTAGE_PATH = '/query';
const ALPHA_VANTAGE_DAILY_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DAILY_ROWS = 100;
const CACHE_VERSION = 1;
const CACHE_STALE_MS = 48 * 60 * 60 * 1_000;
const MAX_LATEST_OBSERVATION_AGE_MS = 4 * 24 * 60 * 60 * 1_000;
const MAX_SUPPORTED_PRICE = 10_000_000;
const MAX_SUPPORTED_VOLUME = 10_000_000_000_000;
const CACHE_PREFIX = 'investatlas.alpha-vantage.normalized-market.v1';
const SIMPLE_US_TICKER = /^[A-Z][A-Z0-9.-]{0,14}$/;

const ALPHA_VANTAGE_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  NVDA: 'NVDA',
  AMZN: 'AMZN',
  GOOGL: 'GOOGL',
  META: 'META',
  TSLA: 'TSLA',
  HLAL: 'HLAL',
  UMMA: 'UMMA',
  SPUS: 'SPUS',
  SPWO: 'SPWO',
  SPTE: 'SPTE',
  SPRE: 'SPRE',
});
const ALPHA_VANTAGE_ASSET_SYMBOLS = Object.freeze(Object.keys(ALPHA_VANTAGE_SYMBOLS));

export const PERSONAL_MARKET_PROVIDER_CHANGE_EVENT =
  'investatlas:personal-market-provider-change';

export type AlphaVantageConnectionStatus =
  | 'connected'
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'provider_unavailable'
  | 'unexpected_response'
  | 'capability_unavailable';

export class AlphaVantageBrowserError extends Error {
  constructor(
    public readonly status: Exclude<AlphaVantageConnectionStatus, 'connected'>,
  ) {
    super(status);
    this.name = 'AlphaVantageBrowserError';
  }
}

export interface AlphaVantageDailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlphaVantageDailySeries {
  providerId: 'alpha_vantage_browser_byok';
  assetSymbol: string;
  providerSymbol: string;
  listingCurrency: 'USD';
  retrievedAt: string;
  latestObservationAt: string;
  cacheStatus: 'miss' | 'hit_fresh' | 'hit_stale';
  bars: AlphaVantageDailyBar[];
}

type StoredSeries = Omit<AlphaVantageDailySeries, 'cacheStatus'> & {
  version: 1;
  capabilities: ['quote', 'history'];
  quality: 'end_of_day';
  priceCurrency: 'USD';
  dataMode: 'personal_provider';
  cachedAt: string;
  expiresAt: string;
  staleUntil: string;
};

type SessionCredential = { userId: string; apiKey: string };
type SessionBudget = { utcDate: string; used: number };

let sessionCredential: SessionCredential | null = null;
let pendingCredentialTestOwner: string | null = null;
let credentialGeneration = 0;
const sessionBudgets = new Map<string, SessionBudget>();
const inFlightSeries = new Map<string, Promise<AlphaVantageDailySeries>>();
const activeRequestControllers = new Set<AbortController>();

function emitProviderChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PERSONAL_MARKET_PROVIDER_CHANGE_EVENT));
  }
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new AlphaVantageBrowserError('unexpected_response');
  return normalized;
}

function normalizeApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (
    normalized.length < 1
    || normalized.length > 256
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new AlphaVantageBrowserError('invalid_key');
  }
  return normalized;
}

function abortProviderRequests(): void {
  activeRequestControllers.forEach((controller) => controller.abort());
  activeRequestControllers.clear();
  inFlightSeries.clear();
  credentialGeneration += 1;
}

export function setAlphaVantageSessionCredential(userId: string, apiKey: string): void {
  const nextCredential = {
    userId: normalizeUserId(userId),
    apiKey: normalizeApiKey(apiKey),
  };
  abortProviderRequests();
  sessionCredential = nextCredential;
  emitProviderChange();
}

export function clearAlphaVantageSessionCredential(): void {
  abortProviderRequests();
  sessionCredential = null;
  emitProviderChange();
}

export function reconcileAlphaVantageCredentialOwner(activeUserId: string | null): void {
  if (pendingCredentialTestOwner && pendingCredentialTestOwner !== activeUserId) {
    pendingCredentialTestOwner = null;
    abortProviderRequests();
  }
  if (sessionCredential && sessionCredential.userId !== activeUserId) {
    clearAlphaVantageSessionCredential();
  }
}

export function hasAlphaVantageSessionCredential(userId: string): boolean {
  return sessionCredential?.userId === userId.trim();
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function budgetFor(userId: string): SessionBudget {
  const utcDate = currentUtcDate();
  const existing = sessionBudgets.get(userId);
  if (existing?.utcDate === utcDate) return existing;
  const fresh = { utcDate, used: 0 };
  sessionBudgets.set(userId, fresh);
  return fresh;
}

export function getAlphaVantageSessionBudget(userId: string): {
  used: number;
  limit: number;
  remainingEstimate: number;
} {
  const budget = budgetFor(normalizeUserId(userId));
  return {
    used: budget.used,
    limit: ALPHA_VANTAGE_DAILY_LIMIT,
    remainingEstimate: Math.max(0, ALPHA_VANTAGE_DAILY_LIMIT - budget.used),
  };
}

function consumeRequestBudget(userId: string): void {
  const budget = budgetFor(userId);
  if (budget.used >= ALPHA_VANTAGE_DAILY_LIMIT) {
    throw new AlphaVantageBrowserError('quota_exhausted');
  }
  budget.used += 1;
  emitProviderChange();
}

function providerSymbol(asset: AssetConfig): string | null {
  if (
    (asset.assetClass !== 'stock' && asset.assetClass !== 'etf')
    || asset.nativeCurrency !== 'usd'
  ) return null;
  const symbol = ALPHA_VANTAGE_SYMBOLS[asset.symbol] ?? '';
  return SIMPLE_US_TICKER.test(symbol) ? symbol : null;
}

export function supportsAlphaVantageBrowserAsset(symbol: string): boolean {
  const asset = getAssetConfig(symbol);
  return Boolean(asset && providerSymbol(asset));
}

function cacheKey(symbol: string): string {
  return `${CACHE_PREFIX}.${symbol.toUpperCase()}`;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= MAX_SUPPORTED_PRICE;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_SUPPORTED_VOLUME;
}

/** Only plain decimal provider metrics are valid; Number(null), Number(true),
 * and Number('0x10') must never become market observations. */
function parseProviderMetric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    return NaN;
  }
  return Number(value);
}

function validateStoredSeries(value: unknown, expectedSymbol: string): StoredSeries | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredSeries>;
  const expectedProviderSymbol = ALPHA_VANTAGE_SYMBOLS[expectedSymbol];
  const today = currentUtcDate();
  if (
    !expectedProviderSymbol
    || candidate.version !== CACHE_VERSION
    || candidate.capabilities?.join(',') !== 'quote,history'
    || candidate.quality !== 'end_of_day'
    || candidate.priceCurrency !== 'USD'
    || candidate.dataMode !== 'personal_provider'
    || candidate.providerId !== 'alpha_vantage_browser_byok'
    || candidate.assetSymbol !== expectedSymbol
    || candidate.providerSymbol !== expectedProviderSymbol
    || candidate.listingCurrency !== 'USD'
    || typeof candidate.retrievedAt !== 'string'
    || candidate.cachedAt !== candidate.retrievedAt
    || typeof candidate.expiresAt !== 'string'
    || typeof candidate.staleUntil !== 'string'
    || !isIsoDate(candidate.latestObservationAt)
    || candidate.latestObservationAt > today
    || !Array.isArray(candidate.bars)
    || candidate.bars.length < 2
    || candidate.bars.length > MAX_DAILY_ROWS
  ) return null;

  const now = Date.now();
  const retrievedAt = Date.parse(candidate.retrievedAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  const staleUntil = Date.parse(candidate.staleUntil);
  const latestAt = Date.parse(`${candidate.latestObservationAt}T23:59:59Z`);
  if (
    !Number.isFinite(retrievedAt)
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(staleUntil)
    || retrievedAt > now + 5 * 60_000
    || now - latestAt > MAX_LATEST_OBSERVATION_AGE_MS
    || expiresAt <= retrievedAt
    || expiresAt - retrievedAt > 4 * 24 * 60 * 60_000
    || staleUntil <= expiresAt
    || staleUntil - expiresAt > 3 * 24 * 60 * 60_000
  ) return null;

  let previousDate = '';
  for (const row of candidate.bars) {
    if (
      !row
      || typeof row !== 'object'
      || !isIsoDate(row.date)
      || row.date > today
      || row.date <= previousDate
      || !finitePositive(row.open)
      || !finitePositive(row.high)
      || !finitePositive(row.low)
      || !finitePositive(row.close)
      || !finiteNonNegative(row.volume)
      || row.low > Math.min(row.open, row.close, row.high)
      || row.high < Math.max(row.open, row.close, row.low)
    ) return null;
    previousDate = row.date;
  }
  if (candidate.bars.at(-1)?.date !== candidate.latestObservationAt) return null;
  return candidate as StoredSeries;
}

function safeRemoveCachedSeries(userId: string, symbol: string): void {
  try {
    removeWorkspaceStorageItem(cacheKey(symbol), { userId });
  } catch {
    // Cache cleanup must not block logout or account deletion.
  }
}

function readCachedSeries(
  userId: string,
  symbol: string,
  allowStale: boolean,
): AlphaVantageDailySeries | null {
  let raw: string | null;
  try {
    raw = readWorkspaceStorageItem(cacheKey(symbol), { userId });
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw.length > MAX_RESPONSE_BYTES) {
    safeRemoveCachedSeries(userId, symbol);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemoveCachedSeries(userId, symbol);
    return null;
  }
  const stored = validateStoredSeries(parsed, symbol);
  if (!stored) {
    safeRemoveCachedSeries(userId, symbol);
    return null;
  }
  const now = Date.now();
  const fresh = Date.parse(stored.expiresAt) > now;
  const withinStaleWindow = Date.parse(stored.staleUntil) > now;
  if (!fresh && !withinStaleWindow) {
    safeRemoveCachedSeries(userId, symbol);
    return null;
  }
  if (!fresh && !allowStale) return null;
  return {
    providerId: stored.providerId,
    assetSymbol: stored.assetSymbol,
    providerSymbol: stored.providerSymbol,
    listingCurrency: stored.listingCurrency,
    retrievedAt: stored.retrievedAt,
    latestObservationAt: stored.latestObservationAt,
    cacheStatus: fresh ? 'hit_fresh' : 'hit_stale',
    bars: stored.bars.map((bar) => ({ ...bar })),
  };
}

function nextExpectedRefreshAt(storedAt: number, latestObservationAt: string): number {
  const candidate = new Date(`${latestObservationAt}T23:30:00Z`);
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  candidate.setUTCHours(23, 30, 0, 0);
  while (
    candidate.getTime() <= storedAt
    || candidate.getUTCDay() === 0
    || candidate.getUTCDay() === 6
  ) candidate.setUTCDate(candidate.getUTCDate() + 1);
  // Never call an unexpectedly old observation fresh merely because it was
  // fetched recently. Four calendar days covers ordinary weekends but not an
  // unbounded provider gap.
  const latestFreshLimit = new Date(`${latestObservationAt}T23:30:00Z`);
  latestFreshLimit.setUTCDate(latestFreshLimit.getUTCDate() + 4);
  return Math.min(candidate.getTime(), latestFreshLimit.getTime());
}

function writeCachedSeries(userId: string, series: AlphaVantageDailySeries): void {
  const storedAt = Date.parse(series.retrievedAt);
  const expiresAt = nextExpectedRefreshAt(storedAt, series.latestObservationAt);
  const stored: StoredSeries = {
    version: CACHE_VERSION,
    capabilities: ['quote', 'history'],
    quality: 'end_of_day',
    priceCurrency: 'USD',
    dataMode: 'personal_provider',
    cachedAt: series.retrievedAt,
    providerId: series.providerId,
    assetSymbol: series.assetSymbol,
    providerSymbol: series.providerSymbol,
    listingCurrency: series.listingCurrency,
    retrievedAt: series.retrievedAt,
    latestObservationAt: series.latestObservationAt,
    expiresAt: new Date(expiresAt).toISOString(),
    staleUntil: new Date(Math.max(
      storedAt + CACHE_STALE_MS,
      expiresAt + 24 * 60 * 60_000,
    )).toISOString(),
    bars: series.bars.map((bar) => ({ ...bar })),
  };
  try {
    writeWorkspaceStorageItem(cacheKey(series.assetSymbol), JSON.stringify(stored), { userId });
  } catch {
    // The memory-only connector remains usable if local storage is blocked.
  }
}

export function clearAlphaVantageNormalizedCache(
  userId: string,
  symbols?: readonly string[],
): void {
  const owner = normalizeUserId(userId);
  // Deletion must win over a concurrent fetch, even when the remote provider
  // disregards abort. Preserve the memory-only key, but invalidate all pending
  // requests for this owner so they cannot repopulate the cleared cache.
  if (sessionCredential?.userId === owner || pendingCredentialTestOwner === owner) {
    abortProviderRequests();
  }
  const targets = symbols?.length
    ? symbols.map((symbol) => symbol.trim().toUpperCase())
    : ALPHA_VANTAGE_ASSET_SYMBOLS;
  targets.forEach((symbol) => safeRemoveCachedSeries(userId, symbol));
  emitProviderChange();
}

export function getAlphaVantageCachedSymbols(userId: string): string[] {
  return ALPHA_VANTAGE_ASSET_SYMBOLS.filter((symbol) =>
    Boolean(readCachedSeries(normalizeUserId(userId), symbol, true))
  );
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AlphaVantageBrowserError('unexpected_response');
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new AlphaVantageBrowserError('unexpected_response');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AlphaVantageBrowserError('unexpected_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function providerError(payload: Record<string, unknown>): AlphaVantageBrowserError | null {
  const message = [payload.Note, payload.Information, payload['Error Message']]
    .find((value): value is string => typeof value === 'string')
    ?.toLowerCase();
  if (!message) return null;
  if (message.includes('api key') && message.includes('invalid')) {
    return new AlphaVantageBrowserError('invalid_key');
  }
  if (message.includes('premium')) {
    return new AlphaVantageBrowserError('capability_unavailable');
  }
  if (message.includes('25 requests') || message.includes('daily rate limit')) {
    return new AlphaVantageBrowserError('quota_exhausted');
  }
  if (message.includes('rate limit') || message.includes('call frequency')) {
    return new AlphaVantageBrowserError('rate_limited');
  }
  return new AlphaVantageBrowserError('unexpected_response');
}

async function requestDailyPayload(
  userId: string,
  apiKey: string,
  symbol: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  consumeRequestBudget(userId);
  const url = new URL(ALPHA_VANTAGE_PATH, ALPHA_VANTAGE_ORIGIN);
  url.searchParams.set('function', 'TIME_SERIES_DAILY');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('outputsize', 'compact');
  url.searchParams.set('apikey', normalizeApiKey(apiKey));

  const controller = new AbortController();
  activeRequestControllers.add(controller);
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new AlphaVantageBrowserError('invalid_key');
    }
    if (response.status === 429) throw new AlphaVantageBrowserError('rate_limited');
    if (!response.ok) throw new AlphaVantageBrowserError('provider_unavailable');
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== ALPHA_VANTAGE_ORIGIN || finalUrl.pathname !== ALPHA_VANTAGE_PATH) {
        throw new AlphaVantageBrowserError('unexpected_response');
      }
    }
    const text = await readBoundedText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AlphaVantageBrowserError('unexpected_response');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AlphaVantageBrowserError('unexpected_response');
    }
    const error = providerError(payload as Record<string, unknown>);
    if (error) throw error;
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AlphaVantageBrowserError) throw error;
    if (signal?.aborted) throw error;
    throw new AlphaVantageBrowserError('provider_unavailable');
  } finally {
    activeRequestControllers.delete(controller);
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function parseDailySeries(
  payload: Record<string, unknown>,
  assetSymbol: string,
  expectedProviderSymbol: string,
): AlphaVantageDailySeries {
  const series = payload['Time Series (Daily)'];
  const metadata = payload['Meta Data'];
  if (!series || typeof series !== 'object' || Array.isArray(series)) {
    throw new AlphaVantageBrowserError('capability_unavailable');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new AlphaVantageBrowserError('unexpected_response');
  }
  const metaSymbol = (metadata as Record<string, unknown>)['2. Symbol'];
  if (
    typeof metaSymbol !== 'string'
    || metaSymbol.trim().toUpperCase() !== expectedProviderSymbol
  ) throw new AlphaVantageBrowserError('unexpected_response');

  const entries = Object.entries(series as Record<string, unknown>);
  if (entries.length < 2 || entries.length > MAX_DAILY_ROWS) {
    throw new AlphaVantageBrowserError('unexpected_response');
  }
  const today = currentUtcDate();
  const bars = entries.map(([date, raw]) => {
    if (
      !isIsoDate(date)
      || date > today
      || !raw
      || typeof raw !== 'object'
      || Array.isArray(raw)
    ) throw new AlphaVantageBrowserError('unexpected_response');
    const row = raw as Record<string, unknown>;
    const open = parseProviderMetric(row['1. open']);
    const high = parseProviderMetric(row['2. high']);
    const low = parseProviderMetric(row['3. low']);
    const close = parseProviderMetric(row['4. close']);
    const volume = parseProviderMetric(row['5. volume']);
    if (
      !finitePositive(open)
      || !finitePositive(high)
      || !finitePositive(low)
      || !finitePositive(close)
      || !finiteNonNegative(volume)
      || low > Math.min(open, close, high)
      || high < Math.max(open, close, low)
    ) throw new AlphaVantageBrowserError('unexpected_response');
    return { date, open, high, low, close, volume };
  }).sort((left, right) => left.date.localeCompare(right.date));

  const latest = bars.at(-1);
  if (!latest) throw new AlphaVantageBrowserError('unexpected_response');
  const latestTime = Date.parse(`${latest.date}T23:59:59Z`);
  if (Date.now() - latestTime > MAX_LATEST_OBSERVATION_AGE_MS) {
    throw new AlphaVantageBrowserError('unexpected_response');
  }
  return {
    providerId: 'alpha_vantage_browser_byok',
    assetSymbol,
    providerSymbol: expectedProviderSymbol,
    listingCurrency: 'USD',
    retrievedAt: new Date().toISOString(),
    latestObservationAt: latest.date,
    cacheStatus: 'miss',
    bars,
  };
}

export async function testAlphaVantageCredential(
  userId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AlphaVantageConnectionStatus> {
  const normalizedUserId = normalizeUserId(userId);
  pendingCredentialTestOwner = normalizedUserId;
  const generation = credentialGeneration;
  try {
    const payload = await requestDailyPayload(normalizedUserId, apiKey, 'AAPL', signal);
    if (pendingCredentialTestOwner !== normalizedUserId || credentialGeneration !== generation) {
      throw new AlphaVantageBrowserError('provider_unavailable');
    }
    // A connection test validates the provider response but intentionally does
    // not persist data: an auth transition must never leave a test result in
    // an account that did not complete the connection.
    parseDailySeries(payload, 'AAPL', 'AAPL');
    return 'connected';
  } finally {
    if (pendingCredentialTestOwner === normalizedUserId) {
      pendingCredentialTestOwner = null;
    }
  }
}

function waitForConsumer<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function loadAlphaVantageDailySeries(
  userId: string,
  symbol: string,
  signal?: AbortSignal,
  options: { allowStale?: boolean } = {},
): Promise<AlphaVantageDailySeries> {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedSymbol = symbol.trim().toUpperCase();
  const asset = getAssetConfig(normalizedSymbol);
  const ticker = asset ? providerSymbol(asset) : null;
  if (!asset || !ticker) throw new AlphaVantageBrowserError('capability_unavailable');
  // A cancelled consumer must not receive a cached quote as if its request
  // completed successfully, even when no network request is needed.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const fresh = readCachedSeries(normalizedUserId, normalizedSymbol, false);
  if (fresh) return fresh;
  const credential = sessionCredential?.userId === normalizedUserId
    ? sessionCredential
    : null;
  if (!credential) {
    const stale = options.allowStale
      ? readCachedSeries(normalizedUserId, normalizedSymbol, true)
      : null;
    if (stale) return stale;
    throw new AlphaVantageBrowserError('capability_unavailable');
  }

  const generation = credentialGeneration;
  const flightKey = `${normalizedUserId}:${normalizedSymbol}:${generation}`;
  const existing = inFlightSeries.get(flightKey);
  if (existing) return waitForConsumer(existing, signal);

  const request = requestDailyPayload(
    normalizedUserId,
    credential.apiKey,
    ticker,
  ).then((payload) => {
    if (
      generation !== credentialGeneration
      || sessionCredential?.userId !== normalizedUserId
      || sessionCredential.apiKey !== credential.apiKey
    ) throw new AlphaVantageBrowserError('provider_unavailable');
    const parsed = parseDailySeries(payload, normalizedSymbol, ticker);
    writeCachedSeries(normalizedUserId, parsed);
    return parsed;
  }).catch((error: unknown) => {
    // Stale-history fallback is allowed only for the same still-active tab
    // credential. Logout, account switch, cache clearing and key replacement
    // must invalidate the request instead of returning the old user's series.
    if (
      generation !== credentialGeneration
      || sessionCredential?.userId !== normalizedUserId
      || sessionCredential?.apiKey !== credential.apiKey
    ) throw error;
    if (options.allowStale) {
      const stale = readCachedSeries(normalizedUserId, normalizedSymbol, true);
      if (stale) return stale;
    }
    throw error;
  }).finally(() => {
    if (inFlightSeries.get(flightKey) === request) inFlightSeries.delete(flightKey);
  });
  inFlightSeries.set(flightKey, request);
  return waitForConsumer(request, signal);
}
