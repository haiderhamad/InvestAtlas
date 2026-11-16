'use client';

import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { SOURCE_CHANGE } from './source-selection';
import {
  boundEodhdRange, EODHD_MAX_BARS, EODHD_MAX_BYTES, getEodhdTarget,
  validateEodhdKey, validEodhdDate,
  type EodhdDailySeries, type EodhdHistoryRange, type EodhdInstrument,
} from './eodhd-contract';

export type { EodhdDailySeries, EodhdHistoryRange, EodhdInstrument } from './eodhd-contract';
export const EODHD_CHANGE_EVENT = 'investatlas:eodhd-session-changed';
type Credential = { owner: string; key: string; historyYears: 1 | 5 };
let credential: Credential | null = null;
let pendingOwner: string | null = null;
let generation = 0;
const controllers = new Set<AbortController>();
const cooldowns = new Map<string, { status: number; until: number }>();

export class EodhdPersonalError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number) {
    super('Personal EODHD request unavailable');
    this.name = 'EodhdPersonalError';
  }
}

function active(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  return INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' ? !!owner && owner === current
    : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID
      && current === null && readAnonymousWorkspaceMode() === 'local_workspace';
}
function assertSession(owner: string, started: number, signal?: AbortSignal): void {
  if (!active(owner) || started !== generation || signal?.aborted) throw new DOMException('EODHD session inactive', 'AbortError');
}
function emit(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EODHD_CHANGE_EVENT));
    window.dispatchEvent(new Event(SOURCE_CHANGE));
  }
}
export function clearEodhd(): void {
  generation += 1;
  credential = null;
  pendingOwner = null;
  controllers.forEach(controller => controller.abort());
  controllers.clear();
  // A key/owner reset must not bypass an already observed provider cooldown.
  for (const [owner, value] of cooldowns) if (value.until <= Date.now()) cooldowns.delete(owner);
  emit();
}
export function reconcileEodhd(owner: string | null): void {
  if ((credential && credential.owner !== owner) || (pendingOwner && pendingOwner !== owner)) clearEodhd();
}
export function hasEodhd(owner: string): boolean { return active(owner) && credential?.owner === owner; }
export function readEodhdHistoryYears(owner: string): 1 | 5 { return hasEodhd(owner) && credential ? credential.historyYears : 1; }

function price(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e8;
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function sameRange(value: unknown, expected: EodhdHistoryRange): boolean {
  return object(value) && value.from === expected.from && value.to === expected.to;
}

function validateSeries(
  data: unknown, instrument: EodhdInstrument | string, range: EodhdHistoryRange, historyYears: 1 | 5,
): EodhdDailySeries {
  const now = Date.now();
  const target = getEodhdTarget(instrument);
  const bounds = boundEodhdRange(range, historyYears, now);
  if (!object(data) || data.providerId !== 'eodhd_personal_daily'
    || data.assetSymbol !== target.instrument.symbol || data.providerSymbol !== target.providerSymbol
    || data.exchange !== target.exchange || data.listingCurrency !== target.listingCurrency
    || data.adjustment !== 'raw_unadjusted' || data.volumeAdjustment !== 'splits' || data.cacheStatus !== 'miss'
    || typeof data.retrievedAt !== 'string'
    || !Number.isFinite(Date.parse(data.retrievedAt)) || new Date(Date.parse(data.retrievedAt)).toISOString() !== data.retrievedAt
    || Math.abs(Date.parse(data.retrievedAt) - now) > 10 * 60_000
    || !Array.isArray(data.bars) || data.bars.length > EODHD_MAX_BARS || !object(data.coverage)) {
    throw new Error('EODHD response identity or history contract mismatch');
  }
  const limited = bounds.requested.from !== bounds.checked.from || bounds.requested.to !== bounds.checked.to;
  const coverage = data.coverage;
  if (!sameRange(coverage.requested, bounds.requested) || !sameRange(coverage.checked, bounds.checked)
    || coverage.historyYears !== historyYears || coverage.limited !== limited) throw new Error('EODHD coverage mismatch');
  let prior = '';
  const today = new Date(now).toISOString().slice(0, 10);
  const bars: EodhdDailySeries['bars'] = [];
  for (const row of data.bars) {
    if (!object(row) || !validEodhdDate(row.date) || row.date <= prior || row.date >= today
      || row.date < bounds.checked.from || row.date > bounds.checked.to
      || ![row.open, row.high, row.low, row.close].every(price)
      || (row.high as number) < Math.max(row.open as number, row.close as number)
      || (row.low as number) > Math.min(row.open as number, row.close as number)
      || (row.volume !== null && (!Number.isSafeInteger(row.volume) || (row.volume as number) < 0))
      || (row.adjustedClose !== undefined && !price(row.adjustedClose))) throw new Error('Invalid EODHD candle');
    prior = row.date;
    bars.push({ date: row.date, open: row.open as number, high: row.high as number, low: row.low as number,
      close: row.close as number, volume: row.volume as number | null,
      ...(row.adjustedClose !== undefined ? { adjustedClose: row.adjustedClose as number } : {}) });
  }
  const available = bars.length ? { from: bars[0].date, to: bars[bars.length - 1].date } : null;
  if (data.latestObservationAt !== (available?.to ?? null)
    || (available ? !sameRange(coverage.available, available) : coverage.available !== null)) throw new Error('EODHD source time/coverage mismatch');
  // Build a new bounded result; do not return untrusted extra fields (including error strings).
  return { providerId: 'eodhd_personal_daily', assetSymbol: target.instrument.symbol,
    providerSymbol: target.providerSymbol, exchange: target.exchange, listingCurrency: target.listingCurrency,
    retrievedAt: data.retrievedAt, latestObservationAt: available?.to ?? null, cacheStatus: 'miss',
    adjustment: 'raw_unadjusted', volumeAdjustment: 'splits', bars,
    coverage: { requested: bounds.requested, checked: bounds.checked, available, historyYears, limited } };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('EODHD response unavailable');
  if (Number(response.headers.get('content-length') ?? 0) > EODHD_MAX_BYTES) {
    await response.body.cancel(); throw new Error('EODHD response exceeds bounded size');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > EODHD_MAX_BYTES) { await reader.cancel(); throw new Error('EODHD response exceeds bounded size'); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); } catch { throw new Error('Invalid EODHD response'); }
}

