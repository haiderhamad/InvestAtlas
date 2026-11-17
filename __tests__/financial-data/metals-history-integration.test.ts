import type * as MarketApi from '@/lib/financial-data/providers/tiingo-browser-market-data';
import type * as HistoryService from '@/lib/financial-data/providers/personal-history-service';
import type * as Consent from '@/lib/financial-data/providers/public-source-consent';
import type * as Selection from '@/lib/financial-data/providers/source-selection';
import type * as Workspace from '@/lib/storage/workspace-storage';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
// Firebase transport is unrelated to the browser-direct anonymous metal feed.
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => null }));
const NOW = Date.parse('2026-11-16T12:00:00Z');
const owner = 'metal-history-owner';
const range = { from: '2026-11-14', to: '2026-11-15' };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = global.fetch;
let api: typeof MarketApi;
let service: typeof HistoryService;
let consent: typeof Consent;
let selection: typeof Selection;
let workspace: typeof Workspace;
let clock: number;
let fetchMock: jest.Mock;

function native(metal = 'XAU') {
  return { source: 'Standard Bullion', url: 'https://standardbullion.com',
    attribution: 'Data by Standard Bullion — https://standardbullion.com',
    metal, name: metal === 'XAU' ? 'Gold' : 'Silver',
    page: metal === 'XAU' ? 'https://standardbullion.com/spot-gold-price' : 'https://standardbullion.com/spot-silver-price',
    unit: 'USD per troy ounce', range: '5y', grain: 'daily',
    points: [{ t: '2026-11-14T00:00:00Z', price: 100 }, { t: '2026-11-15T00:00:00Z', price: 120 }] };
}

function enable() {
  consent.setPublicSourceConsent(owner, ['bullion'] as never);
  const prefs = { ...selection.readSourceSelection(owner), bullion: true, yahoo: false, spot: false,
    coinpaprika: false, coingecko: false, binance: false, kraken: false, twelveDemo: false };
  selection.saveSourceSelection(owner, prefs);
}

