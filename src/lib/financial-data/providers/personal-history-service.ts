'use client';

import { getPersonalAssetConfig, getPersonalListingIdentity, USER_ASSETS_CHANGE_EVENT } from '@/lib/config/personal-asset-registry';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';
import {
  getHistoryRepository, mergeHistoryRecord, planHistoryRanges,
  type HistoryBar, type HistoryCacheKey, type HistoryCacheRecord, type HistoryRange,
} from '@/lib/financial-data/history/cache';
import { normalizePersonalHistoryRange } from '@/lib/financial-data/history/request';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import { eodhdYearCutoff, getEodhdTarget, type EodhdInstrument } from './eodhd-contract';
import { EODHD_CHANGE_EVENT, hasEodhd, loadEodhdHistory, readEodhdHistoryYears } from './eodhd-personal';
import { hasMarketData, loadMarketData, supportsMarketDataAsset } from './marketdata-personal';
import {
  getPublicSourceConsentRevision, isPublicSourceApproved, PUBLIC_SOURCE_CONSENT_EVENT,
} from './public-source-consent';
import { loadPublicExchangeSeries } from './public-exchange-browser';
import { readSourceSelection, SOURCE_CHANGE } from './source-selection';
import {
  hasTiingoBrowserCredential, loadTiingoBrowserDailySeries, supportsTiingoBrowserAsset, TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
} from './tiingo-browser';
import { activeMarketOwner, hasTwelve, loadTwelve, loadTwelveDemo, supportsTwelve } from './twelve-personal';
import { loadYahooPersonalDailySeries } from './yahoo-personal';
import { loadStandardBullionHistory } from './standard-bullion-history';

export type PersonalHistorySource = 'yahoo' | 'eodhd' | 'tiingo' | 'twelve' | 'marketdata' | 'binance' | 'kraken' | 'bullion' | 'twelve_demo';
export interface HybridDailySeries {
  providerId: string;
  assetSymbol: string;
  providerSymbol: string;
  listingCurrency: 'USD' | 'EUR';
  exchange?: string;
  retrievedAt: string;
  latestObservationAt: string | null;
  cacheStatus: 'miss' | 'hit_fresh' | 'hit_stale';
  bars: HistoryBar[];
  adjustment: 'raw_unadjusted';
  volumeAdjustment?: string;
  requestedRange: HistoryRange;
  availableRange: HistoryRange | null;
  coverageLimited: boolean;
  missingTradingDates?: string[];
  refreshFailed: boolean;
}
export const HISTORY_CACHE_CHANGE_EVENT = 'investatlas:personal-history-cache-change';

type NativeSeries = Pick<HybridDailySeries,
  'providerId' | 'assetSymbol' | 'providerSymbol' | 'listingCurrency' | 'retrievedAt' | 'latestObservationAt' | 'bars' | 'exchange' | 'missingTradingDates'>;
type MemoryHistoryRecord = HistoryCacheRecord & { missingTradingDates?: string[] };
type Context = {
  source: PersonalHistorySource; owner: string; symbol: string; range: HistoryRange;
  id: string; key: HistoryCacheKey; generation: number; consentRevision: number;
  instrument: EodhdInstrument | string;
};
type Pending = { owner: string; controller: AbortController; subscribers: number; settled: boolean; promise: Promise<HybridDailySeries | null> };
const DAY = 86_400_000;
const MAX_EPHEMERAL = 64;
const yahooHistory = new Map<string, MemoryHistoryRecord>();
const inFlight = new Map<string, Pending>();
const listingLocks = new Map<string, Promise<void>>();
const failures = new Map<string, number>();
const clearingOwners = new Set<string>();
let generation = 0;
let boundWindow: Window | undefined;
let foregroundWaiters = 0;
const warmed = new Set<string>();
let warmQueue: Array<{ owner: string; symbol: string }> = [];
let warmRunning: AbortController | null = null;
let warmStopped = false;
let idleHandle: { kind: 'idle'; id: number } | { kind: 'timer'; id: ReturnType<typeof setTimeout> } | null = null;

