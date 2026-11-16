import {
  clearYahooPersonalDiscoverySession,
  resolveYahooPersonalListing,
  searchYahooPersonalListings,
} from '@/lib/financial-data/providers/yahoo-personal-discovery';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID as owner } from '@/lib/runtime/local-personal-provider';
import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import { readUserAssets } from '@/lib/config/user-assets-store';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn() }));

const deployment = require('@/lib/runtime/deployment-mode') as { INVESTATLAS_DEPLOYMENT_MODE: string };
const identity = jest.mocked(getFirebaseApiIdentity);
const originalFetch = global.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const candidate = { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', exchange: 'NMS' } as const;
const instrument = {
  version: 1, ...candidate, providerSymbol: 'ADBE', nativeCurrency: 'usd',
  source: 'yahoo_chart', resolvedAt: '2026-11-07T12:00:00.000Z',
} as const;
let clock = Date.UTC(2026, 10, 7, 12);

function makeStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function daily() {
  const last = new Date(clock - 86_400_000).toISOString().slice(0, 10);
  const first = new Date(clock - 2 * 86_400_000).toISOString().slice(0, 10);
  return {
    providerId: 'yahoo_personal_daily', assetSymbol: 'ADBE', providerSymbol: 'ADBE',
    exchange: 'NMS', assetClass: 'stock',
    listingCurrency: 'USD', retrievedAt: new Date(clock).toISOString(),
    latestObservationAt: last, cacheStatus: 'miss',
    bars: [
      { date: first, open: 90, high: 100, low: 85, close: 95, volume: 1000 },
      { date: last, open: 95, high: 105, low: 90, close: 100, volume: null },
    ],
  };
}

beforeEach(() => {
  clock += 600_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'local_personal';
  const target = new EventTarget();
  Object.assign(target, {
    location: new URL('http://127.0.0.1:3191'), localStorage: makeStore(), sessionStorage: makeStore(),
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  window.localStorage.setItem('investatlas.anonymous-workspace-mode', 'local_workspace');
  resolveBrowserWorkspace(null);
  clearPublicSourceConsent();
  clearYahooPersonalDiscoverySession();
  saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: true });
  identity.mockReset().mockResolvedValue({ userId: 'owner-a', token: 'synthetic-token' });
  global.fetch = jest.fn(async input => String(input).endsWith('/search') || String(input).endsWith('personal-search')
    ? Response.json({ candidates: [candidate] }) : Response.json({ instrument, series: daily() }));
});
afterEach(() => {
  clearYahooPersonalDiscoverySession();
  clearPublicSourceConsent();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('never sends discovery traffic before approval or in public_demo', async () => {
  await expect(searchYahooPersonalListings(owner, 'Adobe')).rejects.toMatchObject({ name: 'AbortError' });
  setPublicSourceConsent(owner, ['yahoo']);
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'public_demo';
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
});

test('local search and resolution use only fixed same-origin POST routes and never initialize Firebase', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  expect(await searchYahooPersonalListings(owner, 'Adobe')).toEqual([candidate]);
  expect(await resolveYahooPersonalListing(owner, 'ADBE')).toEqual({ instrument, series: daily() });
  expect(readUserAssets()).toEqual([]);
  expect(identity).not.toHaveBeenCalled();
  expect(jest.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
    '/api/local/yahoo/search', '/api/local/yahoo/resolve',
  ]);
  for (const [, init] of jest.mocked(global.fetch).mock.calls) {
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  }
});

test('search strips unrelated fields and cannot turn candidates into resolved metadata', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ candidates: [{ ...candidate, nativeCurrency: 'usd', compliance: 'Compliant' }] }));
  expect(await searchYahooPersonalListings(owner, 'Adobe')).toEqual([candidate]);
});

test('private discovery sends an exact owner token only to the same-origin owner routes', async () => {
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  resolveBrowserWorkspace('owner-a');
  setPublicSourceConsent('owner-a', ['yahoo']);
  expect(await searchYahooPersonalListings('owner-a', 'Adobe')).toEqual([candidate]);
  expect(jest.mocked(global.fetch).mock.calls[0]).toEqual([
    '/api/financial-data/yahoo/personal-search', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
    }),
  ]);
});

