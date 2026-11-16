'use client';

import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { supportsPersonalTiingoAsset } from './tiingo-asset-scope';
import { TiingoProviderError, type TiingoDailyPrice } from './tiingo';

// Every personal connection uses its own Tiingo token held in tab memory.
// Cloud requests require Firebase Auth; Local Personal has a separate
// loopback-only, origin-checked same-origin bridge without Firebase.

const SESSION_REQUEST_LIMIT = 25;
const MAX_LATEST_AGE_MS = 4 * 24 * 60 * 60_000;
const MAX_ROWS = 100;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

export const TIINGO_BROWSER_PROVIDER_CHANGE_EVENT = 'investatlas:tiingo-browser-provider-change';
export type TiingoBrowserStatus =
  | 'connected' | 'invalid_key' | 'rate_limited' | 'quota_exhausted'
  | 'provider_unavailable' | 'unexpected_response' | 'capability_unavailable';

export class TiingoBrowserError extends Error {
  constructor(
    public readonly status: Exclude<TiingoBrowserStatus, 'connected'>,
    public readonly diagnostic?: string,
  ) {
    super(status);
    this.name = 'TiingoBrowserError';
  }
}

export interface TiingoBrowserDailySeries {
  providerId: 'tiingo_browser_byok';
  assetSymbol: string;
  providerSymbol: string;
  listingCurrency: 'USD';
  retrievedAt: string;
  latestObservationAt: string;
  cacheStatus: 'miss';
  bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
}