function abortError(): DOMException { return new DOMException('Personal history session changed', 'AbortError'); }
function installation(): string { return `${window.location.origin}:${INVESTATLAS_DEPLOYMENT_MODE}`; }
function emit(): void { window.dispatchEvent(new Event(HISTORY_CACHE_CHANGE_EVENT)); }

function invalidate(): void {
  generation += 1;
  cancelWarmup();
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
  yahooHistory.clear();
  listingLocks.clear();
}

function bindLifecycle(): void {
  if (typeof window === 'undefined' || boundWindow === window) return;
  boundWindow = window;
  for (const event of [SOURCE_CHANGE, PUBLIC_SOURCE_CONSENT_EVENT, EODHD_CHANGE_EVENT,
    TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
    ANONYMOUS_WORKSPACE_MODE_EVENT, USER_ASSETS_CHANGE_EVENT]) window.addEventListener(event, invalidate);
  window.addEventListener(BROWSER_WORKSPACE_CHANGE_EVENT, () => {
    invalidate(); warmed.clear(); warmStopped = false;
  });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelWarmup();
  });
}

function enabled(source: PersonalHistorySource, owner: string, symbol: string): boolean {
  if (!activeMarketOwner(owner) || clearingOwners.has(owner)) return false;
  const preferences = readSourceSelection(owner);
  if (source === 'yahoo') return preferences.yahoo && isPublicSourceApproved(owner, 'yahoo');
  if (source === 'bullion') return preferences.bullion === true && isPublicSourceApproved(owner, 'bullion');
  if (source === 'eodhd') return true; // Licensed history remains readable after the optional key is removed.
  if (source === 'binance' || source === 'kraken') return preferences[source] && isPublicSourceApproved(owner, source);
  if (source === 'tiingo') return hasTiingoBrowserCredential(owner) && supportsTiingoBrowserAsset(symbol);
  if (source === 'twelve') return hasTwelve(owner) && supportsTwelve(symbol);
  if (source === 'marketdata') return hasMarketData(owner) && supportsMarketDataAsset(symbol);
  return source === 'twelve_demo' && preferences.twelveDemo && symbol === 'AAPL';
}

function assertLive(context: Context, signal: AbortSignal): void {
  if (signal.aborted || generation !== context.generation
    || getPublicSourceConsentRevision() !== context.consentRevision
    || !enabled(context.source, context.owner, context.symbol)) throw abortError();
}

function contextFor(source: PersonalHistorySource, owner: string, symbol: string, requested: HistoryRange): Context | null {
  const range = normalizePersonalHistoryRange(requested);
  const asset = getPersonalAssetConfig(symbol);
  if (!range || !asset || !enabled(source, owner, symbol)) return null;
  const listing = getPersonalListingIdentity(symbol);
  let providerSymbol = asset.yahooSymbol ?? asset.symbol;
  let exchange = listing?.exchange ?? 'UNKNOWN';
  let currency = asset.nativeCurrency.toUpperCase() as 'USD' | 'EUR';
  const instrument = listing ?? symbol;
  if (source === 'eodhd') {
    try {
      const target = getEodhdTarget(instrument);
      providerSymbol = target.providerSymbol; exchange = target.exchange; currency = target.listingCurrency;
    } catch { return null; }
  }
  if (source === 'bullion') {
    if (symbol !== 'GOLD' && symbol !== 'SILVER') return null;
    providerSymbol = symbol === 'GOLD' ? 'XAU' : 'XAG';
    exchange = 'INDICATIVE_DEALER'; currency = 'USD';
  }
  if (currency !== 'USD' && currency !== 'EUR') return null;
  const key: HistoryCacheKey = { installation: installation(), owner, instrument: providerSymbol,
    exchange, providerId: source === 'eodhd' ? 'eodhd_personal_daily'
      : source === 'bullion' ? 'standard_bullion_daily' : 'yahoo_personal_daily',
    currency, interval: '1d', adjustment: 'raw_unadjusted', version: 1 };
  return { source, owner, symbol, range, key, instrument,
    id: JSON.stringify([key.installation, owner, source, symbol, providerSymbol, currency, exchange]),
    generation, consentRevision: getPublicSourceConsentRevision() };
}

