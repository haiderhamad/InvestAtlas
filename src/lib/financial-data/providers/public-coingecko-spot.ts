'use client';

import { readBoundedResponseJson } from '@/lib/api/bounded-response';

// Exact catalog identities, verified against CoinGecko's first-party price API.
// MATIC deliberately remains the legacy token, never its successor POL.
export const COINGECKO_PERSONAL_IDS: Readonly<Record<string, string>> = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
  DOT: 'polkadot', LINK: 'chainlink', AVAX: 'avalanche-2', MATIC: 'matic-network',
  ATOM: 'cosmos', NEAR: 'near', SUI: 'sui', INJ: 'injective-protocol',
  RENDER: 'render-token', FET: 'fetch-ai', TAO: 'bittensor', ARB: 'arbitrum',
  OP: 'optimism', TIA: 'celestia', SEI: 'sei-network', APT: 'aptos',
  ICP: 'internet-computer', FIL: 'filecoin', LTC: 'litecoin', IMX: 'immutable-x',
  XLM: 'stellar', HBAR: 'hedera-hashgraph',
});
const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price?'
  + new URLSearchParams({
    ids: Object.values(COINGECKO_PERSONAL_IDS).join(','),
    vs_currencies: 'usd', include_last_updated_at: 'true',
  });
const CACHE_MS = 15 * 60_000;
const MAX_AGE_MS = 30 * 60_000;
const MAX_BODY = 64 * 1024;
const FAILURE_COOLDOWN_MS = 60_000;

export interface CoinGeckoSpot {
  providerId: 'coingecko_public';
  symbol: string;
  priceUsdPerCoin: number;
  observedAt: string;
  retrievedAt: string;
}
type Batch = { values: Map<string, CoinGeckoSpot>; until: number };
type Pending = { controller: AbortController; subscribers: number; cancelledBySubscribers: boolean; promise: Promise<Batch | null> };
let cache: Batch | null = null;
let pending: Pending | null = null;
let cooldownUntil = 0;
let generation = 0;

export function supportsPublicCoinGeckoAsset(symbol: string): boolean {
  return Object.hasOwn(COINGECKO_PERSONAL_IDS, symbol);
}

export function parseCoinGeckoSpot(symbol: string, payload: unknown, now: number): CoinGeckoSpot | null {
  if (!supportsPublicCoinGeckoAsset(symbol) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const id = COINGECKO_PERSONAL_IDS[symbol];
  if (!Object.hasOwn(payload, id)) return null;
  const row = (payload as Record<string, unknown>)[id];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const { usd, last_updated_at: seconds } = row as Record<string, unknown>;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > 1e9
    || typeof seconds !== 'number' || !Number.isSafeInteger(seconds)
    || seconds < 1_400_000_000 || seconds * 1000 > now + 5 * 60_000
    || now - seconds * 1000 > MAX_AGE_MS) return null;
  return {
    providerId: 'coingecko_public', symbol, priceUsdPerCoin: usd,
    observedAt: new Date(seconds * 1000).toISOString(), retrievedAt: new Date(now).toISOString(),
  };
}

function abortError(): DOMException { return new DOMException('Aborted', 'AbortError'); }

function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(abortError()); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function fresh(value: CoinGeckoSpot, now: number): boolean {
  const age = now - Date.parse(value.observedAt);
  return age >= -5 * 60_000 && age <= MAX_AGE_MS;
}

function retryDelay(response: Response): number {
  const value = response.headers.get('retry-after');
  const delay = value && /^\d+$/.test(value) ? Number(value) * 1000
    : value ? Date.parse(value) - Date.now() : 0;
  return Number.isFinite(delay) ? Math.max(FAILURE_COOLDOWN_MS, delay) : FAILURE_COOLDOWN_MS;
}

function startBatch(): Pending {
  const controller = new AbortController();
  const started = generation;
  const task: Pending = { controller, subscribers: 0, cancelledBySubscribers: false, promise: Promise.resolve(null) };
  pending = task;
  task.promise = (async () => {
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await withinDeadline(fetch(ENDPOINT, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      }), controller.signal);
      if (started !== generation || controller.signal.aborted) return null;
      if (!response.ok) {
        cooldownUntil = Math.max(cooldownUntil, Date.now() + retryDelay(response));
        await response.body?.cancel();
        return null;
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected response');
      const payload = await withinDeadline(readBoundedResponseJson(response, MAX_BODY), controller.signal);
      if (started !== generation || controller.signal.aborted) return null;
      const now = Date.now();
      const values = new Map<string, CoinGeckoSpot>();
      for (const symbol of Object.keys(COINGECKO_PERSONAL_IDS)) {
        const value = parseCoinGeckoSpot(symbol, payload, now);
        if (value) values.set(symbol, value);
      }
      const batch = { values, until: now + CACHE_MS };
      cache = batch;
      return batch;
    } catch {
      if (started === generation && !task.cancelledBySubscribers) {
        cooldownUntil = Math.max(cooldownUntil, Date.now() + FAILURE_COOLDOWN_MS);
      }
      return null;
    } finally {
      clearTimeout(timer);
      if (pending === task) pending = null;
    }
  })();
  return task;
}

/** Low-frequency manual fallback, not a scheduled polling feed. No key or personal data is sent. */
export async function fetchPublicCoinGeckoSpot(symbol: string, signal?: AbortSignal): Promise<CoinGeckoSpot | null> {
  if (signal?.aborted) throw abortError();
  if (!supportsPublicCoinGeckoAsset(symbol)) return null;
  const now = Date.now();
  if (cache && cache.until > now) {
    const value = cache.values.get(symbol);
    return value && fresh(value, now) ? value : null;
  }
  if (cooldownUntil > now) return null;
  const task = pending ?? startBatch();
  task.subscribers += 1;
  return new Promise<CoinGeckoSpot | null>((resolve, reject) => {
    let finished = false;
    const finish = (aborted: boolean, batch?: Batch | null) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      task.subscribers -= 1;
      if (task.subscribers === 0 && pending === task) {
        pending = null;
        task.cancelledBySubscribers = aborted;
        task.controller.abort();
      }
      if (aborted) { reject(abortError()); return; }
      const value = batch?.values.get(symbol);
      resolve(value && fresh(value, Date.now()) ? value : null);
    };
    const onAbort = () => finish(true);
    signal?.addEventListener('abort', onAbort, { once: true });
    task.promise.then(batch => finish(!!signal?.aborted, batch), () => finish(!!signal?.aborted, null));
  });
}

/** Invalidates pending work without evading a real upstream cooldown. */
export function clearCoinGeckoSpotCache(): void {
  generation += 1;
  cache = null;
  pending?.controller.abort();
  pending = null;
  if (cooldownUntil <= Date.now()) cooldownUntil = 0;
}
