'use client';

// Official CoinPaprika Free API, for consented personal non-commercial use.
// One fixed bulk request serves the catalog; no private key or user identifier.
const URL = 'https://api.coinpaprika.com/v1/tickers?quotes=USD';
const COINS: Readonly<Record<string, string>> = Object.freeze({
  BTC: 'btc-bitcoin', ETH: 'eth-ethereum', SOL: 'sol-solana', XRP: 'xrp-xrp',
  ADA: 'ada-cardano', DOT: 'dot-polkadot', LINK: 'link-chainlink', AVAX: 'avax-avalanche',
  MATIC: 'matic-polygon', ATOM: 'atom-cosmos', NEAR: 'near-near-protocol', SUI: 'sui-sui',
  INJ: 'inj-injective-protocol', RENDER: 'rndr-render-token', FET: 'fetch-ai', TAO: 'tao-bittensor',
  ARB: 'arb-arbitrum', OP: 'op-optimism', TIA: 'tia-celestia', SEI: 'sei-sei', APT: 'apt-aptos',
  ICP: 'icp-internet-computer', FIL: 'fil-filecoin', LTC: 'ltc-litecoin', IMX: 'imx-immutable-x',
  XLM: 'xlm-stellar', HBAR: 'hbar-hedera-hashgraph',
});
const SYMBOL_BY_ID = new Map(Object.entries(COINS).map(([symbol, id]) => [id, symbol]));
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 30 * 60_000;
const MAX_SKEW_MS = 5 * 60_000;
const CACHE_MS = 15 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;

export interface CoinPaprikaSpot {
  symbol: string;
  priceUsdPerCoin: number;
  observedAt: string;
  retrievedAt: string;
  providerId: 'coinpaprika_public';
}
type Snapshot = Map<string, CoinPaprikaSpot>;
type PendingRequest = {
  controller: AbortController;
  promise: Promise<Snapshot | null>;
  subscribers: number;
  settled: boolean;
  timedOut: boolean;
};
let cache: { until: number; values: Snapshot } | null = null;
let pending: PendingRequest | null = null;
let retryAt = 0;

export function supportsPublicCoinPaprikaAsset(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(COINS, symbol);
}

export function parseCoinPaprikaSpot(symbol: string, data: unknown, now: number): CoinPaprikaSpot | null {
  if (!supportsPublicCoinPaprikaAsset(symbol)
    || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const quotes = row.quotes;
  const usd = quotes && typeof quotes === 'object' && !Array.isArray(quotes)
    ? (quotes as Record<string, unknown>).USD : null;
  const price = usd && typeof usd === 'object' && !Array.isArray(usd)
    ? (usd as Record<string, unknown>).price : null;
  if (row.id !== COINS[symbol] || row.symbol !== symbol
    || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 1e9
    || typeof row.last_updated !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(row.last_updated)) return null;
  const observedAt = Date.parse(row.last_updated);
  if (!Number.isFinite(observedAt)
    || new Date(observedAt).toISOString().slice(0, 19) !== row.last_updated.slice(0, 19)
    || observedAt > now + MAX_SKEW_MS || now - observedAt > MAX_AGE_MS) return null;
  return Object.freeze({
    symbol, priceUsdPerCoin: price,
    observedAt: new Date(observedAt).toISOString(),
    retrievedAt: new Date(now).toISOString(),
    providerId: 'coinpaprika_public',
  });
}

function aborted(): DOMException { return new DOMException('Aborted', 'AbortError'); }

// A mocked/failed transport can ignore AbortSignal. Never wait on it or release
// its later result after cancellation or the provider timeout.
function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(aborted()); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(aborted()); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function cancelBody(response: Response): void {
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Already closed/locked. */ }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    cancelBody(response);
    throw new Error('Invalid bulk response size');
  }
  if (!response.body) throw new Error('Missing bulk response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = '';
  let completed = false;
  try {
    while (true) {
      const chunk = await untilAborted(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('Bulk response exceeds byte limit');
      content += decoder.decode(chunk.value, { stream: true });
    }
    if (signal.aborted) throw aborted();
    content += decoder.decode();
    completed = true;
    return JSON.parse(content);
  } finally {
    if (!completed) { try { void reader.cancel().catch(() => undefined); } catch { /* Stream failed. */ } }
    try { reader.releaseLock(); } catch { /* An aborted read may still be pending. */ }
  }
}

function cooldown(response?: Response): void {
  const now = Date.now();
  let until = now + FAILURE_COOLDOWN_MS;
  if (response?.status === 429) {
    const value = response.headers.get('retry-after');
    if (value) {
      const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
      const requested = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(value);
      if (Number.isFinite(requested)) until = Math.max(until, requested);
    }
  }
  retryAt = Math.max(retryAt, until);
}

async function loadSnapshot(request: PendingRequest): Promise<Snapshot | null> {
  const { signal } = request.controller;
  try {
    const response = await untilAborted(fetch(URL, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal,
    }), signal);
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      cooldown(response); cancelBody(response); return null;
    }
    const rows = await boundedJson(response, signal);
    if (!Array.isArray(rows)) throw new Error('Expected a ticker array');
    const values: Snapshot = new Map();
    const seenIds = new Set<string>();
    for (const data of rows) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const id = (data as Record<string, unknown>).id;
      if (typeof id !== 'string') continue;
      const symbol = SYMBOL_BY_ID.get(id);
      if (!symbol) continue;
      // Even an invalid second row makes this identity ambiguous. Later rows
      // cannot restore it; unrelated exact observations remain independently usable.
      if (seenIds.has(id)) { values.delete(symbol); continue; }
      seenIds.add(id);
      const spot = parseCoinPaprikaSpot(symbol, data, Date.now());
      if (spot) values.set(symbol, spot);
    }
    if (signal.aborted || pending !== request || request.subscribers === 0) return null;
    cache = { values, until: Date.now() + CACHE_MS };
    return values;
  } catch {
    if (pending === request && (!signal.aborted || request.timedOut)) cooldown();
    return null;
  }
}

