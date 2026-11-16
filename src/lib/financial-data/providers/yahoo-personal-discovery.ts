'use client';

import type { YahooPersonalListingCandidate, YahooPersonalListingResolution } from './yahoo-personal-discovery-server';
import { normalizePersonalListingIdentity, type PersonalListingIdentity } from '@/lib/config/personal-instrument';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import {
  getPublicSourceConsentRevision, isPublicSourceApproved, PUBLIC_SOURCE_CONSENT_EVENT,
} from './public-source-consent';
import { readSourceSelection, SOURCE_CHANGE } from './source-selection';
import { activeMarketOwner } from './twelve-personal';
import type { YahooPersonalDailySeries } from './yahoo-personal-server';

export type { YahooPersonalListingCandidate, YahooPersonalListingResolution } from './yahoo-personal-discovery-server';

const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const DAY = 86_400_000;
const COOLDOWN_MS = 90_000;
const pending = new Set<AbortController>();
const failures = new Map<string, { revision: number; until: number; error: Error }>();
type ListingAttestationIdentity = Pick<PersonalListingIdentity, 'symbol' | 'providerSymbol' | 'assetClass' | 'nativeCurrency' | 'exchange'>;
const attestations = new Map<string, { revision: number; generation: number; verifiedAt: number }>();
let generation = 0;
let observedWindow: Window | null = null;
const EVENTS = [BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT, PUBLIC_SOURCE_CONSENT_EVENT, SOURCE_CHANGE];

/** Resets pending work; finite upstream Retry-After values survive session changes. */
export function clearYahooPersonalDiscoverySession(): void {
  generation += 1;
  attestations.clear();
  pending.forEach(controller => controller.abort());
  pending.clear();
  for (const [owner, failure] of failures) {
    if (!Number.isFinite(failure.until) || failure.until <= Date.now()) failures.delete(owner);
  }
}

function observeSession(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || observedWindow === window) return;
  if (observedWindow) {
    EVENTS.forEach(event => observedWindow!.removeEventListener(event, clearYahooPersonalDiscoverySession));
    clearYahooPersonalDiscoverySession();
  }
  observedWindow = window;
  EVENTS.forEach(event => window.addEventListener(event, clearYahooPersonalDiscoverySession));
}

function attestationKey(owner: string, value: ListingAttestationIdentity): string {
  return JSON.stringify([owner, value.symbol, value.providerSymbol, value.assetClass, value.nativeCurrency, value.exchange]);
}

/** A read-only proof of successful metadata resolution in this consent session.
 * Imported/saved identities never populate this map. Monetary fields must all
 * match, and no attestation survives owner/source/consent reset or a full day.
 */
export function hasYahooPersonalListingAttestation(owner: string, value: ListingAttestationIdentity): boolean {
  observeSession();
  if (!value || typeof value !== 'object') return false;
  const key = attestationKey(owner, value);
  const attestation = attestations.get(key);
  if (!attestation || !sessionActive(owner, attestation.revision, attestation.generation)
    || Date.now() < attestation.verifiedAt || Date.now() - attestation.verifiedAt > DAY) {
    attestations.delete(key);
    return false;
  }
  return true;
}

function attestResolvedListing(owner: string, value: PersonalListingIdentity, revision: number, started: number): void {
  const key = attestationKey(owner, value);
  if (attestations.size >= 128 && !attestations.has(key)) attestations.delete(attestations.keys().next().value!);
  attestations.set(key, { revision, generation: started, verifiedAt: Date.now() });
}

function sessionActive(owner: string, revision: number, started: number, signal?: AbortSignal): boolean {
  return !signal?.aborted && generation === started && getPublicSourceConsentRevision() === revision
    && activeMarketOwner(owner) && isPublicSourceApproved(owner, 'yahoo') && readSourceSelection(owner).yahoo;
}