function rememberYahoo(id: string, record: MemoryHistoryRecord): void {
  yahooHistory.set(id, record);
  if (yahooHistory.size > MAX_EPHEMERAL) {
    const oldest = [...yahooHistory].sort((a, b) => a[1].lastCheckedAt - b[1].lastCheckedAt)[0];
    yahooHistory.delete(oldest[0]);
  }
}

function available(bars: HistoryBar[]): HistoryRange | null {
  return bars.length ? { from: bars[0].date, to: bars[bars.length - 1].date } : null;
}

function sameRange(a: HistoryRange, b: HistoryRange): boolean { return a.from === b.from && a.to === b.to; }

type BullionPreset = '5y' | '1y';
type HistoryRequest = { preset: BullionPreset } | { checked: HistoryRange; preset?: undefined };

function bullionRequests(record: HistoryCacheRecord | null, requested: HistoryRange, now: number): HistoryRequest[] {
  // Keep legacy records usable through their normal refresh, including offline.
  if (record && !record.bullionPresets && !planHistoryRanges(record, requested, now).length) return [];
  const requests: HistoryRequest[] = [];
  for (const preset of ['5y', '1y'] as const) {
    const checked = normalizePersonalHistoryRange({ range: preset }, now)!;
    const from = requested.from > checked.from ? requested.from : checked.from;
    if (from > requested.to) continue;
    const checkedAt = record?.bullionPresets?.[preset];
    if (record && checkedAt !== undefined) {
      const previousWindow = normalizePersonalHistoryRange({ range: preset }, checkedAt)!;
      const previous = { key: record.key, bars: [], coverage: [previousWindow], retrievedAt: checkedAt, lastCheckedAt: checkedAt };
      if (!planHistoryRanges(previous, { from, to: requested.to }, now).length) continue;
    }
    requests.push({ preset });
  }
  return requests;
}

function mergeNative(context: Context, previous: MemoryHistoryRecord | null, native: NativeSeries, checked: HistoryRange,
  preset?: BullionPreset): MemoryHistoryRecord {
  if (native.assetSymbol !== context.symbol || native.providerId !== context.key.providerId
    || native.providerSymbol !== context.key.instrument || native.listingCurrency !== context.key.currency
    || typeof native.exchange !== 'string' || !native.exchange
    || (context.key.exchange !== 'UNKNOWN' && native.exchange !== context.key.exchange)
    || native.latestObservationAt !== (native.bars.at(-1)?.date ?? null)
    || native.bars.some(bar => bar.date < checked.from || bar.date > checked.to)) throw new Error('History listing mismatch');
  const retrievedAt = Date.parse(native.retrievedAt);
  if (!Number.isSafeInteger(retrievedAt) || new Date(retrievedAt).toISOString() !== native.retrievedAt) {
    throw new Error('Invalid history retrieval timestamp');
  }
  const now = Date.now();
  let bars = native.bars;
  let bullionPresets: HistoryCacheRecord['bullionPresets'];
  if (preset) {
    const annual = new Set(previous?.bullionPresets?.annualDates);
    const previousCheck = previous?.bullionPresets?.[preset] ?? 0;
    const olderResponse = retrievedAt < previousCheck;
    if (preset === '1y') {
      if (olderResponse) bars = bars.filter(bar => !annual.has(bar.date));
      for (const bar of bars) annual.add(bar.date);
    } else {
      // A late five-year response may fill gaps, but must preserve newer corrections and annual observations.
      const protectedDates = olderResponse ? new Set(previous?.bars.map(bar => bar.date)) : annual;
      bars = bars.filter(bar => !protectedDates.has(bar.date));
    }
    bullionPresets = { ...previous?.bullionPresets, [preset]: Math.max(previousCheck, retrievedAt), annualDates: [...annual].sort() };
  }
  const merged = mergeHistoryRecord(previous, {
    key: { ...context.key, exchange: native.exchange }, bars, coverage: [], retrievedAt, lastCheckedAt: now,
  }, checked, now);
  if (bullionPresets) return { ...merged, bullionPresets };
  if (context.source !== 'yahoo') return merged;
  const observedDates = new Set(native.bars.map(bar => bar.date));
  const missingTradingDates = [...new Set([
    ...(previous?.missingTradingDates ?? []).filter(date => !observedDates.has(date)),
    ...(native.missingTradingDates ?? []),
  ])].sort();
  // Retain explicitly absent sessions alongside the existing tab-only history.
  // Only a later authentic observation can resolve a previously explicit gap.
  const missing = new Set(missingTradingDates);
  return { ...merged, bars: merged.bars.filter(bar => !missing.has(bar.date)),
    ...(missingTradingDates.length ? { missingTradingDates } : {}) };
}