async function history(symbol = 'GOLD', currency = 'usd') {
  const response = await api.handlePersonalBrowserMarketRequest(
    `/api/prices/history?symbol=${symbol}&currency=${currency}&interval=1d&from=${range.from}&to=${range.to}`, {}, owner,
  );
  return response!.json();
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
  clock = NOW;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const view = new EventTarget();
  const store = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
  };
  Object.assign(view, { location: new URL('https://private.example'), localStorage: store(), sessionStorage: store() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
  workspace = require('@/lib/storage/workspace-storage');
  consent = require('@/lib/financial-data/providers/public-source-consent');
  selection = require('@/lib/financial-data/providers/source-selection');
  service = require('@/lib/financial-data/providers/personal-history-service');
  api = require('@/lib/financial-data/providers/tiingo-browser-market-data');
  workspace.resolveBrowserWorkspace(owner);
  fetchMock = jest.fn(async () => Response.json(native()));
  global.fetch = fetchMock;
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });
afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('old approved public sources cannot authorize the new metal history transport', async () => {
  consent.setPublicSourceConsent(owner, ['yahoo', 'spot', 'coinpaprika', 'coingecko', 'binance', 'kraken']);
  expect((await history()).prices).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([['GOLD', 'XAU'], ['SILVER', 'XAG']])('returns %s physical close observations with null OHLC and exact source', async (symbol, metal) => {
  enable(); fetchMock.mockResolvedValue(Response.json(native(metal)));
  const data = await history(symbol);
  expect(data.prices).toEqual([
    expect.objectContaining({ date: '2026-11-14', close: 100, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }),
    expect.objectContaining({ date: '2026-11-15', close: 120, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }),
  ]);
  expect(data).toMatchObject({ synthetic: false, realtime: false, status: 'partial', adjustment: 'raw_unadjusted', latestObservationAt: '2026-11-15' });
  expect(data.sources[0]).toMatchObject({ providerId: 'standard_bullion_daily', providerName: expect.stringContaining('Standard Bullion'), retrievedAt: '2026-11-16T12:00:00.000Z' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe(`https://standardbullion.com/api/v1/market/history?metal=${metal}&range=5y`);
  expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  expect(new Headers(init.headers).get('authorization')).toBeNull();
});

test('a second request reuses validated native history without fetching it again', async () => {
  enable();
  await history();
  const second = await history();
  expect(second.cache.status).toBe('hit_fresh');
  expect(second.prices[1].close).toBe(120);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await service.getPersonalHistoryCacheStats(owner)).toMatchObject({ recordCount: 1, barCount: 2 });
});

test('expands an existing annual metal cache using one validated preset and reuses the complete checked window', async () => {
  enable();
  const { getHistoryRepository } = require('@/lib/financial-data/history/cache') as typeof import('@/lib/financial-data/history/cache');
  const repo = getHistoryRepository();
  const key = { installation: 'https://private.example:private_cloud', owner,
    instrument: 'XAU', exchange: 'INDICATIVE_DEALER', providerId: 'standard_bullion_daily',
    currency: 'USD', interval: '1d', adjustment: 'raw_unadjusted', version: 1 } as const;
  await repo.write({ key, bars: native().points.map(point => ({ date: point.t.slice(0, 10), close: point.price,
    open: null, high: null, low: null, volume: null, dataQuality: 'close_only' })),
    coverage: [{ from: '2025-11-15', to: '2026-11-15' }], retrievedAt: NOW, lastCheckedAt: NOW });
  expect((await history()).prices).toHaveLength(2);
  expect(fetchMock).not.toHaveBeenCalled();

  fetchMock.mockResolvedValue(Response.json({ ...native(), points: [
    { t: '2022-11-16T00:00:00Z', price: 80 }, ...native().points,
  ] }));
  const full = { from: '2021-11-15', to: '2026-11-15' };
  const expanded = await service.loadPersonalDailyHistory('bullion', owner, 'GOLD', full);
  expect(expanded?.bars.map(bar => bar.close)).toEqual([80, 100, 120]);
  expect(expanded).toMatchObject({ refreshFailed: false, cacheStatus: 'miss', coverageLimited: true });
  expect((await repo.read(key))?.coverage).toEqual([full]);
  expect((await service.loadPersonalDailyHistory('bullion', owner, 'GOLD', full))?.cacheStatus).toBe('hit_fresh');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe('https://standardbullion.com/api/v1/market/history?metal=XAU&range=5y');
});

test('a failed refresh returns labelled saved history with original retrieval time', async () => {
  enable(); await history();
  clock += 7 * 3_600_000;
  fetchMock.mockRejectedValue(new Error('Provider offline'));
  const fallback = await history();
  expect(fallback).toMatchObject({ cache: { status: 'hit_stale' }, freshness: 'stale', isComplete: false });
  expect(fallback.prices.map((row: { close: number }) => row.close)).toEqual([100, 120]);
  expect(fallback.sources[0].retrievedAt).toBe('2026-11-16T12:00:00.000Z');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await history();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('an empty preset during refresh preserves the original retrieval time and marks saved prices stale', async () => {
  enable();
  const initial = await history();
  clock += 7 * 3_600_000;
  fetchMock.mockResolvedValueOnce(Response.json({ ...native(), points: [] }));
  const fallback = await history();
  expect(fallback).toMatchObject({ cache: { status: 'hit_stale' }, freshness: 'stale', isComplete: false });
  expect(fallback.prices).toEqual(initial.prices);
  expect(fallback.sources[0].retrievedAt).toBe(initial.sources[0].retrievedAt);
});

test('revoking the source prevents both cached display and further transport', async () => {
  enable(); await history(); consent.clearPublicSourceConsent();
  expect((await history()).prices).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('changing the signed-in owner cannot use the previous owner cache or fetch', async () => {
  enable(); await history(); workspace.resolveBrowserWorkspace('another-owner');
  const result = await history().catch(error => {
    expect(error).toMatchObject({ name: 'AbortError' }); return { prices: [] };
  });
  expect(result.prices).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('clearing history cancels an in-flight result before it can repopulate storage', async () => {
  enable();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = service.loadPersonalDailyHistory('bullion' as never, owner, 'GOLD', range).catch(error => error);
  for (let i = 0; i < 30 && !finish; i++) await Promise.resolve();
  expect(typeof finish).toBe('function');
  await service.clearPersonalHistoryCache(owner);
  finish(Response.json(native()));
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(await service.getPersonalHistoryCacheStats(owner)).toMatchObject({ recordCount: 0, barCount: 0 });
});

test('dated ECB conversion is used for historical EUR prices, preserving missing OHLC', async () => {
  enable();
  fetchMock.mockImplementation(async (input: string) => {
    if (String(input).startsWith('https://standardbullion.com/')) return Response.json(native());
    return Response.json({ status: 'complete', data: [{ date: '2026-11-13', rate: 0.5, asOf: '2026-11-13' }],
      generatedAt: '2026-11-16T12:00:00.000Z', sourceAttribution: 'Source: ECB statistics.' });
  });
  const data = await history('GOLD', 'eur');
  expect(data.prices.map((row: { close: number }) => row.close)).toEqual([50, 60]);
  expect(data.prices[1]).toMatchObject({ open: null, high: null, low: null, volume: null, dataQuality: 'close_only',
    conversion: { sourceCurrency: 'USD', rate: 0.5, asOf: '2026-11-13' } });
});

test('provider Retry-After survives cache clearing, reapproval and switching metal', async () => {
  enable();
  fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
  expect((await history()).prices).toEqual([]);
  await service.clearPersonalHistoryCache(owner); enable();
  expect((await history('SILVER')).prices).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  clock += 600_001;
  fetchMock.mockResolvedValueOnce(Response.json(native('XAG')));
  expect((await history('SILVER')).prices).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a declared oversized response is rejected before reading or caching prices', async () => {
  enable();
  fetchMock.mockResolvedValueOnce(Response.json(native(), { headers: { 'Content-Length': '786433' } }));
  expect((await history()).prices).toEqual([]);
  expect((await service.getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('bounds a chunked response even when its Content-Length is absent', async () => {
  enable();
  fetchMock.mockResolvedValueOnce(new Response(' '.repeat(768 * 1024) + JSON.stringify(native()), {
    headers: { 'Content-Type': 'application/json' },
  }));
  expect((await history()).prices).toEqual([]);
  expect((await service.getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('the historical source cannot supply current portfolio prices', async () => {
  enable();
  const response = await api.handlePersonalBrowserMarketRequest('/api/prices/current?symbols=GOLD,SILVER&currency=usd', {}, owner);
  expect((await response!.json()).prices).toEqual({});
  expect(fetchMock).not.toHaveBeenCalled();
});

test('one cancelled subscriber does not discard another subscriber’s shared history request', async () => {
  enable();
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const first = service.loadPersonalDailyHistory('bullion', owner, 'GOLD', range, controller.signal).catch(error => error);
  const second = service.loadPersonalDailyHistory('bullion', owner, 'GOLD', range);
  for (let i = 0; i < 40 && !finish; i++) await Promise.resolve();
  controller.abort(); finish(Response.json(native()));
  expect(await first).toMatchObject({ name: 'AbortError' });
  expect((await second)?.bars.map(row => row.close)).toEqual([100, 120]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('revocation fences a late provider response before durable storage', async () => {
  enable();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = service.loadPersonalDailyHistory('bullion', owner, 'GOLD', range).catch(error => error);
  for (let i = 0; i < 40 && !finish; i++) await Promise.resolve();
  consent.clearPublicSourceConsent(); finish(Response.json(native()));
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect((await service.getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('public Demo cannot activate or contact the new external history source', async () => {
  jest.resetModules();
  jest.doMock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'public_demo' }));
  const direct = require('@/lib/financial-data/providers/standard-bullion-history') as typeof import('@/lib/financial-data/providers/standard-bullion-history');
  await expect(direct.loadStandardBullionHistory(owner, 'GOLD', range)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  ['empty five-year preset', { points: [] }],
  ['wrong metal', { metal: 'XAG' }], ['wrong unit', { unit: 'EUR per gram' }], ['intraday grain', { grain: 'tick' }],
  ['wrong source', { source: 'Unreviewed mirror' }],
  ['future day', { points: [{ t: '2026-11-16T00:00:00Z', price: 100 }] }],
  ['duplicate day', { points: [{ t: '2026-11-14T00:00:00Z', price: 100 }, { t: '2026-11-14T00:00:00Z', price: 101 }] }],
  ['negative value', { points: [{ t: '2026-11-14T00:00:00Z', price: -1 }] }],
  ['zero value', { points: [{ t: '2026-11-14T00:00:00Z', price: 0 }] }],
  ['numeric string', { points: [{ t: '2026-11-14T00:00:00Z', price: '100' }] }],
  ['outside preset window', { points: [{ t: '2021-11-14T00:00:00Z', price: 100 }] }],
  ['intraday time', { points: [{ t: '2026-11-14T01:00:00Z', price: 100 }] }],
  ['invalid calendar day', { points: [{ t: '2026-02-30T00:00:00Z', price: 100 }] }],
  ['reverse order', { points: [{ t: '2026-11-15T00:00:00Z', price: 100 }, { t: '2026-11-14T00:00:00Z', price: 110 }] }],
  ['wrong requested window', { range: '1y' }],
  ['unreliable explicit-date reply', { range: `${range.from}..${range.to}` }],
])('rejects %s instead of retaining a price', async (_name, change) => {
  enable(); fetchMock.mockResolvedValue(Response.json({ ...native(), ...change }));
  expect((await history()).prices).toEqual([]);
  expect((await service.getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});
