'use client';

/**
 * Free keyless BTC/ETH USD spot quotations. Unlike XAU, these quote one coin,
 * never a troy ounce. Only the fixed documented Gold API public endpoints
 * are allowed; no Firebase identity or personal market-data key is sent.
 */
const BASE = 'https://api.gold-api.com/price/';
const CACHE_MS = 30_000;
const MAX_OBSERVATION_AGE_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_BODY_LENGTH = 8192;
export type PublicCryptoSymbol = 'BTC' | 'ETH';
export type PublicCryptoSpot = {
  symbol: PublicCryptoSymbol;
  priceUsdPerCoin: number;
  observedAt: string;
  retrievedAt: string;
};

const cache = new Map<PublicCryptoSymbol, { value: PublicCryptoSpot; until: number }>();

export function normalizePublicCryptoSpot(
  symbol: PublicCryptoSymbol,
  value: unknown,
  now: number,
): PublicCryptoSpot | null {
  if (symbol !== 'BTC' && symbol !== 'ETH') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.symbol !== symbol || row.currency !== 'USD'
    || typeof row.price !== 'number' || !Number.isFinite(row.price)
    || row.price <= 0 || row.price > 100_000_000
    || typeof row.updatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(row.updatedAt)) return null;
  const observed = Date.parse(row.updatedAt);
  if (!Number.isFinite(observed) || observed > now + MAX_CLOCK_SKEW_MS
    || now - observed > MAX_OBSERVATION_AGE_MS) return null;
  return {
    symbol, priceUsdPerCoin: row.price, observedAt: row.updatedAt,
    retrievedAt: new Date(now).toISOString(),
  };
}

export async function fetchPublicCryptoSpot(
  symbol: PublicCryptoSymbol, signal?: AbortSignal,
): Promise<PublicCryptoSpot | null> {
  if (symbol !== 'BTC' && symbol !== 'ETH') return null;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const now = Date.now();
  const existing = cache.get(symbol);
  if (existing && existing.until > now
    && now - Date.parse(existing.value.observedAt) <= MAX_OBSERVATION_AGE_MS) return existing.value;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 8_000);
  try {
    const response = await fetch(BASE + symbol, {
      method: 'GET', mode: 'cors', credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const size = Number(response.headers.get('content-length'));
    if (size > MAX_BODY_LENGTH) return null;
    const raw = await response.text();
    if (raw.length > MAX_BODY_LENGTH) return null;
    const quote = normalizePublicCryptoSpot(symbol, JSON.parse(raw), Date.now());
    if (quote) cache.set(symbol, { value: quote, until: Date.now() + CACHE_MS });
    return quote;
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export function clearPublicCryptoSpotCache(): void { cache.clear(); }
