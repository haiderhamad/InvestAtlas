'use client';

import { ANONYMOUS_WORKSPACE_MODE_EVENT, readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { BROWSER_WORKSPACE_CHANGE_EVENT, getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { normalizePersonalHistoryRange } from '@/lib/financial-data/history/request';
import { PUBLIC_SOURCE_CONSENT_EVENT } from '@/lib/financial-data/providers/public-source-consent';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import {
  getHistoryRepository, mergeHistoryRecord, planHistoryRanges,
  type HistoryCacheKey, type HistoryCacheRecord, type HistoryRange, type HistoryRepository,
} from '@/lib/financial-data/history/cache';

export interface PersonalHistoryFxRow { date: string; rate: number; asOf: string }

const DAY = 86_400_000;
const CARRY_DAYS = 7;
const MAX_CHUNK_DAYS = 400;
const MAX_BODY = 96 * 1024;
const MAX_FLIGHTS = 64;
const SOURCE_ATTRIBUTION = 'Source: ECB statistics.';

interface Scope { owner: string; installation: string; generation: number; key: HistoryCacheKey }
interface Flight {
  controller: AbortController;
  promise: Promise<PersonalHistoryFxRow[] | null>;
  waiters: number;
  settled: boolean;
}
const flights = new Map<string, Flight>();
// Overlapping windows queue behind one another and replan against newly cached
// coverage. This also keeps all chunk transport for one owner at <=2 requests.
const ownerTails = new Map<string, Promise<void>>();
let sessionGeneration = 0;
let observedWindow: Window | null = null;
const SESSION_EVENTS = [BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT, PUBLIC_SOURCE_CONSENT_EVENT, SOURCE_CHANGE];

function invalidateSession(): void {
  sessionGeneration += 1;
  flights.forEach(flight => flight.controller.abort());
  flights.clear();
}
function observeSession(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || observedWindow === window) return;
  if (observedWindow) {
    SESSION_EVENTS.forEach(event => observedWindow!.removeEventListener(event, invalidateSession));
    invalidateSession();
  }
  observedWindow = window;
  SESSION_EVENTS.forEach(event => window.addEventListener(event, invalidateSession));
}

function abortError(): DOMException { return new DOMException('Historical FX session inactive', 'AbortError'); }
function activeOwner(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  return INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' ? Boolean(owner) && current === owner
    : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && current === null
      && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID && readAnonymousWorkspaceMode() === 'local_workspace';
}
function installation(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const origin = window.location.origin;
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin
      ? origin + ':' + INVESTATLAS_DEPLOYMENT_MODE : null;
  } catch { return null; }
}
function assertActive(scope: Scope, signal?: AbortSignal): void {
  if (signal?.aborted || scope.generation !== sessionGeneration
    || !activeOwner(scope.owner) || installation() !== scope.installation) throw abortError();
}
function day(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp / DAY : null;
}
function date(value: number): string { return new Date(value * DAY).toISOString().slice(0, 10); }
function requestRange(start: string, end: string, now: number): HistoryRange | null {
  const range = normalizePersonalHistoryRange({ from: start, to: end }, now);
  return range ? { from: date(day(range.from)! - CARRY_DAYS), to: range.to } : null;
}

async function assertLease(scope: Scope, repository: HistoryRepository, epoch: number, signal: AbortSignal): Promise<void> {
  assertActive(scope, signal);
  const current = await repository.getOwnerEpoch(scope.installation, scope.owner);
  assertActive(scope, signal);
  if (current !== epoch) throw abortError();
}

function splitRanges(ranges: HistoryRange[]): HistoryRange[] {
  const chunks: HistoryRange[] = [];
  for (const range of ranges) {
    const last = day(range.to)!;
    for (let first = day(range.from)!; first <= last; first += MAX_CHUNK_DAYS) {
      chunks.push({ from: date(first), to: date(Math.min(first + MAX_CHUNK_DAYS - 1, last)) });
    }
  }
  return chunks;
}
function rowsFromRecord(record: HistoryCacheRecord | null, range: HistoryRange): PersonalHistoryFxRow[] | null {
  if (!record) return null;
  const rows: PersonalHistoryFxRow[] = [];
  for (const bar of record.bars) {
    if (bar.date < range.from || bar.date > range.to) continue;
    // Generic OHLC storage must still represent this exact reference-rate
    // contract. Never reinterpret a candle/adjusted series as native ECB FX.
    if (day(bar.date) === null || !Number.isFinite(bar.close) || bar.close <= 0
      || bar.open !== bar.close || bar.high !== bar.close || bar.low !== bar.close
      || bar.volume !== null || bar.adjustedClose !== undefined) return null;
    rows.push({ date: bar.date, rate: bar.close, asOf: bar.date });
  }
  return rows.length ? rows : null;
}

async function boundedJson(response: Response, guard: () => void): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw new Error('Historical FX JSON unavailable');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BODY) {
    await response.body.cancel(); guard();
    throw new Error('Historical FX response too large');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read(); guard();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); guard(); throw new Error('Historical FX response too large'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return JSON.parse(text) as unknown;
}

