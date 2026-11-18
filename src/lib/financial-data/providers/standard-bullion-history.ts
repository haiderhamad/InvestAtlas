'use client';

import { readBoundedResponseJson, providerRequestSignal } from '@/lib/api/bounded-response';
import type { CloseOnlyHistoryBar, HistoryRange } from '@/lib/financial-data/history/cache';
import { normalizePersonalHistoryRange } from '@/lib/financial-data/history/request';
import { getPublicSourceConsentRevision, isPublicSourceApproved } from './public-source-consent';
import { readSourceSelection } from './source-selection';
import { activeMarketOwner } from './twelve-personal';

type Metal = 'GOLD' | 'SILVER';
const METALS = { GOLD: 'XAU', SILVER: 'XAG' } as const;
const ENDPOINT = 'https://standardbullion.com/api/v1/market/history';
const DAY = 86_400_000;
const COOLDOWN_MS = 90_000;
let retryUntil = 0;

export interface StandardBullionDailySeries {
  providerId: 'standard_bullion_daily';
  assetSymbol: Metal;
  providerSymbol: 'XAU' | 'XAG';
  listingCurrency: 'USD';
  exchange: 'INDICATIVE_DEALER';
  retrievedAt: string;
  latestObservationAt: string | null;
  bars: CloseOnlyHistoryBar[];
}

function metal(value: string): value is Metal { return value === 'GOLD' || value === 'SILVER'; }

function requestedPreset(requested: HistoryRange, now: number): '5y' | '1y' | null {
  for (const preset of ['5y', '1y'] as const) {
    const canonical = normalizePersonalHistoryRange({ range: preset }, now)!;
    if (requested?.from === canonical.from && requested.to === canonical.to) return preset;
  }
  return null;
}

/** Only genuine, completed daily close observations; never manufacture OHLC. */
export function normalizeStandardBullionHistory(
  symbol: string, requested: HistoryRange, payload: unknown, now = Date.now(),
): StandardBullionDailySeries | null {
  const preset = requestedPreset(requested, now);
  if (!metal(symbol) || !preset
    || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.source !== 'Standard Bullion' || row.url !== 'https://standardbullion.com'
    || row.metal !== METALS[symbol] || row.unit !== 'USD per troy ounce' || row.grain !== 'daily'
    || row.range !== preset
    || row.attribution !== 'Data by Standard Bullion — https://standardbullion.com'
    || !Array.isArray(row.points) || row.points.length === 0 || row.points.length > 2_200) return null;
  const bars: CloseOnlyHistoryBar[] = [];
  const today = Math.floor(now / DAY) * DAY;
  for (const raw of row.points) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const point = raw as Record<string, unknown>;
    if (typeof point.t !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(point.t)
      || typeof point.price !== 'number' || !Number.isFinite(point.price) || point.price <= 0 || point.price > 1e8) return null;
    const timestamp = Date.parse(point.t);
    const date = point.t.slice(0, 10);
    if (!Number.isSafeInteger(timestamp) || timestamp >= today
      || new Date(timestamp).toISOString() !== date + 'T00:00:00.000Z'
      || date < requested.from || date > requested.to || (bars.length && date <= bars[bars.length - 1].date)) return null;
    bars.push({ date, close: point.price, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' });
  }
  return { providerId: 'standard_bullion_daily', assetSymbol: symbol, providerSymbol: METALS[symbol],
    listingCurrency: 'USD', exchange: 'INDICATIVE_DEALER', retrievedAt: new Date(now).toISOString(),
    latestObservationAt: bars.at(-1)?.date ?? null, bars };
}

function aborted(): DOMException { return new DOMException('Metal history session changed', 'AbortError'); }

function assertActive(owner: string, revision: number, signal?: AbortSignal): void {
  if (signal?.aborted || !activeMarketOwner(owner) || !readSourceSelection(owner).bullion
    || !isPublicSourceApproved(owner, 'bullion') || getPublicSourceConsentRevision() !== revision) throw aborted();
}

class MetalHistoryUnavailableError extends Error {
  readonly retryAfterSeconds: number;
  constructor(until: number) {
    super('Standard Bullion history is temporarily unavailable');
    this.retryAfterSeconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  }
}

export async function loadStandardBullionHistory(
  owner: string, symbol: string, requested: HistoryRange, signal?: AbortSignal, started = Date.now(),
): Promise<StandardBullionDailySeries> {
  const revision = getPublicSourceConsentRevision();
  assertActive(owner, revision, signal);
  const preset = requestedPreset(requested, started);
  if (!metal(symbol) || !preset) throw new Error('Unsupported physical metal history');
  if (retryUntil > Date.now()) throw new MetalHistoryUnavailableError(retryUntil);
  // Explicit-date responses can contain observations outside their echoed window.
  const query = new URLSearchParams({ metal: METALS[symbol], range: preset });
  const requestSignal = providerRequestSignal(signal, 10_000);
  const response = await fetch(`${ENDPOINT}?${query}`, {
    method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
    redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: requestSignal,
  });
  assertActive(owner, revision, signal);
  if (!response.ok) {
    try { void response.body?.cancel().catch(() => undefined); } catch { /* Already closed. */ }
    const after = response.headers.get('retry-after');
    const requestedUntil = after && /^\d+$/.test(after) ? Date.now() + Number(after) * 1000
      : after ? Date.parse(after) : NaN;
    const until = Math.max(Date.now() + COOLDOWN_MS,
      Number.isFinite(requestedUntil) ? requestedUntil : 0,
      response.status === 403 ? Date.now() + 15 * 60_000 : 0);
    if (response.status === 429 || response.status === 403 || Number.isFinite(requestedUntil)) {
      retryUntil = Math.max(retryUntil, until);
    }
    throw new MetalHistoryUnavailableError(until);
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    try { void response.body?.cancel().catch(() => undefined); } catch { /* Already closed. */ }
    throw new Error('Invalid metal history content type');
  }
  const payload = await readBoundedResponseJson(response, 768 * 1024);
  assertActive(owner, revision, signal);
  const result = normalizeStandardBullionHistory(symbol, requested, payload, started);
  if (!result) throw new Error('Invalid physical metal history');
  return result;
}
