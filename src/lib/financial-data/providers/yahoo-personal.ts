'use client';

import { getAssetConfig as getCatalogAssetConfig } from '@/lib/config/supported-assets';
import { getPersonalAssetConfig as getAssetConfig, getPersonalListingIdentity } from '@/lib/config/personal-asset-registry';
import { normalizePersonalHistoryRange, type PersonalHistoryRange } from '@/lib/financial-data/history/request';
import { readBoundedResponseJson } from '@/lib/api/bounded-response';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { getPublicSourceConsentRevision, isPublicSourceApproved } from './public-source-consent';
import type { YahooPersonalDailySeries } from './yahoo-personal-server';

const CACHE_MS = 90_000;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_CURRENT_FUTURE_MS = 5 * 60_000;
const cache = new Map<string, { value: YahooPersonalDailySeries; expires: number }>();
type PendingYahoo = {controller:AbortController;subscribers:number;settled:boolean;promise:Promise<YahooPersonalDailySeries>};
const inFlight = new Map<string, PendingYahoo>();
const controllers = new Set<AbortController>();
let generation = 0;
const failures = new Map<string, { revision: number; until: number; error: Error }>();
const scopedFailures = new Map<string, { until: number; error: Error }>();

function assertSession(owner: string, revision: number, started: number, signal?: AbortSignal): void {
  if (signal?.aborted || generation !== started || getPublicSourceConsentRevision() !== revision
    || !active(owner) || !isPublicSourceApproved(owner, 'yahoo')) {
    throw new DOMException('Yahoo personal session inactive', 'AbortError');
  }
}

export function supportsYahooPersonalAsset(symbol: string): boolean {
  const asset = getAssetConfig(symbol);
  return Boolean(asset
    && (asset.assetClass === 'stock' || asset.assetClass === 'etf')
    && typeof asset.yahooSymbol === 'string'
    && /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(asset.yahooSymbol));
}

function active(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  if (INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud') {
    return !!owner && owner === current;
  }
  return INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID
    && current === null
    && readAnonymousWorkspaceMode() === 'local_workspace';
}

function validate(
  data: unknown, symbol: string, now = Date.now(), range?: PersonalHistoryRange,
): YahooPersonalDailySeries {
  if (!data || typeof data !== 'object') throw new Error('Invalid Yahoo series');
  const row = data as Partial<YahooPersonalDailySeries>;
  const asset = getAssetConfig(symbol);
  const listing = getCatalogAssetConfig(symbol) ? undefined : getPersonalListingIdentity(symbol);
  if (!asset || row.providerId !== 'yahoo_personal_daily'
    || row.assetSymbol !== symbol
    || row.providerSymbol !== asset?.yahooSymbol
    || row.listingCurrency !== asset.nativeCurrency.toUpperCase()
    || (listing && (row.exchange !== listing.exchange || row.assetClass !== listing.assetClass))
    || !Array.isArray(row.bars) || row.bars.length < (range ? 0 : 2) || row.bars.length > (range ? 2200 : 100)
    || row.cacheStatus !== 'miss'
    || (typeof row.latestObservationAt !== 'string' && !(range && row.latestObservationAt === null))) {
    throw new Error('Yahoo listing metadata mismatch');
  }
  let prior = '';
  for (const bar of row.bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || new Date(bar.date+'T00:00:00Z').toISOString().slice(0,10)!==bar.date || bar.date <= prior
      || (range && (bar.date < range.from || bar.date > range.to))
      || ![bar.open, bar.high, bar.low, bar.close].every((n) =>
        typeof n === 'number' && Number.isFinite(n) && n > 0)
      || bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close)
      || (bar.volume !== null && (!Number.isSafeInteger(bar.volume) || bar.volume < 0))) {
      throw new Error('Invalid Yahoo daily candle');
    }
    prior = bar.date;
  }
  if (row.latestObservationAt !== (prior || null)
    || (!range && now - Date.parse(prior + 'T23:59:59Z') > MAX_AGE_MS)
    || Date.parse(prior + 'T00:00:00Z') >= Math.floor(now / 86_400_000) * 86_400_000) {
    throw new Error('Yahoo daily quote is stale or incomplete');
  }
  if (row.missingTradingDates !== undefined) {
    if (!Array.isArray(row.missingTradingDates) || row.missingTradingDates.length > (range ? 2200 : 110)) {
      throw new Error('Invalid Yahoo missing trading dates');
    }
    let previousMissing = '';
    const observedDates = new Set(row.bars.map(bar => bar.date));
    for (const date of row.missingTradingDates) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
        || date <= previousMissing || observedDates.has(date)
        || Date.parse(date + 'T00:00:00Z') >= Math.floor(now / 86_400_000) * 86_400_000
        || (range && (date < range.from || date > range.to))) {
        throw new Error('Invalid Yahoo missing trading date');
      }
      previousMissing = date;
    }
  }
  // Validate the optional field independently of the server. Incomplete or
  // malformed current metadata leaves the completed EOD fallback available.
  const { current: rawCurrent, ...series } = row;
  let current: YahooPersonalDailySeries['current'];
  if (!range && rawCurrent && typeof rawCurrent === 'object') {
    const { price, observedAt } = rawCurrent;
    const timestamp = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 1e8
      && Number.isSafeInteger(timestamp)
      && typeof observedAt === 'string' && new Date(timestamp).toISOString() === observedAt
      && timestamp >= now - MAX_AGE_MS && timestamp <= now + MAX_CURRENT_FUTURE_MS
      && timestamp >= Date.parse(prior + 'T00:00:00Z')) {
      current = { price, observedAt };
    }
  }
  return { ...series, ...(current ? { current } : {}) } as YahooPersonalDailySeries;
}