async function request(owner: string, body: Record<string, unknown>, started: number, signal?: AbortSignal): Promise<unknown> {
  assertSession(owner, started, signal);
  const blocked = cooldowns.get(owner);
  if (blocked && blocked.until > Date.now()) throw new EodhdPersonalError(blocked.status, Math.ceil((blocked.until - Date.now()) / 1000));
  const local = INVESTATLAS_DEPLOYMENT_MODE === 'local_personal';
  const identity = local ? null : await import('@/lib/auth/firebase-api-auth').then(module => module.getFirebaseApiIdentity());
  assertSession(owner, started, signal);
  if (!local && identity?.userId !== owner) throw new DOMException('EODHD owner session inactive', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort();
  controllers.add(controller);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 25_000);
  try {
    let response: Response;
    try {
      response = await fetch(local ? '/api/local/eodhd/history' : '/api/financial-data/eodhd/personal-history', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          ...(!local && identity ? { Authorization: 'Bearer ' + identity.token } : {}) },
        body: JSON.stringify(body), credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
    } catch {
      assertSession(owner, started, controller.signal);
      throw new EodhdPersonalError(503, 90);
    }
    assertSession(owner, started, controller.signal);
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
        : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : NaN;
      const cooldown = Number.isFinite(seconds) && seconds > 0 ? Math.min(604800, Math.ceil(seconds))
        : [401, 402, 403].includes(response.status) ? 3600 : 90;
      if ([401, 402, 403, 429].includes(response.status)) cooldowns.set(owner, { status: response.status, until: Date.now() + cooldown * 1000 });
      throw new EodhdPersonalError(response.status, cooldown);
    }
    const value = await boundedJson(response);
    assertSession(owner, started, controller.signal);
    return value;
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
    signal?.removeEventListener('abort', abort);
  }
}

export async function connectEodhd(owner: string, raw: string, historyYears: 1 | 5 = 1, signal?: AbortSignal): Promise<void> {
  const key = validateEodhdKey(raw);
  if (historyYears !== 1 && historyYears !== 5) throw new Error('Invalid EODHD entitlement depth');
  if (!active(owner) || signal?.aborted) throw new DOMException('EODHD session inactive', 'AbortError');
  clearEodhd();
  const started = generation;
  pendingOwner = owner;
  try {
    const result = await request(owner, { action: 'connect', key, historyYears }, started, signal);
    assertSession(owner, started, signal);
    if (!object(result) || result.connected !== true || result.historyYears !== historyYears) throw new Error('Invalid EODHD connection response');
    credential = { owner, key, historyYears };
    emit();
  } finally { if (started === generation) pendingOwner = null; }
}

export async function loadEodhdHistory(
  owner: string, instrument: EodhdInstrument | string, range: EodhdHistoryRange, signal?: AbortSignal,
): Promise<EodhdDailySeries> {
  if (!hasEodhd(owner) || !credential) throw new Error('EODHD not connected');
  const current = credential;
  getEodhdTarget(instrument);
  boundEodhdRange(range, current.historyYears);
  const started = generation;
  const value = await request(owner, { action: 'history', key: current.key, historyYears: current.historyYears, instrument, range }, started, signal);
  assertSession(owner, started, signal);
  return validateSeries(value, instrument, range, current.historyYears);
}