function assertSession(owner: string, revision: number, started: number, signal?: AbortSignal): void {
  if (!sessionActive(owner, revision, started, signal)) {
    throw new DOMException('Yahoo discovery session inactive', 'AbortError');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function candidate(value: unknown): YahooPersonalListingCandidate | null {
  if (!object(value) || typeof value.symbol !== 'string' || !SYMBOL.test(value.symbol)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256 || CONTROL.test(value.name)
    || (value.assetClass !== 'stock' && value.assetClass !== 'etf')
    || typeof value.exchange !== 'string' || !/^[A-Z0-9][A-Z0-9 ._-]{0,63}$/.test(value.exchange)) return null;
  return { symbol: value.symbol, name: value.name.trim(), assetClass: value.assetClass, exchange: value.exchange };
}

function candidates(value: unknown): YahooPersonalListingCandidate[] {
  if (!object(value) || !Array.isArray(value.candidates) || value.candidates.length > 8) {
    throw new Error('Invalid Yahoo discovery response');
  }
  const symbols = new Set<string>();
  return value.candidates.map((raw) => {
    const row = candidate(raw);
    if (!row || symbols.has(row.symbol)) throw new Error('Invalid Yahoo discovery candidate');
    symbols.add(row.symbol);
    return row;
  });
}

function isoDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
}

function isoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value ? stamp : null;
}

function price(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e8;
}

function validateSeries(value: unknown, listing: PersonalListingIdentity): YahooPersonalDailySeries {
  const now = Date.now();
  if (!object(value) || value.providerId !== 'yahoo_personal_daily'
    || value.assetSymbol !== listing.symbol || value.providerSymbol !== listing.providerSymbol
    || value.exchange !== listing.exchange || value.assetClass !== listing.assetClass
    || value.listingCurrency !== listing.nativeCurrency.toUpperCase() || value.cacheStatus !== 'miss'
    || isoTime(value.retrievedAt) === null || typeof value.latestObservationAt !== 'string'
    || !Array.isArray(value.bars) || value.bars.length < 2 || value.bars.length > 100) {
    throw new Error('Yahoo resolved series identity mismatch');
  }
  let previous = '';
  const bars: YahooPersonalDailySeries['bars'] = value.bars.map(raw => {
    if (!object(raw)) throw new Error('Invalid Yahoo resolved candle');
    const date = isoDay(raw.date);
    if (date === null || typeof raw.date !== 'string' || raw.date <= previous
      || date >= Math.floor(now / DAY) * DAY
      || !price(raw.open) || !price(raw.high) || !price(raw.low) || !price(raw.close)
      || raw.high < Math.max(raw.open, raw.close) || raw.low > Math.min(raw.open, raw.close)
      || (raw.volume !== null && (typeof raw.volume !== 'number' || !Number.isSafeInteger(raw.volume) || raw.volume < 0))) {
      throw new Error('Invalid Yahoo resolved candle');
    }
    previous = raw.date;
    return { date: raw.date, open: raw.open, high: raw.high, low: raw.low, close: raw.close, volume: raw.volume as number | null };
  });
  if (value.latestObservationAt !== previous || now - Date.parse(previous + 'T23:59:59Z') > 7 * DAY) {
    throw new Error('Yahoo resolved series is stale');
  }
  let current: YahooPersonalDailySeries['current'];
  if (object(value.current) && price(value.current.price)) {
    const stamp = isoTime(value.current.observedAt);
    if (stamp !== null && stamp >= now - 7 * DAY && stamp <= now + 300_000
      && stamp >= Date.parse(previous + 'T00:00:00Z')) {
      current = { price: value.current.price, observedAt: value.current.observedAt as string };
    }
  }
  return {
    providerId: 'yahoo_personal_daily', assetSymbol: listing.symbol, providerSymbol: listing.providerSymbol,
    exchange: listing.exchange, assetClass: listing.assetClass,
    listingCurrency: listing.nativeCurrency.toUpperCase() as 'USD' | 'EUR',
    retrievedAt: value.retrievedAt as string, latestObservationAt: previous, cacheStatus: 'miss', bars,
    ...(current ? { current } : {}),
  };
}

function resolution(value: unknown, symbol: string): YahooPersonalListingResolution {
  const instrument = object(value) ? normalizePersonalListingIdentity(value.instrument) : null;
  if (!instrument || instrument.symbol !== symbol || instrument.providerSymbol !== symbol) {
    throw new Error('Yahoo resolved listing identity mismatch');
  }
  return { instrument, ...(object(value) && value.series !== undefined
    ? { series: validateSeries(value.series, instrument) } : {}) };
}