function resultFrom(context: Context, record: MemoryHistoryRecord | null, fetched: boolean, refreshFailed: boolean,
  volumeAdjustment?: string, knownExchange: string | null = record?.key.exchange ?? null): HybridDailySeries | null {
  if (!record) return null;
  const bars = record.bars.filter(bar => bar.date >= context.range.from && bar.date <= context.range.to).map(bar => ({ ...bar }));
  const span = available(bars);
  if (!span) return null;
  const now = Date.now();
  const end = Date.parse(context.range.to + 'T00:00:00Z');
  const tail = { from: new Date(Math.max(Date.parse(context.range.from + 'T00:00:00Z'), end - 6 * DAY)).toISOString().slice(0, 10), to: context.range.to };
  const stale = refreshFailed || planHistoryRanges(record, tail, now).length > 0
    || Date.parse(span.to + 'T00:00:00Z') < end - 7 * DAY;
  const uncovered = planHistoryRanges({ ...record, lastCheckedAt: now }, context.range, now).length > 0;
  const missingTradingDates = (record.missingTradingDates ?? []).filter(date => date >= context.range.from && date <= context.range.to);
  return {
    providerId: record.key.providerId, assetSymbol: context.symbol, providerSymbol: record.key.instrument,
    listingCurrency: record.key.currency, ...(knownExchange ? { exchange: knownExchange } : {}),
    retrievedAt: new Date(record.retrievedAt).toISOString(), latestObservationAt: span.to,
    cacheStatus: stale ? 'hit_stale' : fetched ? 'miss' : 'hit_fresh', bars, adjustment: 'raw_unadjusted',
    ...(volumeAdjustment ? { volumeAdjustment } : {}), requestedRange: { ...context.range }, availableRange: span,
    ...(missingTradingDates.length ? { missingTradingDates } : {}),
    coverageLimited: context.source === 'bullion' || missingTradingDates.length > 0 || uncovered || Date.parse(span.from + 'T00:00:00Z') > Date.parse(context.range.from + 'T00:00:00Z') + 7 * DAY
      || Date.parse(span.to + 'T00:00:00Z') < end - 7 * DAY,
    refreshFailed,
  };
}

function recordFailure(id: string, error: unknown): void {
  const retry = error && typeof error === 'object' && 'retryAfterSeconds' in error ? error.retryAfterSeconds : undefined;
  const seconds = typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? Math.min(retry, 604_800) : 90;
  failures.set(id, Date.now() + seconds * 1_000);
  for (const [key, until] of failures) if (until <= Date.now()) failures.delete(key);
  if (failures.size > 128) failures.delete(failures.keys().next().value!);
}