function parseRows(payload: unknown, range: HistoryRange): PersonalHistoryFxRow[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.status !== 'complete' || value.sourceAttribution !== SOURCE_ATTRIBUTION
    || (value.baseCurrency !== undefined && value.baseCurrency !== 'USD')
    || (value.quoteCurrency !== undefined && value.quoteCurrency !== 'EUR')
    || !Array.isArray(value.data) || value.data.length > MAX_CHUNK_DAYS) return null;
  const seen = new Set<string>();
  const rows: PersonalHistoryFxRow[] = [];
  for (const item of value.data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (day(row.date) === null || typeof row.date !== 'string' || row.asOf !== row.date
      || row.date < range.from || row.date > range.to || seen.has(row.date)
      || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0) return null;
    seen.add(row.date);
    rows.push({ date: row.date, rate: row.rate, asOf: row.date });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchChunk(scope: Scope, range: HistoryRange, signal: AbortSignal): Promise<{
  range: HistoryRange; rows: PersonalHistoryFxRow[]; retrievedAt: number;
} | null> {
  assertActive(scope, signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 8_000);
  const guard = () => { assertActive(scope, signal); if (controller.signal.aborted) throw abortError(); };
  try {
    const params = new URLSearchParams({ from: 'USD', to: 'EUR', startDate: range.from, endDate: range.to, exactWindow: 'true' });
    const response = await fetch('/api/financial-data/fx/history?' + params, {
      method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    guard();
    if (!response.ok) { await response.body?.cancel(); guard(); return null; }
    const payload = await boundedJson(response, guard);
    guard();
    const rows = parseRows(payload, range);
    return rows === null ? null : { range, rows, retrievedAt: Date.now() };
  } catch {
    assertActive(scope, signal); // An individual timeout/provider failure is a soft FX miss.
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

async function execute(
  scope: Scope, range: HistoryRange, repository: HistoryRepository, epoch: number, signal: AbortSignal,
): Promise<PersonalHistoryFxRow[] | null> {
  await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
  let record = await repository.read(scope.key); assertActive(scope, signal);
  await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
  const chunks = splitRanges(planHistoryRanges(record, range, Date.now()));
  const received: Array<Awaited<ReturnType<typeof fetchChunk>>> = new Array(chunks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < chunks.length) {
      const index = next++;
      received[index] = await fetchChunk(scope, chunks[index], signal); assertActive(scope, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, () => worker())); assertActive(scope, signal);
  await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
  for (const chunk of received) {
    if (!chunk) continue;
    const incoming: HistoryCacheRecord = {
      key: scope.key,
      bars: chunk.rows.map(row => ({ date: row.date, open: row.rate, high: row.rate, low: row.rate, close: row.rate, volume: null })),
      coverage: [chunk.range], retrievedAt: chunk.retrievedAt, lastCheckedAt: chunk.retrievedAt,
    };
    const merged = mergeHistoryRecord(record, incoming, chunk.range, Date.now());
    await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
    const written = await repository.write(merged, epoch, signal); assertActive(scope, signal);
    await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
    if (!written) return rowsFromRecord(record, range);
    record = merged;
  }
  await assertLease(scope, repository, epoch, signal); assertActive(scope, signal);
  return rowsFromRecord(record, range);
}

function subscribe(flight: Flight, scope: Scope, signal?: AbortSignal): Promise<PersonalHistoryFxRow[] | null> {
  assertActive(scope, signal);
  flight.waiters += 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      finished = true;
      signal?.removeEventListener('abort', cancel);
      flight.waiters -= 1;
      if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
    };
    const cancel = () => { if (!finished) { finish(); reject(abortError()); } };
    signal?.addEventListener('abort', cancel, { once: true });
    flight.promise.then(rows => {
      if (finished) return;
      try { assertActive(scope, signal); }
      catch (error) { finish(); reject(error); return; }
      finish();
      resolve(rows?.map(row => ({ ...row })) ?? null);
    }, error => { if (!finished) { finish(); reject(error); } });
  });
}

/** Reusable sourced USD→EUR history; a missing rate never becomes current FX. */
export async function loadPersonalHistoryFx(
  owner: string, startDate: string, endDate: string, signal?: AbortSignal,
): Promise<PersonalHistoryFxRow[] | null> {
  observeSession();
  const installed = installation();
  if (!installed || !activeOwner(owner) || signal?.aborted) throw abortError();
  const range = requestRange(startDate, endDate, Date.now());
  if (!range) return null;
  const scope: Scope = { owner, installation: installed, generation: sessionGeneration, key: {
    installation: installed, owner, instrument: 'USD-EUR', exchange: 'ECB', providerId: 'ecb_reference_rates',
    currency: 'EUR', interval: '1d', adjustment: 'reference_rate', version: 1,
  } };
  const repository = getHistoryRepository();
  let epoch: number;
  try { epoch = await repository.getOwnerEpoch(installed, owner); }
  catch { assertActive(scope, signal); return null; }
  assertActive(scope, signal);
  const ownerId = JSON.stringify([installed, owner]);
  const flightId = JSON.stringify([ownerId, epoch, scope.generation, range.from, range.to]);
  let flight = flights.get(flightId);
  if (!flight || flight.controller.signal.aborted) {
    if (flights.size >= MAX_FLIGHTS) return null;
    const controller = new AbortController();
    const previous = ownerTails.get(ownerId);
    const created: Flight = { controller, promise: Promise.resolve(null), waiters: 0, settled: false };
    created.promise = (async () => {
      if (previous) { await previous; assertActive(scope, controller.signal); }
      try { return await execute(scope, range, repository, epoch, controller.signal); }
      catch (error) {
        controller.abort();
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        assertActive(scope); // Storage/format failure is a soft miss for an otherwise active owner.
        return null;
      }
    })().then(rows => {
      created.settled = true;
      if (flights.get(flightId) === created) flights.delete(flightId);
      return rows;
    }, error => {
      created.settled = true;
      if (flights.get(flightId) === created) flights.delete(flightId);
      throw error;
    });
    const tail = created.promise.then(() => undefined, () => undefined);
    ownerTails.set(ownerId, tail);
    tail.then(() => { if (ownerTails.get(ownerId) === tail) ownerTails.delete(ownerId); });
    flights.set(flightId, created);
    flight = created;
  }
  return subscribe(flight, scope, signal);
}