async function readResponse(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new Error('Yahoo discovery unavailable');
  }
  if (Number(response.headers.get('content-length') ?? 0) > maximum) {
    await response.body.cancel();
    throw new Error('Yahoo discovery response too large');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new Error('Yahoo discovery response too large');
      body += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function failure(owner: string, revision: number, error: Error, until: number): void {
  if (failures.size >= 32 && !failures.has(owner)) failures.delete(failures.keys().next().value!);
  failures.set(owner, { revision, error, until });
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after');
  const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const delay = seconds !== null && Number.isSafeInteger(seconds) ? seconds * 1000
    : raw ? Date.parse(raw) - Date.now() : 0;
  return Number.isFinite(delay) ? Math.max(COOLDOWN_MS, delay) : COOLDOWN_MS;
}

async function request(owner: string, operation: 'search' | 'resolve', value: string, signal?: AbortSignal): Promise<unknown> {
  observeSession();
  const revision = getPublicSourceConsentRevision();
  const started = generation;
  assertSession(owner, revision, started, signal);
  const prior = failures.get(owner);
  if (prior && prior.until > Date.now()
    && (prior.revision === revision || Number.isFinite(prior.until))) throw prior.error;
  const controller = new AbortController();
  const abort = () => controller.abort();
  pending.add(controller);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  try {
    const local = INVESTATLAS_DEPLOYMENT_MODE === 'local_personal';
    const identity = local ? null : await import('@/lib/auth/firebase-api-auth')
      .then(module => module.getFirebaseApiIdentity());
    assertSession(owner, revision, started, controller.signal);
    if (!local && identity?.userId !== owner) throw new DOMException('Yahoo owner changed', 'AbortError');
    const endpoint = local ? '/api/local/yahoo/' + operation : '/api/financial-data/yahoo/personal-' + operation;
    const response = await fetch(endpoint, {
      method: 'POST', headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        ...(!local && identity ? { Authorization: 'Bearer ' + identity.token } : {}),
      }, body: JSON.stringify(operation === 'search' ? { query: value } : { symbol: value }),
      credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    assertSession(owner, revision, started, controller.signal);
    if (!response.ok) {
      const details = await readResponse(response, 4096, controller.signal).catch(() => null);
      assertSession(owner, revision, started, controller.signal);
      const denied = response.status === 401 || response.status === 403
        || (object(details) && details.code === 'provider_access_denied');
      const error = new Error(response.status === 429 ? 'Yahoo rate limit reached' : 'Yahoo discovery unavailable');
      failure(owner, revision, error, denied ? Infinity : Date.now() + retryAfterMs(response));
      throw error;
    }
    const payload = await readResponse(response, (operation === 'search' ? 64 : 160) * 1024, controller.signal);
    assertSession(owner, revision, started, controller.signal);
    const result = operation === 'search' ? candidates(payload) : resolution(payload, value);
    assertSession(owner, revision, started, controller.signal);
    if (operation === 'resolve') attestResolvedListing(owner, (result as YahooPersonalListingResolution).instrument, revision, started);
    return result;
  } catch (error) {
    if (!sessionActive(owner, revision, started, signal)
      || (error instanceof DOMException && error.name === 'AbortError' && !controller.signal.aborted)) {
      throw new DOMException('Yahoo discovery session inactive', 'AbortError');
    }
    if (failures.get(owner)?.error === error) throw error;
    const safeError = new Error('Yahoo discovery unavailable');
    failure(owner, revision, safeError, Date.now() + COOLDOWN_MS);
    throw safeError;
  } finally {
    clearTimeout(timeout);
    pending.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
}

export async function searchYahooPersonalListings(owner: string, query: string, signal?: AbortSignal): Promise<YahooPersonalListingCandidate[]> {
  if (typeof query !== 'string' || query.length > 80 || query.trim().length < 2 || CONTROL.test(query)) {
    throw new Error('Invalid Yahoo search query');
  }
  return await request(owner, 'search', query.trim(), signal) as YahooPersonalListingCandidate[];
}

export async function resolveYahooPersonalListing(owner: string, symbol: string, signal?: AbortSignal): Promise<YahooPersonalListingResolution> {
  if (typeof symbol !== 'string' || !SYMBOL.test(symbol)) throw new Error('Invalid Yahoo listing symbol');
  return await request(owner, 'resolve', symbol, signal) as YahooPersonalListingResolution;
}