async function reusableHistory(context: Context, signal: AbortSignal): Promise<HybridDailySeries | null> {
  const repo = getHistoryRepository();
  const durable = context.source === 'eodhd' || context.source === 'bullion';
  const epoch = durable ? await repo.getOwnerEpoch(context.key.installation, context.owner) : 0;
  assertLive(context, signal);
  let record: MemoryHistoryRecord | null = durable ? await repo.read(context.key) : yahooHistory.get(context.id) ?? null;
  assertLive(context, signal);
  const connected = context.source !== 'eodhd' || hasEodhd(context.owner);
  const cutoff = context.source === 'eodhd' && connected ? eodhdYearCutoff(Date.now(), readEodhdHistoryYears(context.owner)) : null;
  const eligible: HistoryRequest[] = context.source === 'bullion' ? bullionRequests(record, context.range, Date.now())
    : planHistoryRanges(record, context.range, Date.now()).flatMap(range => {
      const from = cutoff && range.from < cutoff ? cutoff : range.from;
      return from > range.to ? [] : [{ checked: { from, to: range.to } }];
    });
  let fetched = false;
  let refreshFailed = false;
  if (connected && eligible.length) {
    for (const request of eligible) {
      const { preset } = request;
      const failureId = preset ? `${context.id}:${preset}` : context.id;
      if ((failures.get(failureId) ?? 0) > Date.now()) {
        refreshFailed = true;
        continue;
      }
      try {
        assertLive(context, signal);
        // Each preset uses its own request time for validation and saved coverage across UTC midnight.
        const startedAt = Date.now();
        const checked = request.preset ? normalizePersonalHistoryRange({ range: request.preset }, startedAt)! : request.checked;
        const native = preset ? await loadStandardBullionHistory(context.owner, context.symbol, checked, signal, startedAt)
          : context.source === 'eodhd' ? await loadEodhdHistory(context.owner, context.instrument, checked, signal)
            : await loadYahooPersonalDailySeries(context.owner, context.symbol, signal, checked);
        assertLive(context, signal);
        if (context.source === 'eodhd' && (!('coverage' in native) || !sameRange(native.coverage.checked, checked))) {
          throw new Error('History checked coverage mismatch');
        }
        if (preset) {
          const updated = await repo.update(context.key, current => mergeNative(context, current, native, checked, preset), epoch, signal);
          assertLive(context, signal);
          if (!updated) {
            if (await repo.getOwnerEpoch(context.key.installation, context.owner) !== epoch) throw abortError();
            throw new Error('Unable to merge bullion observations');
          }
          record = updated;
        } else {
          record = mergeNative(context, record, native, checked);
          if (durable) {
            const written = await repo.write(record, epoch, signal);
            assertLive(context, signal);
            if (!written && await repo.getOwnerEpoch(context.key.installation, context.owner) !== epoch) throw abortError();
          } else rememberYahoo(context.id, record);
        }
        assertLive(context, signal);
        fetched = true;
        failures.delete(failureId);
        emit();
      } catch (error) {
        assertLive(context, signal);
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        recordFailure(failureId, error);
        refreshFailed = true;
        if (!preset) break;
      }
    }
  }
  if (durable && await repo.getOwnerEpoch(context.key.installation, context.owner) !== epoch) throw abortError();
  assertLive(context, signal);
  return resultFrom(context, record, fetched, refreshFailed, context.source === 'eodhd' ? 'splits' : undefined);
}

async function legacyHistory(context: Context, signal: AbortSignal): Promise<HybridDailySeries | null> {
  try {
    assertLive(context, signal);
    const native = context.source === 'tiingo' ? await loadTiingoBrowserDailySeries(context.owner, context.symbol, signal)
      : context.source === 'twelve' ? await loadTwelve(context.owner, context.symbol, signal)
        : context.source === 'marketdata' ? await loadMarketData(context.owner, context.symbol, signal)
          : context.source === 'binance' || context.source === 'kraken' ? await loadPublicExchangeSeries(context.source, context.owner, context.symbol, signal)
            : await loadTwelveDemo(context.owner, context.symbol, signal);
    assertLive(context, signal);
    const span = available(native.bars);
    if (native.assetSymbol !== context.symbol || !span) return null;
    const now = Date.now();
    const record = mergeHistoryRecord(null, {
      key: { ...context.key, providerId: native.providerId, instrument: native.providerSymbol,
        currency: native.listingCurrency, exchange: 'exchange' in native && typeof native.exchange === 'string' ? native.exchange : context.source.toUpperCase() },
      bars: native.bars, retrievedAt: Date.parse(native.retrievedAt), lastCheckedAt: now, coverage: [],
    }, span, now);
    // Existing providers retain their own request/cache policies. Nothing is stored here.
    return resultFrom(context, record, true, false, undefined,
      'exchange' in native && typeof native.exchange === 'string' ? native.exchange : null);
  } catch {
    assertLive(context, signal);
    return null;
  }
}

