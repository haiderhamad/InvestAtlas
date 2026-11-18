import type * as FinancialClient from '@/lib/financial-data/client';
import type * as SourceConsent from '@/lib/financial-data/providers/public-source-consent';
import type * as SourceSelection from '@/lib/financial-data/providers/source-selection';
import type * as HistoryCache from '@/lib/financial-data/history/cache';

jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));

const NOW = Date.parse('2026-11-17T12:00:00Z');
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousFetch = global.fetch;
let clock: number;
let client: typeof FinancialClient;
let consent: typeof SourceConsent;
let selection: typeof SourceSelection;
let cache: typeof HistoryCache;
let owner: string;
let transport: jest.Mock;

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

// Synthetic contract fixture for tests only; README captures use actual APIs.
function observationFixture(metal = 'XAU', preset = '5y') {
  return { source: 'Standard Bullion', url: 'https://standardbullion.com',
    attribution: 'Data by Standard Bullion — https://standardbullion.com', metal,
    unit: 'USD per troy ounce', range: preset, grain: 'daily', points: [
      ...(preset === '5y' ? [{ t: '2022-11-16T00:00:00Z', price: 80 }] : []),
      { t: '2026-11-15T00:00:00Z', price: 100 },
      { t: '2026-11-16T00:00:00Z', price: 120 },
    ] };
}

function enable() {
  consent.setPublicSourceConsent(owner, ['bullion']);
  const preferences = { ...selection.readSourceSelection(owner), bullion: true };
  selection.saveSourceSelection(owner, preferences);
}

async function history(symbol = 'GOLD', range = '1y') {
  return (await client.fetchFinancialData(`/api/prices/history?symbol=${symbol}&currency=usd&interval=1d&range=${range}`)).json();
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
  clock = NOW;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const view = new EventTarget();
  Object.assign(view, { location: new URL('http://127.0.0.1:3180'), localStorage: storage(), sessionStorage: storage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
  const workspace = require('@/lib/storage/workspace-storage') as typeof import('@/lib/storage/workspace-storage');
  workspace.resolveBrowserWorkspace(null);
  owner = (require('@/lib/runtime/local-personal-provider') as typeof import('@/lib/runtime/local-personal-provider')).LOCAL_PERSONAL_PROVIDER_OWNER_ID;
  client = require('@/lib/financial-data/client');
  consent = require('@/lib/financial-data/providers/public-source-consent');
  selection = require('@/lib/financial-data/providers/source-selection');
  cache = require('@/lib/financial-data/history/cache');
  const preferences = { ...selection.readSourceSelection(owner), yahoo: false, spot: false,
    coinpaprika: false, coingecko: false, binance: false, kraken: false, fx: false };
  selection.saveSourceSelection(owner, preferences);
  transport = jest.fn(async input => {
    const url = new URL(String(input));
    if (url.origin !== 'https://standardbullion.com') throw new Error('Unexpected authenticated or server transport');
    return Response.json(observationFixture(url.searchParams.get('metal')!, url.searchParams.get('range')!));
  });
  global.fetch = transport;
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = previousFetch; });
afterAll(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('an empty Local Workspace requires deliberate metal-source approval and no Firebase account', async () => {
  expect(await (require('@/lib/auth/firebase-api-auth') as typeof import('@/lib/auth/firebase-api-auth')).getFirebaseApiIdentity()).toBeNull();
  expect((await history()).prices).toEqual([]);
  expect(transport).not.toHaveBeenCalled();
});

test.each([['GOLD', 'XAU'], ['SILVER', 'XAG']])('routes local %s history through the real anonymous client without credentials', async (symbol, metal) => {
  enable();
  const result = await history(symbol);
  expect(result).toMatchObject({ synthetic: false, realtime: false, status: 'partial' });
  expect(result.prices).toEqual([
    expect.objectContaining({ date: '2026-11-15', close: 100, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }),
    expect.objectContaining({ date: '2026-11-16', close: 120, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }),
  ]);
  expect(result.sources[0]).toMatchObject({ providerId: 'standard_bullion_daily', retrievedAt: '2026-11-17T12:00:00.000Z' });
  const [url, init] = transport.mock.calls[0];
  expect(String(url)).toBe(`https://standardbullion.com/api/v1/market/history?metal=${metal}&range=5y`);
  expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  expect(new Headers(init.headers).has('authorization')).toBe(false);
});

test('the local client reuses five-year observations and returns dated saved data on refresh failure', async () => {
  enable();
  expect((await history()).prices).toHaveLength(2);
  expect((await history('GOLD', '5y')).prices).toHaveLength(3);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await cache.getHistoryRepository().stats(`${window.location.origin}:local_personal`, owner)).toMatchObject({ recordCount: 1, barCount: 3 });
  expect(await cache.getHistoryRepository().stats(`${window.location.origin}:private_cloud`, owner)).toMatchObject({ recordCount: 0 });
  clock += 7 * 3_600_000;
  transport.mockRejectedValue(new Error('Provider unavailable'));
  const saved = await history();
  expect(saved).toMatchObject({ cache: { status: 'hit_stale' }, freshness: 'stale', synthetic: false });
  expect(saved.prices.map((row: { close: number }) => row.close)).toEqual([100, 120]);
  expect(saved.sources[0].retrievedAt).toBe('2026-11-17T12:00:00.000Z');
});

test('switching Local Workspace to Demo uses the bundled snapshot and makes no provider request', async () => {
  enable();
  const workspaceMode = require('@/lib/demo/workspace-mode') as typeof import('@/lib/demo/workspace-mode');
  workspaceMode.writeAnonymousWorkspaceMode('demo_snapshot');
  const result = await history();
  expect(result).toMatchObject({ synthetic: true });
  expect(transport).not.toHaveBeenCalled();
});

test('public_demo client routing stays synthetic even with a saved local-source preference', async () => {
  enable();
  jest.resetModules();
  jest.doMock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'public_demo' }));
  const workspace = require('@/lib/storage/workspace-storage') as typeof import('@/lib/storage/workspace-storage');
  workspace.resolveBrowserWorkspace(null);
  client = require('@/lib/financial-data/client');
  expect((await history()).synthetic).toBe(true);
  expect(transport).not.toHaveBeenCalled();
});

test('local source revocation rejects an in-flight observation before it enters the cache', async () => {
  enable();
  let finish!: (response: Response) => void;
  transport.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = history().then(() => 'accepted', () => 'rejected');
  for (let i = 0; i < 50 && !finish; i++) await Promise.resolve();
  expect(typeof finish).toBe('function');
  consent.clearPublicSourceConsent();
  finish(Response.json(observationFixture()));
  expect(await pending).toBe('rejected');
  expect(await cache.getHistoryRepository().stats(`${window.location.origin}:local_personal`, owner)).toMatchObject({ recordCount: 0 });
});