async function request(owner: string, symbol: string, revision: number, started: number, failureKey: string, signal?: AbortSignal, range?: PersonalHistoryRange): Promise<YahooPersonalDailySeries> {
  const local = INVESTATLAS_DEPLOYMENT_MODE === 'local_personal';
  const identity = local ? null : await import('@/lib/auth/firebase-api-auth')
    .then(({ getFirebaseApiIdentity }) => getFirebaseApiIdentity());
  assertSession(owner, revision, started, signal);
  if (local ? owner !== LOCAL_PERSONAL_PROVIDER_OWNER_ID : identity?.userId !== owner) {
    throw new DOMException('Yahoo personal session inactive', 'AbortError');
  }
  const endpoint = local
    ? '/api/local/yahoo/series'
    : '/api/financial-data/yahoo/personal-series';
  const listing = getCatalogAssetConfig(symbol) ? undefined : getPersonalListingIdentity(symbol);
  const controller = new AbortController();
  controllers.add(controller);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 10_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(!local && identity ? { Authorization: 'Bearer ' + identity.token } : {}),
      },
      body: JSON.stringify({ symbol, ...(listing?{listing}:{}), ...(range?{range}:{}) }),
      credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) {
      assertSession(owner, revision, started, controller.signal);
      const error = new Error(response.status === 429 ? 'Yahoo rate limit reached' : 'Yahoo response unavailable');
      let blocked = response.status === 401 || response.status === 403;
      if (response.status === 503) {
        const details: unknown = await response.json().catch(() => null);
        blocked = !!details && typeof details === 'object'
          && (details as { code?: unknown }).code === 'provider_access_denied';
      }
      assertSession(owner, revision, started, controller.signal);
      const retryAfter = response.headers.get('retry-after');
      const retryMs = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      if (blocked || response.status === 429 || (Number.isFinite(retryMs) && retryMs > 0)) {
        failures.set(owner, { revision, error, until: blocked
          ? Infinity : Date.now() + Math.max(CACHE_MS, Number.isFinite(retryMs) ? retryMs : 0) });
      } else {
        // A bad listing or history window must not suppress unrelated requests.
        scopedFailures.set(failureKey, { error, until: Date.now() + CACHE_MS });
        for (const [key, failure] of scopedFailures) if (failure.until <= Date.now()) scopedFailures.delete(key);
        if (scopedFailures.size > 128) scopedFailures.delete(scopedFailures.keys().next().value!);
      }
      throw error;
    }
    const value = validate(await readBoundedResponseJson(response, range ? 768*1024 : 160*1024), symbol, Date.now(), range);
    assertSession(owner, revision, started, controller.signal);
    return value;
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function loadYahooPersonalDailySeries(
  owner: string, symbol: string, signal?: AbortSignal, requestedRange?: PersonalHistoryRange,
): Promise<YahooPersonalDailySeries> {
  if (!supportsYahooPersonalAsset(symbol) || !active(owner)
    || !isPublicSourceApproved(owner, 'yahoo') || signal?.aborted) {
    throw new DOMException('Yahoo not enabled for this personal session', 'AbortError');
  }
  const revision = getPublicSourceConsentRevision();
  const started = generation;
  const range = requestedRange ? normalizePersonalHistoryRange(requestedRange) : undefined;
  if (requestedRange && !range) throw new Error('Invalid Yahoo history interval');
  const failure = failures.get(owner);
  if (failure && failure.until > Date.now()
    && (failure.revision === revision || Number.isFinite(failure.until))) throw failure.error;
  const asset = getAssetConfig(symbol)!;
  const listing = getPersonalListingIdentity(symbol);
  const key = [owner,revision,symbol,asset.yahooSymbol,asset.nativeCurrency,listing?.exchange??'',range?.from??'',range?.to??''].join(':');
  const scopedFailure = scopedFailures.get(key);
  if (scopedFailure && scopedFailure.until > Date.now()) throw scopedFailure.error;
  const stored = cache.get(key);
  if (stored && stored.expires > Date.now()) return validate(stored.value, symbol, Date.now(), range ?? undefined);
  let pending = inFlight.get(key);
  if (!pending) {
    const controller = new AbortController();
    controllers.add(controller);
    pending = {controller,subscribers:0,settled:false,promise:Promise.resolve(null as unknown as YahooPersonalDailySeries)};
    const entry=pending;
    inFlight.set(key,entry);
    entry.promise=request(owner,symbol,revision,started,key,controller.signal,range??undefined).then(value=>{
      assertSession(owner,revision,started,controller.signal);
      cache.set(key,{value,expires:Date.now()+CACHE_MS});return value;
    }).finally(()=>{
      entry.settled=true;controllers.delete(controller);
      if(inFlight.get(key)===entry) inFlight.delete(key);
    });
  }
  const entry=pending;entry.subscribers+=1;
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(cancelled:boolean,value?:YahooPersonalDailySeries,error?:unknown)=>{
      if(finished)return;finished=true;signal?.removeEventListener('abort',abort);entry.subscribers-=1;
      if(!entry.settled&&entry.subscribers===0)entry.controller.abort();
      if(cancelled){reject(new DOMException('Aborted','AbortError'));return;}
      try{assertSession(owner,revision,started,signal);if(error)reject(error);else resolve(value!);}catch(e){reject(e);}
    };
    const abort=()=>finish(true);
    signal?.addEventListener('abort',abort,{once:true});
    entry.promise.then(value=>finish(!!signal?.aborted,value),error=>finish(!!signal?.aborted,undefined,error));
  });
}

/** A separately resolved response is reusable only after the owning UI confirms its listing. */
export function seedYahooPersonalSeries(owner:string,series:YahooPersonalDailySeries):void {
  if(!active(owner)||!isPublicSourceApproved(owner,'yahoo'))return;
  const value=validate(series,series.assetSymbol),asset=getAssetConfig(series.assetSymbol)!;
  const listing=getPersonalListingIdentity(series.assetSymbol);
  const key=[owner,getPublicSourceConsentRevision(),series.assetSymbol,asset.yahooSymbol,asset.nativeCurrency,listing?.exchange??'','',''].join(':');
  cache.set(key,{value,expires:Date.now()+CACHE_MS});
}

export function clearYahooPersonalCache(): void {
  generation += 1;
  controllers.forEach(controller => controller.abort());
  controllers.clear();
  // A workspace/permission reset must not bypass an upstream Retry-After.
  // Authentication denials belong to the old session; finite provider cooldowns do not.
  for (const [owner, failure] of failures) {
    if (!Number.isFinite(failure.until) || failure.until <= Date.now()) failures.delete(owner);
  }
  cache.clear();
  scopedFailures.clear();
  inFlight.clear();
}
