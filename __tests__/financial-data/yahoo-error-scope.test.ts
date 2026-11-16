import { clearYahooPersonalCache, loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID as owner } from '@/lib/runtime/local-personal-provider';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => null }));
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = global.fetch;
const storage = new Map<string, string>();
const session = new Map<string, string>();
const store = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } });
let now = Date.parse('2026-11-08T12:00:00Z');
const range = { from: '2025-11-07', to: '2026-11-07' };
function series(symbol: string) {
  return { providerId: 'yahoo_personal_daily', assetSymbol: symbol,
    providerSymbol: symbol === 'ISWD' ? 'IUSD.DE' : symbol, listingCurrency: symbol === 'ISWD' ? 'EUR' : 'USD',
    retrievedAt: new Date(now).toISOString(), latestObservationAt: '2026-11-06', cacheStatus: 'miss',
    bars: ['2026-11-05', '2026-11-06'].map(date => ({ date, open: 58, high: 59, low: 57, close: 58.45, volume: null })) };
}
beforeAll(() => {
  const target = new EventTarget();
  Object.assign(target, { location: new URL('http://127.0.0.1:3000'), localStorage: store(storage), sessionStorage: store(session) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
});
beforeEach(() => {
  now += 600000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  storage.clear(); session.clear(); resolveBrowserWorkspace(null);
  window.localStorage.setItem('investatlas.anonymous-workspace-mode', 'local_workspace');
  clearPublicSourceConsent(); clearYahooPersonalCache(); setPublicSourceConsent(owner, ['yahoo']);
});
afterEach(() => { clearYahooPersonalCache(); clearPublicSourceConsent(); jest.restoreAllMocks(); });
afterAll(() => { global.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });

test.each([400, 404, 503])('instrument/range HTTP %s cannot block another ETF or the same ETF current observation', async status => {
  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return body.symbol === 'ISWD' && body.range
      ? Response.json({ code: 'provider_unavailable' }, { status }) : Response.json(series(body.symbol));
  });
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).rejects.toThrow();
  await expect(loadYahooPersonalDailySeries(owner, 'HLAL', undefined, range)).resolves.toMatchObject({ assetSymbol: 'HLAL' });
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD')).resolves.toHaveProperty('latestObservationAt', '2026-11-06');
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('an instrument history error cannot hide an already validated cached current series', async () => {
  global.fetch = jest.fn(async (_url, init) => JSON.parse(String(init?.body)).range
    ? Response.json({ code: 'provider_unavailable' }, { status: 503 }) : Response.json(series('ISWD')));
  const current = await loadYahooPersonalDailySeries(owner, 'ISWD');
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).rejects.toThrow();
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD')).resolves.toEqual(current);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test.each([
  [401, {}, undefined], [403, {}, undefined], [429, {}, undefined],
  [503, { code: 'provider_access_denied' }, undefined], [503, { code: 'provider_unavailable' }, '120'],
] as const)('preserves owner-wide protection for HTTP %s and provider retry/auth signals', async (status, body, retry) => {
  global.fetch = jest.fn(async () => Response.json(body, { status, ...(retry ? { headers: { 'Retry-After': retry } } : {}) }));
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).rejects.toThrow();
  await expect(loadYahooPersonalDailySeries(owner, 'HLAL')).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a scoped error expires before a deliberate retry and cannot survive a legitimate session reset', async () => {
  global.fetch = jest.fn(async () => Response.json({}, { status: 503 }));
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).rejects.toThrow();
  now += 91000;
  global.fetch = jest.fn(async () => Response.json(series('ISWD')));
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD', undefined, range)).resolves.toHaveProperty('assetSymbol', 'ISWD');
});