async function perform(context: Context, signal: AbortSignal): Promise<HybridDailySeries | null> {
  if (context.source !== 'yahoo' && context.source !== 'eodhd' && context.source !== 'bullion') return legacyHistory(context, signal);
  const previous = listingLocks.get(context.id) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  listingLocks.set(context.id, held);
  try {
    await previous;
    assertLive(context, signal);
    return await reusableHistory(context, signal);
  } finally {
    release();
    if (listingLocks.get(context.id) === held) listingLocks.delete(context.id);
  }
}

function clone(series: HybridDailySeries | null): HybridDailySeries | null {
  return series && { ...series, bars: series.bars.map(bar => ({ ...bar })), requestedRange: { ...series.requestedRange },
    ...(series.missingTradingDates ? { missingTradingDates: [...series.missingTradingDates] } : {}),
    availableRange: series.availableRange && { ...series.availableRange } };
}

function subscribe(entry: Pending, signal?: AbortSignal, background = false): Promise<HybridDailySeries | null> {
  entry.subscribers += 1;
  if (!background) foregroundWaiters += 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (cancelled: boolean, result?: HybridDailySeries | null, error?: unknown) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', abort);
      entry.controller.signal.removeEventListener('abort', abort);
      entry.subscribers -= 1;
      if (!background) foregroundWaiters -= 1;
      if (!entry.settled && entry.subscribers === 0) entry.controller.abort();
      if (cancelled) reject(abortError());
      else if (error) reject(error);
      else resolve(clone(result ?? null));
      kickWarmup();
    };
    const abort = () => finish(true);
    signal?.addEventListener('abort', abort, { once: true });
    entry.controller.signal.addEventListener('abort', abort, { once: true });
    entry.promise.then(result => finish(!!signal?.aborted || entry.controller.signal.aborted, result),
      error => finish(!!signal?.aborted || entry.controller.signal.aborted, undefined, error));
    if (signal?.aborted || entry.controller.signal.aborted) finish(true);
  });
}

async function loadHistory(source: PersonalHistorySource, owner: string, symbol: string,
  range: HistoryRange, signal?: AbortSignal, background = false): Promise<HybridDailySeries | null> {
  bindLifecycle();
  if (signal?.aborted) throw abortError();
  if (typeof window === 'undefined') return null;
  const context = contextFor(source, owner, symbol, range);
  if (!context) return null;
  const id = JSON.stringify([context.id, context.range.from, context.range.to]);
  let entry = inFlight.get(id);
  if (entry?.controller.signal.aborted) { inFlight.delete(id); entry = undefined; }
  if (!entry) {
    if (inFlight.size >= 32) return null;
    entry = { owner, controller: new AbortController(), subscribers: 0, settled: false, promise: Promise.resolve(null) };
    const pending = entry;
    inFlight.set(id, pending);
    pending.promise = perform(context, pending.controller.signal).finally(() => {
      pending.settled = true;
      if (inFlight.get(id) === pending) inFlight.delete(id);
    });
  }
  return subscribe(entry, signal, background);
}

export function loadPersonalDailyHistory(source: PersonalHistorySource, owner: string, symbol: string,
  range: HistoryRange, signal?: AbortSignal): Promise<HybridDailySeries | null> {
  return loadHistory(source, owner, symbol, range, signal);
}