function startRequest(): PendingRequest {
  const request: PendingRequest = {
    controller: new AbortController(), subscribers: 0, settled: false, timedOut: false,
    promise: Promise.resolve(null),
  };
  // Set ownership before invoking fetch, including a synchronously throwing fetch.
  pending = request;
  const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 8_000);
  request.promise = loadSnapshot(request).finally(() => {
    clearTimeout(timer); request.settled = true;
    if (pending === request) pending = null;
  });
  return request;
}

function subscribe(request: PendingRequest, symbol: string, signal?: AbortSignal): Promise<CoinPaprikaSpot | null> {
  request.subscribers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const detach = () => {
      finished = true;
      signal?.removeEventListener('abort', abort);
      request.subscribers--;
    };
    const abort = () => {
      if (finished) return;
      detach(); reject(aborted());
      if (request.subscribers === 0 && !request.settled) {
        if (pending === request) pending = null;
        request.controller.abort();
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    request.promise.then(values => {
      if (finished) return;
      if (signal?.aborted) { abort(); return; }
      detach();
      const value = !request.controller.signal.aborted ? values?.get(symbol) : null;
      resolve(value && isFresh(value, Date.now()) ? value : null);
    });
  });
}

function isFresh(value: CoinPaprikaSpot, now: number): boolean {
  const observed = Date.parse(value.observedAt);
  return observed <= now + MAX_SKEW_MS && now - observed <= MAX_AGE_MS;
}

export async function fetchPublicCoinPaprikaSpot(symbol: string, signal?: AbortSignal): Promise<CoinPaprikaSpot | null> {
  if (signal?.aborted) throw aborted();
  if (!supportsPublicCoinPaprikaAsset(symbol)) return null;
  const now = Date.now();
  if (cache && cache.until > now) {
    const existing = cache.values.get(symbol);
    return existing && isFresh(existing, now) ? existing : null;
  }
  if (retryAt > now) return null;
  return subscribe(pending ?? startRequest(), symbol, signal);
}

/** Clear observations and pending work; an upstream quota cooldown survives. */
export function clearCoinPaprikaSpotCache(): void {
  cache = null;
  const request = pending;
  pending = null;
  request?.controller.abort();
}
