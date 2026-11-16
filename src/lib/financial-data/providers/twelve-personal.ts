'use client';

import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { INVESTATLAS_DEPLOYMENT_MODE as mode } from '@/lib/runtime/deployment-mode';
import type { TiingoBrowserDailySeries } from './tiingo-browser';
import { SOURCE_CHANGE } from './source-selection';
import { getAssetConfig } from '@/lib/config/supported-assets';

export type TwelveSeries = Omit<TiingoBrowserDailySeries, 'providerId'> & { providerId: 'twelve_personal_daily' };
export type TwelveDemoSeries = Omit<TwelveSeries, 'providerId'> & { providerId: 'twelve_demo_daily' };
// An actual US listing is validated again against provider metadata on every response.
export const supportsTwelve = (symbol: string) => {
  const asset = getAssetConfig(symbol);
  return Boolean(asset && (asset.assetClass === 'stock' || asset.assetClass === 'etf')
    && asset.nativeCurrency === 'usd' && asset.yahooSymbol === symbol);
};
const US_MARKETS: Readonly<Record<string, readonly string[]>> = {
  NASDAQ: ['XNAS', 'XNGS', 'XNCM'],
  NYSE: ['XNYS'],
  'NYSE ARCA': ['ARCX'],
  'NYSE MKT': ['XASE'],
  BATS: ['BATS'],
};
export function activeMarketOwner(owner: string): boolean {
  const current = getActiveBrowserWorkspaceUserId();
  return mode === 'private_cloud' ? !!owner && current === owner : mode === 'local_personal' && current === null && owner === LOCAL_PERSONAL_PROVIDER_OWNER_ID && readAnonymousWorkspaceMode() === 'local_workspace';
}
let credential: { owner: string; token: string } | null = null;
const CACHE_MS = 3 * 60_000;
const dailyCache = new Map<string, { until: number; series: TwelveSeries }>();
const inFlight = new Map<string, Promise<TwelveSeries>>();
export function invalidateTwelveDailyCache(): void { dailyCache.clear(); }
let generation = 0;
const pending = new Set<AbortController>();
let testingOwner: string | null = null;
export function clearTwelve(): void {
  generation++; credential = null; testingOwner = null; invalidateTwelveDailyCache(); inFlight.clear();
  for (const request of pending) request.abort();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOURCE_CHANGE));
}
export function reconcileTwelve(owner: string | null): void {
  if ((credential && credential.owner !== owner) || (testingOwner && testingOwner !== owner)) clearTwelve();
}
export const hasTwelve = (owner: string) => activeMarketOwner(owner) && credential?.owner === owner;
const DAY = 86400000;
export function parseTwelve(data: unknown, symbol: string, now = Date.now()): TwelveSeries {
  const fail = (): never => { throw new Error('Invalid or unavailable daily series'); };
  if (!supportsTwelve(symbol) || !data || typeof data !== 'object') return fail();
  const {meta, values} = data as {meta?: Record<string,unknown>; values?: unknown[]};
  if (meta?.symbol !== symbol || meta.currency !== 'USD' || meta.interval !== '1day'
    || typeof meta.exchange !== 'string' || typeof meta.mic_code !== 'string'
    || !US_MARKETS[meta.exchange]?.includes(meta.mic_code)
    || !Array.isArray(values) || !values.length || values.length > 100) return fail();
  const seen = new Set<string>();
  const num = (v: unknown) => typeof v === 'string' && /^\d{1,15}(?:\.\d{1,12})?$/.test(v) ? Number(v) : NaN;
  const bars: TwelveSeries['bars'] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') return fail();
    const row = value as Record<string,unknown>, date = row.datetime;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) return fail();
    const ts = Date.parse(date+'T00:00:00Z');
    if (!Number.isFinite(ts) || new Date(ts).toISOString().slice(0,10) !== date || ts > now) return fail();
    seen.add(date);
    // Never label an in-progress exchange day as a completed EOD bar.
    if (ts >= Math.floor(now/DAY)*DAY) continue;
    const [open,high,low,close,volume] = ['open','high','low','close','volume'].map(k=>num(row[k]));
    if (![open,high,low,close].every(x=>Number.isFinite(x)&&x>0&&x<=1e7) || !Number.isSafeInteger(volume) || volume<0 || low>Math.min(open,close) || high<Math.max(open,close)) return fail();
    bars.push({date,open,high,low,close,volume});
  }
  bars.sort((a,b)=>a.date.localeCompare(b.date));
  const last = bars.at(-1);
  if (!last || now-Date.parse(last.date+'T23:59:59Z')>4*DAY) return fail();
  return {providerId:'twelve_personal_daily',assetSymbol:symbol,providerSymbol:symbol,listingCurrency:'USD',retrievedAt:new Date(now).toISOString(),latestObservationAt:last.date,cacheStatus:'miss',bars};
}
const requests = new Map<string, number[]>();
async function request(owner: string, token: string, symbol: string, signal?: AbortSignal) {
  if (signal?.aborted || !activeMarketOwner(owner) || !supportsTwelve(symbol)) throw new DOMException('Aborted','AbortError');
  const now=Date.now(), recent=(requests.get(owner)??[]).filter(t=>now-t<60000);
  if(recent.length>=8) throw new Error('Request limit');
  requests.set(owner,[...recent,now]);
  const version = generation, controller = new AbortController(); pending.add(controller);
  const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,8000);
  try {
    const url=new URL('https://api.twelvedata.com/time_series');
    url.search=new URLSearchParams({symbol,interval:'1day',adjust:'none',outputsize:'100'}).toString();
    const r=await fetch(url,{headers:{Accept:'application/json',Authorization:'apikey '+token},credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
    if (!r.ok || !r.headers.get('content-type')?.includes('application/json') || !r.body) throw new Error('Provider unavailable');
    const reader=r.body.getReader(), decoder=new TextDecoder(); let size=0, text='';
    try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>131072){await reader.cancel();throw new Error('Response too large');} text+=decoder.decode(value,{stream:true}); } } finally {reader.releaseLock();}
    if (controller.signal.aborted || version!==generation || !activeMarketOwner(owner)) throw new DOMException('Aborted','AbortError');
    const series = parseTwelve(JSON.parse(text+decoder.decode()),symbol);
    dailyCache.set(owner + ':' + symbol, { until: Date.now() + CACHE_MS, series });
    return series;
  } finally { clearTimeout(timer); pending.delete(controller); signal?.removeEventListener('abort',abort); }
}
export async function connectTwelve(owner:string, raw:string, signal?:AbortSignal) {
  // The provider also accepts the literal user-entered documentation credential "demo" for its sample instruments. Never select it automatically.
  const token=raw.trim(); if(token !== 'demo' && !/^[A-Za-z0-9_-]{8,256}$/.test(token)) throw new Error('Invalid key');
  clearTwelve(); const version=generation; testingOwner=owner;
  try { await request(owner,token,'AAPL',signal);
    if(version!==generation || signal?.aborted || !activeMarketOwner(owner)) throw new DOMException('Aborted','AbortError');
    credential={owner,token}; window.dispatchEvent(new Event(SOURCE_CHANGE));
  } finally {if(version===generation) testingOwner=null;}
}
export async function loadTwelve(owner:string,symbol:string,signal?:AbortSignal) {
  if (!credential || !hasTwelve(owner)) throw new Error('Provider not connected');
  if (signal?.aborted) throw new DOMException('Aborted','AbortError');
  const cached = dailyCache.get(owner + ':' + symbol);
  if (cached && cached.until > Date.now()) return cached.series;
  const key = owner + ':' + symbol;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = request(owner, credential.token, symbol, signal);
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}

/** Official documentation-only demo credential, never used for portfolio valuation. */
export async function loadTwelveDemo(owner: string, symbol: string, signal?: AbortSignal): Promise<TwelveDemoSeries> {
  if (symbol !== 'AAPL') throw new Error('The public demonstration only covers AAPL');
  const daily = await request(owner, 'demo', 'AAPL', signal);
  return { ...daily, providerId: 'twelve_demo_daily' };
}