export async function getPersonalHistoryCacheStats(owner: string) {
  bindLifecycle();
  if (typeof window === 'undefined' || !activeMarketOwner(owner)) return {
    recordCount: 0, barCount: 0, persistence: getHistoryRepository().persistence, ephemeralRecordCount: 0, ephemeralBarCount: 0,
  };
  const started = generation;
  const result = await getHistoryRepository().stats(installation(), owner);
  if (generation !== started || !activeMarketOwner(owner)) throw abortError();
  const ephemeral = [...yahooHistory.values()].filter(record => record.key.owner === owner && record.key.installation === installation());
  return { ...result, ephemeralRecordCount: ephemeral.length, ephemeralBarCount: ephemeral.reduce((sum, record) => sum + record.bars.length, 0) };
}
export async function clearPersonalHistoryCache(owner: string): Promise<void> {
  bindLifecycle();
  if (typeof window === 'undefined' || !activeMarketOwner(owner)) throw abortError();
  clearingOwners.add(owner);
  invalidate();
  // Provider modules keep their own quotas/cooldowns; this clears only cached service failures.
  failures.clear();
  try { await getHistoryRepository().clearOwner(installation(), owner); }
  finally { clearingOwners.delete(owner); emit(); }
}

function cancelWarmup(): void {
  warmQueue = [];
  if (idleHandle?.kind === 'idle') window.cancelIdleCallback(idleHandle.id);
  else if (idleHandle?.kind === 'timer') clearTimeout(idleHandle.id);
  idleHandle = null;
  const running = warmRunning;
  warmRunning = null;
  running?.abort();
}

function visible(): boolean { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }

function kickWarmup(): void {
  if (idleHandle || warmRunning || warmStopped || foregroundWaiters > 0 || !warmQueue.length || !visible()) return;
  const callback = () => { idleHandle = null; void runWarmup(); };
  idleHandle = typeof window.requestIdleCallback === 'function'
    ? { kind: 'idle', id: window.requestIdleCallback(callback, { timeout: 1_000 }) }
    : { kind: 'timer', id: setTimeout(callback, 50) };
}

async function runWarmup(): Promise<void> {
  if (foregroundWaiters > 0 || warmRunning || warmStopped || !visible()) return;
  const item = warmQueue.shift();
  if (!item) return;
  if (!activeMarketOwner(item.owner) || !hasEodhd(item.owner) || readSourceSelection(item.owner).historyPreload === false) {
    warmQueue = []; return;
  }
  const controller = new AbortController();
  warmRunning = controller;
  try {
    const range = { from: eodhdYearCutoff(Date.now(), readEodhdHistoryYears(item.owner)),
      to: new Date(Math.floor(Date.now() / DAY) * DAY - DAY).toISOString().slice(0, 10) };
    const result = await loadHistory('eodhd', item.owner, item.symbol, range, controller.signal, true);
    if (!result || result.refreshFailed) { warmStopped = true; warmQueue = []; }
  } catch {
    // Session changes cancel the queue; errors never create unhandled background work.
    warmQueue = [];
  } finally {
    if (warmRunning === controller) warmRunning = null;
    kickWarmup();
  }
}

/** One sequential idle queue using the existing tab credential, without polling. */
export function schedulePersonalHistoryWarmup(owner: string, symbols: readonly string[]): void {
  bindLifecycle();
  if (typeof window === 'undefined' || !activeMarketOwner(owner) || !hasEodhd(owner) || !visible() || warmStopped
    || readSourceSelection(owner).historyPreload === false) return;
  for (const symbol of symbols.slice(0, 128)) {
    if (warmed.size >= 8) break;
    const asset = getPersonalAssetConfig(symbol);
    if (!asset || (asset.assetClass !== 'stock' && asset.assetClass !== 'etf')) continue;
    try {
      const target = getEodhdTarget(getPersonalListingIdentity(symbol) ?? symbol);
      const id = JSON.stringify([installation(), owner, target.providerSymbol, target.exchange, target.listingCurrency]);
      if (warmed.has(id)) continue;
      warmed.add(id);
      warmQueue.push({ owner, symbol });
    } catch { /* Exact cross-provider counterparts only. */ }
  }
  kickWarmup();
}
