import {
  clearEodhd, connectEodhd, hasEodhd, loadEodhdHistory,
  reconcileEodhd, readEodhdHistoryYears,
} from '@/lib/financial-data/providers/eodhd-personal';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

let mockMode = 'private_cloud';
let mockOwner = '';
jest.mock('@/lib/runtime/deployment-mode', () => ({ get INVESTATLAS_DEPLOYMENT_MODE() { return mockMode; } }));
jest.mock('@/lib/financial-data/providers/source-selection', () => ({ SOURCE_CHANGE: 'investatlas:market-source-selection' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => ({ userId: mockOwner, token: 'test-owner-session-token' }) }));
const NOW = Date.UTC(2026, 10, 7, 12);
const KEY = 'test-owner-only-eodhd-secret';
const range = { from: '2026-11-01', to: '2026-11-06' };
const series = {
  providerId: 'eodhd_personal_daily', assetSymbol: 'AAPL', providerSymbol: 'AAPL.US', exchange: 'NMS', listingCurrency: 'USD',
  retrievedAt: '2026-11-07T12:00:00.000Z', latestObservationAt: '2026-11-06', cacheStatus: 'miss', adjustment: 'raw_unadjusted', volumeAdjustment: 'splits',
  bars: [{ date: '2026-11-06', open: 100, high: 105, low: 99, close: 103, volume: 1000, adjustedClose: 95 }],
  coverage: { requested: range, checked: range, available: { from: '2026-11-06', to: '2026-11-06' }, historyYears: 1, limited: false },
};
const oldWindow = globalThis.window;
const oldFetch = global.fetch;
const storage = new Map<string, string>();
beforeAll(() => {
  const view = new EventTarget();
  Object.assign(view, { location: new URL('https://private.example'), localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
});
beforeEach(() => {
  mockMode = 'private_cloud';
  mockOwner = 'eodhd-browser-' + Math.random().toString(16).slice(2);
  resolveBrowserWorkspace(mockOwner);
  clearEodhd();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = jest.fn(async (_url, options) => JSON.parse(String(options?.body)).action === 'connect'
    ? Response.json({ connected: true, historyYears: JSON.parse(String(options?.body)).historyYears }) : Response.json(series));
});
afterEach(() => { clearEodhd(); jest.restoreAllMocks(); global.fetch = oldFetch; });
afterAll(() => { Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow }); });

test('keeps a key only in tab memory and uses authenticated same-origin POST bodies without URL credentials', async () => {
  await connectEodhd(mockOwner, KEY, 1);
  expect(hasEodhd(mockOwner)).toBe(true);
  expect(readEodhdHistoryYears(mockOwner)).toBe(1);
  const loaded = await loadEodhdHistory(mockOwner, 'AAPL', range);
  expect(loaded.bars[0]).toMatchObject({ close: 103, adjustedClose: 95 });
  for (const [url, options] of jest.mocked(global.fetch).mock.calls) {
    expect(String(url)).toBe('/api/financial-data/eodhd/personal-history');
    expect(String(url)).not.toContain(KEY);
    expect(options?.method).toBe('POST');
    expect(options?.credentials).toBe('same-origin');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-owner-session-token');
  }
  expect(JSON.stringify([...storage.entries()])).not.toContain(KEY);
  clearEodhd();
  expect(hasEodhd(mockOwner)).toBe(false);
});

test('user-selected five-year entitlement is explicit and never becomes a free default', async () => {
  expect(readEodhdHistoryYears(mockOwner)).toBe(1);
  await connectEodhd(mockOwner, KEY, 5);
  expect(readEodhdHistoryYears(mockOwner)).toBe(5);
  await expect(connectEodhd(mockOwner, KEY, 3 as 1)).rejects.toThrow();
});

test('independently rejects forged response currency, raw/adjusted mixing, coverage and incomplete candles', async () => {
  await connectEodhd(mockOwner, KEY, 1);
  for (const value of [
    { ...series, listingCurrency: 'EUR' }, { ...series, providerSymbol: 'AAPL.LSE' },
    { ...series, adjustment: 'adjusted' }, { ...series, latestObservationAt: '2026-11-05' },
    { ...series, coverage: { ...series.coverage, checked: { from: '2020-01-01', to: range.to } } },
    { ...series, bars: [{ ...series.bars[0], date: '2026-11-07' }] },
  ]) {
    global.fetch = jest.fn(async () => Response.json(value));
    await expect(loadEodhdHistory(mockOwner, 'AAPL', range)).rejects.toThrow();
  }
});

test('key clear/owner change invalidates pending work and never adopts the old owner credential', async () => {
  await connectEodhd(mockOwner, KEY, 1);
  let release!: (value: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  global.fetch = jest.fn(() => new Promise(resolve => { release = resolve; started(); }));
  const task = loadEodhdHistory(mockOwner, 'AAPL', range);
  await entered;
  const other = mockOwner + '-other';
  resolveBrowserWorkspace(other);
  reconcileEodhd(other);
  release(Response.json(series));
  await expect(task).rejects.toThrow();
  expect(hasEodhd(other)).toBe(false);
});

test('provider cooldown survives disconnect and reconnect attempts without resending a secret', async () => {
  global.fetch = jest.fn(async () => Response.json({ error: KEY }, { status: 429, headers: { 'Retry-After': '180' } }));
  await expect(connectEodhd(mockOwner, KEY, 1)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 180 });
  clearEodhd();
  await expect(connectEodhd(mockOwner, KEY, 1)).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('public demo and inactive owners cannot send a key', async () => {
  mockMode = 'public_demo';
  await expect(connectEodhd(mockOwner, KEY, 1)).rejects.toThrow();
  mockMode = 'private_cloud';
  await expect(connectEodhd(mockOwner + '-other', KEY, 1)).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});
