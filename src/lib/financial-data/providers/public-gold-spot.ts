'use client';

/**
 * Indicative physical XAU/XAG spot in USD per fine troy ounce, as documented
 * by Gold API. Never a mining share, futures contract or metal-backed token.
 * Exact fixed endpoints only; no user credentials or identifiers are sent.
 */
export type PublicMetalSymbol = 'GOLD' | 'SILVER';
const ENDPOINTS: Record<PublicMetalSymbol, { symbol: string; url: string }> = {
  GOLD: { symbol: 'XAU', url: 'https://api.gold-api.com/price/XAU' },
  SILVER: { symbol: 'XAG', url: 'https://api.gold-api.com/price/XAG' },
};
const CACHE_MS = 30_000;
const MAX_OBSERVATION_AGE_MS = 90 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_BODY_BYTES = 8_192;
const FAILURE_COOLDOWN_MS = 30_000;

export interface PublicGoldSpot {
  priceUsdPerTroyOunce: number;
  observedAt: string;
  retrievedAt: string;
}
export interface PublicMetalSpot extends PublicGoldSpot { symbol: PublicMetalSymbol }
const cache = new Map<PublicMetalSymbol, { value: PublicMetalSpot; until: number }>();
const pending = new Set<AbortController>();
let retryAt = 0;

export function normalizePublicMetalSpot(
  symbol: PublicMetalSymbol, value: unknown, now: number,
): PublicMetalSpot | null {
  if ((symbol !== 'GOLD' && symbol !== 'SILVER')
    || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.symbol !== ENDPOINTS[symbol].symbol || row.currency !== 'USD'
    // The documented response has no unit field; an override is unverified.
    || row.unit !== undefined
    || typeof row.price !== 'number' || !Number.isFinite(row.price)
    || row.price <= 0 || row.price > 10_000_000
    || typeof row.updatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(row.updatedAt)) return null;
  const instant = Date.parse(row.updatedAt);
  if (!Number.isFinite(instant)
    || new Date(instant).toISOString().slice(0, 19) !== row.updatedAt.slice(0, 19)
    || instant > now + CLOCK_SKEW_MS
    || now - instant > MAX_OBSERVATION_AGE_MS) return null;
  return Object.freeze({
    symbol, priceUsdPerTroyOunce: row.price,
    observedAt: row.updatedAt, retrievedAt: new Date(now).toISOString(),
  });
}

/** Original XAU parser contract, retained for existing consumers. */
export function normalizePublicGoldSpot(value: unknown, now: number): PublicGoldSpot | null {
  const quote = normalizePublicMetalSpot('GOLD', value, now);
  return quote ? {
    priceUsdPerTroyOunce: quote.priceUsdPerTroyOunce,
    observedAt: quote.observedAt, retrievedAt: quote.retrievedAt,
  } : null;
}

function aborted(): DOMException { return new DOMException('Aborted', 'AbortError'); }

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
    cancelBody(response); throw new Error('Invalid metal response size');
  }
  if (!response.body) throw new Error('Missing metal response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let bytes = 0;
  let completed = false;
  try {
    while (true) {
      const chunk = await untilAborted(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('Metal response exceeds byte limit');
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

export async function fetchPublicMetalSpot(
  symbol: PublicMetalSymbol, signal?: AbortSignal,
): Promise<PublicMetalSpot | null> {
  if (signal?.aborted) throw aborted();
  if (symbol !== 'GOLD' && symbol !== 'SILVER') return null;
  const now = Date.now();
  const existing = cache.get(symbol);
  if (existing && existing.until > now
    && Date.parse(existing.value.observedAt) <= now + CLOCK_SKEW_MS
    && now - Date.parse(existing.value.observedAt) <= MAX_OBSERVATION_AGE_MS) return existing.value;
  if (retryAt > now) return null;
  const controller = new AbortController();
  pending.add(controller);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
  try {
    const response = await untilAborted(fetch(ENDPOINTS[symbol].url, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    }), controller.signal);
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      cooldown(response); cancelBody(response); return null;
    }
    const quote = normalizePublicMetalSpot(symbol, await boundedJson(response, controller.signal), Date.now());
    if (signal?.aborted) throw aborted();
    if (controller.signal.aborted) return null;
    if (quote) cache.set(symbol, { value: quote, until: Date.now() + CACHE_MS });
    else cooldown();
    return quote;
  } catch {
    if (signal?.aborted) throw aborted();
    if (!controller.signal.aborted || timedOut) cooldown();
    return null;
  } finally {
    clearTimeout(timeout); pending.delete(controller);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Original gold fetch API, with the same USD-per-troy-ounce fields. */
export async function fetchPublicGoldSpot(signal?: AbortSignal): Promise<PublicGoldSpot | null> {
  return fetchPublicMetalSpot('GOLD', signal);
}

/** Clear observations and pending work; an upstream quota cooldown survives. */
export function clearPublicGoldSpotCache(): void {
  cache.clear();
  for (const controller of pending) controller.abort();
  pending.clear();
}