test('a token belonging to another owner cannot reach the discovery route', async () => {
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  resolveBrowserWorkspace('owner-a');
  setPublicSourceConsent('owner-a', ['yahoo']);
  identity.mockResolvedValue({ userId: 'owner-b', token: 'synthetic-token-b' });
  await expect(searchYahooPersonalListings('owner-a', 'Adobe')).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('revocation and immediate reapproval during token lookup cannot revive a pending request', async () => {
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  resolveBrowserWorkspace('owner-a');
  setPublicSourceConsent('owner-a', ['yahoo']);
  let finish!: (value: { userId: string; token: string }) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  identity.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const pending = searchYahooPersonalListings('owner-a', 'Adobe');
  await waiting;
  clearPublicSourceConsent();
  setPublicSourceConsent('owner-a', ['yahoo']);
  finish({ userId: 'owner-a', token: 'synthetic-token' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['consent', 'workspace', 'source', 'abort'])('rejects an in-flight response after %s changes', async change => {
  setPublicSourceConsent(owner, ['yahoo']);
  let finish!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = resolveYahooPersonalListing(owner, 'ADBE', controller.signal);
  if (change === 'consent') { clearPublicSourceConsent(); setPublicSourceConsent(owner, ['yahoo']); }
  if (change === 'workspace') { resolveBrowserWorkspace('owner-b'); resolveBrowserWorkspace(null); }
  if (change === 'source') saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: false });
  if (change === 'abort') controller.abort();
  finish(Response.json({ instrument }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

test('a disabled Yahoo selection cannot send requests despite old consent', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: false });
  await expect(searchYahooPersonalListings(owner, 'Adobe')).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([401, 403, 429, 503])('HTTP %s causes a bounded session cooldown instead of retries', async status => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ code: status === 503 ? 'provider_access_denied' : 'unavailable' }, {
    status, headers: { 'Retry-After': '120' },
  }));
  await expect(searchYahooPersonalListings(owner, 'Adobe')).rejects.toThrow();
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a finite Retry-After survives consent/workspace resets and expires at its real deadline', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  await expect(searchYahooPersonalListings(owner, 'Adobe')).rejects.toThrow();
  clearPublicSourceConsent(); clearYahooPersonalDiscoverySession(); setPublicSourceConsent(owner, ['yahoo']);
  clock += 119_000;
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  clock += 2_000;
  global.fetch = jest.fn(async () => Response.json({ instrument }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).resolves.toEqual({ instrument });
});

test.each([
  { ...instrument, providerSymbol: 'MSFT' },
  { ...instrument, nativeCurrency: 'gbp' },
  { ...instrument, isHalal: true },
  { ...instrument, resolvedAt: '2026-02-30T10:00:00.000Z' },
])('rejects forged resolved identity %#', async value => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ instrument: value }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
});

test('refuses a series from another listing rather than passing it to the price cache', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ instrument, series: { ...daily(), providerSymbol: 'MSFT' } }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
});

test.each([{ exchange: 'GER' }, { assetClass: 'etf' }])('refuses inconsistent series venue or class %#', async changed => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ instrument, series: { ...daily(), ...changed } }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
});

test('preserves a valid market observation and drops invalid current metadata independently', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  const current = { price: 101.25, observedAt: new Date(clock - 60_000).toISOString() };
  global.fetch = jest.fn(async () => Response.json({ instrument, series: { ...daily(), current } }));
  expect((await resolveYahooPersonalListing(owner, 'ADBE')).series?.current).toEqual(current);
  global.fetch = jest.fn(async () => Response.json({ instrument, series: { ...daily(), current: { ...current, price: -1 } } }));
  const rejectedCurrent = await resolveYahooPersonalListing(owner, 'ADBE');
  expect(rejectedCurrent.series).not.toHaveProperty('current');
  expect(rejectedCurrent.series?.bars.at(-1)?.close).toBe(100);
});

test.each(['date', 'future', 'price', 'volume', 'ohlc', 'length'])('rejects a malformed %s in optional price history', async field => {
  setPublicSourceConsent(owner, ['yahoo']);
  const series = daily();
  if (field === 'date') series.bars[0].date = '2026-02-30';
  if (field === 'future') series.bars[1].date = new Date(clock + 86_400_000).toISOString().slice(0, 10);
  if (field === 'price') series.bars[0].close = -1;
  if (field === 'volume') series.bars[0].volume = -1;
  if (field === 'ohlc') series.bars[0].low = 200;
  if (field === 'length') series.bars = [];
  global.fetch = jest.fn(async () => Response.json({ instrument, series }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
});

test('bounds both declared and streamed response sizes', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ candidates: [] }, { headers: { 'Content-Length': String(64 * 1024 + 1) } }));
  await expect(searchYahooPersonalListings(owner, 'Adobe')).rejects.toThrow();
  clock += 100_000;
  global.fetch = jest.fn(async () => new Response(' '.repeat(160 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
  await expect(resolveYahooPersonalListing(owner, 'ADBE')).rejects.toThrow();
});
