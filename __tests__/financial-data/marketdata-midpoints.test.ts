import * as adapter from '@/lib/financial-data/providers/marketdata-personal';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
let mockIdentityOwner = '';
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => ({ userId: mockIdentityOwner, token: 'test-owner-session-token' }) }));
const load = (adapter as typeof adapter & { loadMarketDataMidpoints: (
  owner: string, instruments: readonly (string | { symbol: string; providerSymbol: string; assetClass: 'stock' | 'etf'; nativeCurrency: 'eur' | 'usd'; exchange: string })[], signal?: AbortSignal,
) => Promise<Array<{ assetSymbol: string; providerId: string; priceUsd: number; observedAt: string; priceType: string }>> }).loadMarketDataMidpoints;
const oldWindow = globalThis.window;
const oldFetch = global.fetch;
const NOW = Date.UTC(2026, 10, 6, 19);
const sourceTime = Math.floor((NOW - 30_000) / 1000);
let owner: string;
beforeAll(() => {
  const view = new EventTarget();
  Object.assign(view, { location: new URL('https://private.example'), localStorage: { getItem: () => null, setItem: () => {} } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
});
beforeEach(async () => {
  owner = 'midpoint-owner-' + Math.random().toString(16).slice(2);
  mockIdentityOwner = owner;
  resolveBrowserWorkspace(owner);
  adapter.clearMarketData();
  clearPublicSourceConsent();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = jest.fn(async () => Response.json({ s: 'ok', t: [sourceTime - 86400], o: [100], h: [110], l: [90], c: [105], v: [1000] }));
  await adapter.connectMarketData(owner, 'test-midpoint-private-key');
});
afterEach(() => { adapter.clearMarketData(); clearPublicSourceConsent(); jest.restoreAllMocks(); global.fetch = oldFetch; });
afterAll(() => { Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow }); });

test('requests a fixed-host batch with existing credential and uses actual source times and indicative provenance', async () => {
  global.fetch = jest.fn(async () => Response.json({ s: 'ok', symbol: ['AAPL', 'MSFT'], mid: [151.5, 203.25], updated: [sourceTime, sourceTime - 15] }, { status: 203 }));
  const result = await load(owner, ['AAPL', 'MSFT']);
  expect(result).toMatchObject([
    { providerId: 'marketdata_personal_midpoint', assetSymbol: 'AAPL', priceUsd: 151.5, observedAt: '2026-11-06T18:59:30.000Z', priceType: 'indicative_model_midpoint' },
    { assetSymbol: 'MSFT', priceUsd: 203.25, observedAt: '2026-11-06T18:59:15.000Z' },
  ]);
  const [url, options] = jest.mocked(global.fetch).mock.calls[0];
  expect(new URL(String(url)).pathname).toBe('/v1/stocks/prices/');
  expect(new URL(String(url)).searchParams.get('symbols')).toBe('AAPL,MSFT');
  expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-midpoint-private-key');
  expect(String(url)).not.toContain('private-key');
});

test('accepts a verified US custom listing and rejects USD London or uncertain venue before sending credentials', async () => {
  const listing = { symbol: 'IBM', providerSymbol: 'IBM', assetClass: 'stock' as const, nativeCurrency: 'usd' as const, exchange: 'NYQ' };
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async input => String(input).includes('/yahoo/')
    ? Response.json({ instrument: { ...listing, version: 1, name: 'IBM', source: 'yahoo_chart', resolvedAt: '2026-11-06T19:00:00.000Z' } })
    : Response.json({ s: 'ok', symbol: ['IBM'], mid: [200], updated: [sourceTime] }));
  expect(await load(owner, [listing])).toMatchObject([{ assetSymbol: 'IBM', priceUsd: 200 }]);
  for (const entry of [{ ...listing, exchange: 'LSE' }, { ...listing, providerSymbol: 'IBM.L' }, { ...listing, nativeCurrency: 'eur' as const }, 'IVSI']) {
    await expect(load(owner, [entry])).rejects.toThrow();
  }
  expect(global.fetch).toHaveBeenCalledTimes(2); // Metadata resolution, then the independent midpoint.
});

test.each([
  { s: 'ok', symbol: ['AAPL'], mid: [150], updated: [] },
  { s: 'ok', symbol: ['MSFT'], mid: [150], updated: [sourceTime] },
  { s: 'ok', symbol: ['AAPL'], mid: [150], updated: [sourceTime - 8 * 86400] },
  { s: 'ok', symbol: ['AAPL'], mid: [150], updated: [sourceTime + 86400] },
  { s: 'ok', symbol: ['AAPL'], mid: [-150], updated: [sourceTime] },
])('rejects invalid identity, timestamps or column lengths', async payload => {
  global.fetch = jest.fn(async () => Response.json(payload));
  await expect(load(owner, ['AAPL'])).rejects.toThrow();
});

test('charges each requested symbol against the shared conservative daily/hour budget', async () => {
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'HLAL', 'SPUS', 'UMMA', 'SPWO', 'SPTE', 'SPRE'];
  global.fetch = jest.fn(async () => Response.json({ s: 'ok', symbol: symbols, mid: symbols.map(() => 100), updated: symbols.map(() => sourceTime) }));
  await load(owner, symbols);
  await expect(load(owner, symbols)).rejects.toThrow(/budget/i);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('discarded owner response and cancellation cannot return an observation', async () => {
  let release!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise(resolve => { release = resolve; }));
  const task = load(owner, ['AAPL']);
  resolveBrowserWorkspace(owner + '-other');
  adapter.reconcileMarketData(owner + '-other');
  release(Response.json({ s: 'ok', symbol: ['AAPL'], mid: [100], updated: [sourceTime] }));
  await expect(task).rejects.toThrow();
});

test.each([402, 403, 429])('respects an upstream %s cooldown across key resets without echoing error bodies', async status => {
  global.fetch = jest.fn(async () => Response.json({ error: 'test-midpoint-private-key' }, { status, headers: { 'Retry-After': '180' } }));
  await expect(load(owner, ['AAPL'])).rejects.toMatchObject({ status, retryAfterSeconds: 180 });
  adapter.clearMarketData();
  await expect(adapter.connectMarketData(owner, 'test-midpoint-private-key')).rejects.toMatchObject({ status });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