type Session = { userId: string; apiKey: string };
let session: Session | null = null;
let pendingTestOwner: string | null = null;
let generation = 0;
const controllers = new Set<AbortController>();
// Tiingo Starter allows up to 50 requests/hour; use a stricter rolling
// 60-minute, 25-request tab budget. A UTC clock-hour reset could otherwise
// allow 50 requests in under a minute across the hour boundary.
const BUDGET_WINDOW_MS = 60 * 60_000;
const budgets = new Map<string, number[]>();

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT));
}
function owner(value: string): string {
  const id = value.trim();
  if (!id) throw new TiingoBrowserError('capability_unavailable');
  return id;
}
function key(value: string): string {
  const token = value.trim();
  if (!KEY_PATTERN.test(token)) throw new TiingoBrowserError('invalid_key');
  return token;
}
function invalidate(): void {
  generation += 1;
  controllers.forEach((controller) => controller.abort());
  controllers.clear();
}
function recentRequests(userId: string, now = Date.now()): number[] {
  return (budgets.get(userId) ?? []).filter(
    (at) => at > now - BUDGET_WINDOW_MS && at <= now,
  );
}
function consume(userId: string): void {
  const now = Date.now();
  const requests = recentRequests(userId, now);
  if (requests.length >= SESSION_REQUEST_LIMIT) throw new TiingoBrowserError('quota_exhausted');
  budgets.set(userId, [...requests, now]);
  emit();
}
export function getTiingoBrowserBudget(userId: string): { used: number; limit: number } {
  return { used: recentRequests(owner(userId)).length, limit: SESSION_REQUEST_LIMIT };
}
export function supportsTiingoBrowserAsset(symbol: string): boolean {
  return supportsPersonalTiingoAsset(symbol);
}
export function hasTiingoBrowserCredential(userId: string): boolean {
  return session?.userId === userId.trim();
}
export function setTiingoBrowserCredential(userId: string, apiKey: string): void {
  const next = { userId: owner(userId), apiKey: key(apiKey) };
  invalidate();
  session = next;
  emit();
}
export function clearTiingoBrowserCredential(): void {
  invalidate();
  pendingTestOwner = null;
  session = null;
  emit();
}
export function reconcileTiingoBrowserCredentialOwner(activeUserId: string | null): void {
  if ((session && session.userId !== activeUserId)
    || (pendingTestOwner && pendingTestOwner !== activeUserId)) clearTiingoBrowserCredential();
}
function normalize(rows: TiingoDailyPrice[], assetSymbol: string): TiingoBrowserDailySeries {
  const values = rows.slice(-MAX_ROWS).map((row) => ({
    date: row.date.slice(0, 10),
    open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
  }));
  const latest = values.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const latestAt = latest ? Date.parse(latest.date + 'T23:59:59Z') : NaN;
  if (!latest || !Number.isFinite(latestAt) || Date.now() - latestAt > MAX_LATEST_AGE_MS
    || latest.date > today || values.length < 2
    || values.some((bar) =>
      !(assetSymbol === 'BTC' || assetSymbol === 'ETH' ? Number.isFinite(bar.volume) : Number.isSafeInteger(bar.volume)) || bar.volume < 0
      || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0
      || bar.high < Math.max(bar.open, bar.close, bar.low)
      || bar.low > Math.min(bar.open, bar.close, bar.high))) {
    throw new TiingoBrowserError('unexpected_response');
  }
  return {
    providerId: 'tiingo_browser_byok',
    assetSymbol, providerSymbol: assetSymbol, listingCurrency: 'USD',
    retrievedAt: new Date().toISOString(),
    latestObservationAt: latest.date,
    cacheStatus: 'miss', bars: values,
  };
}
function classify(error: unknown): TiingoBrowserError {
  if (error instanceof TiingoBrowserError) return error;
  if (error instanceof TiingoProviderError) {
    const status = error.status;
    return new TiingoBrowserError(
      status === 'invalid_key' || status === 'rate_limited' || status === 'quota_exhausted'
        || status === 'capability_unavailable' || status === 'unexpected_response'
        ? status : 'provider_unavailable',
    );
  }
  return new TiingoBrowserError('provider_unavailable');
}
// Never put a personal token in the URL, logs, Firebase or shared caches.
// It crosses only over same-origin HTTPS (or local HTTP in development).
async function requestPersonalSeries(
  userId: string, apiKey: string, symbol: string, signal?: AbortSignal,
): Promise<TiingoDailyPrice[]> {
  const localPersonal = INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    && userId === LOCAL_PERSONAL_PROVIDER_OWNER_ID;
  const identity = localPersonal ? null : await getFirebaseApiIdentity();
  if ((!localPersonal && (!identity || identity.userId !== userId)) || signal?.aborted) {
    throw new TiingoBrowserError('provider_unavailable');
  }
  // Same-origin cookies are needed for Vercel's protected Preview login.
  // The personal Tiingo key is still sent only to our fixed same-origin path,
  // and Firebase Bearer authentication remains mandatory on the API route.
  let response: Response;
  try {
    response = await fetch(
    localPersonal ? '/api/local/tiingo/series' : '/api/financial-data/tiingo/local-series', {
    method: 'POST',
    headers: {
      ...(!localPersonal && identity ? { Authorization: `Bearer ${identity.token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey, symbol }),
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
    });
  } catch {
    // Never echo network exceptions: browser/SSO errors may contain URLs.
    throw new TiingoBrowserError('provider_unavailable', 'NETWORK');
  }
  const payload = await response.json().catch(() => null) as {
    code?: string; symbol?: unknown; data?: unknown;
  } | null;
  if (!response.ok) {
    const status = payload?.code;
    if (status === 'invalid_key' || status === 'rate_limited'
      || status === 'quota_exhausted' || status === 'unexpected_response'
      || status === 'capability_unavailable') throw new TiingoBrowserError(status, `HTTP ${response.status}`);
    throw new TiingoBrowserError('provider_unavailable', `HTTP ${response.status}`);
  }
  if (payload?.symbol !== symbol || !Array.isArray(payload.data)
    || payload.data.length < 2 || payload.data.length > MAX_ROWS
    || !payload.data.every((row: unknown) => {
      if (!row || typeof row !== 'object') return false;
      const item = row as Record<string, unknown>;
      return typeof item.date === 'string'
        && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(item.date)
        && ['open', 'high', 'low', 'close', 'volume'].every(
          (field) => typeof item[field] === 'number' && Number.isFinite(item[field]),
        );
    })) throw new TiingoBrowserError('unexpected_response', `HTTP ${response.status}`);
  return payload.data as TiingoDailyPrice[];
}

async function request(userId: string, apiKey: string, symbol: string, signal?: AbortSignal): Promise<TiingoBrowserDailySeries> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  consume(userId);
  const rows = await requestPersonalSeries(userId, apiKey, symbol, signal);
  if (signal?.aborted) throw new TiingoBrowserError('provider_unavailable');
  return normalize(rows, symbol);
}
export async function testTiingoBrowserCredential(
  userId: string, apiKey: string, signal?: AbortSignal,
): Promise<'connected'> {
  const id = owner(userId);
  const token = key(apiKey);
  const startGeneration = generation;
  pendingTestOwner = id;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  controllers.add(controller);
  try {
    await request(id, token, 'AAPL', controller.signal);
    if (startGeneration !== generation || pendingTestOwner !== id || signal?.aborted) {
      throw new TiingoBrowserError('provider_unavailable');
    }
    return 'connected';
  } catch (error) {
    throw classify(error);
  } finally {
    controllers.delete(controller);
    signal?.removeEventListener('abort', abort);
    if (pendingTestOwner === id) pendingTestOwner = null;
  }
}
export async function loadTiingoBrowserDailySeries(
  userId: string, symbol: string, signal?: AbortSignal,
): Promise<TiingoBrowserDailySeries> {
  const id = owner(userId);
  const ticker = symbol.trim().toUpperCase();
  if (!supportsTiingoBrowserAsset(ticker)) throw new TiingoBrowserError('capability_unavailable');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const active = session?.userId === id ? session : null;
  if (!active) throw new TiingoBrowserError('capability_unavailable');
  const startGeneration = generation;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  controllers.add(controller);
  try {
    const result = await request(id, active.apiKey, ticker, controller.signal);
    if (generation !== startGeneration || session?.userId !== id || session?.apiKey !== active.apiKey
      || signal?.aborted) throw new TiingoBrowserError('provider_unavailable');
    return result;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw classify(error);
  } finally {
    controllers.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
}
