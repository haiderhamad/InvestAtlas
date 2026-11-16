import { fetchFinancialData } from '@/lib/financial-data/client';
import { parseYahooPersonalChart } from '@/lib/financial-data/providers/yahoo-personal-server';
import { clearYahooPersonalCache, loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { getHistoryRepository } from '@/lib/financial-data/history/cache';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID as owner } from '@/lib/runtime/local-personal-provider';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => null }));

const now = Date.UTC(2026, 10, 7, 12);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = global.fetch;
const storage = new Map<string, string>();
const session = new Map<string, string>();
let testClock = now;
const store = (data: Map<string, string>) => ({
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
});

function series(symbol = 'AAPL', volume: number | null = 130000) {
  return parseYahooPersonalChart(symbol, { chart: { result: [{
    meta: { symbol: symbol === 'ISWD' ? 'IUSD.DE' : symbol, currency: symbol === 'ISWD' ? 'EUR' : 'USD',
      instrumentType: symbol === 'ISWD' ? 'ETF' : 'EQUITY', exchangeName: symbol === 'ISWD' ? 'GER' : 'NMS' },
    timestamp: [Date.UTC(2026, 10, 5, 14) / 1000, Date.UTC(2026, 10, 6, 14) / 1000],
    indicators: { quote: [{ open: [90, 95], high: [100, 105], low: [85, 90], close: [95, 100], volume: [1000, volume] }] },
  }], error: null } }, now);
}

function seriesEndingAt(timestamp: number) {
  const value = series();
  value.bars = value.bars.map((bar, index) => ({ ...bar,
    date: new Date(timestamp - (value.bars.length - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  }));
  value.latestObservationAt = value.bars.at(-1)!.date;
  return value;
}

beforeAll(() => {
  const target = new EventTarget();
  Object.assign(target, { location: new URL('http://127.0.0.1:3187'), localStorage: store(storage), sessionStorage: store(session) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
});
beforeEach(async () => {
  testClock += 600000;
  jest.spyOn(Date, 'now').mockReturnValue(testClock);
  storage.clear(); session.clear();
  resolveBrowserWorkspace(null);
  window.localStorage.setItem('investatlas.anonymous-workspace-mode', 'local_workspace');
  await getHistoryRepository().clearOwner(`${window.location.origin}:local_personal`, owner);
  clearPublicSourceConsent(); clearYahooPersonalCache();
  saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: true, fx: false, spot: false, coinpaprika: false });
  global.fetch = jest.fn(async () => Response.json(series()));
});
afterEach(() => { clearYahooPersonalCache(); clearPublicSourceConsent(); jest.restoreAllMocks(); });
afterAll(() => {
  global.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

async function read(path: string) { return (await fetchFinancialData('/api/prices/' + path)).json(); }

test('browser range validation accepts one completed bar and an explicit empty checked window only for history', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  const range={from:'2026-11-06',to:'2026-11-06'};
  const value=series();value.bars=value.bars.slice(-1);
  global.fetch=jest.fn(async()=>Response.json(value));
  expect((await loadYahooPersonalDailySeries(owner,'AAPL',undefined,range)).bars).toHaveLength(1);
  global.fetch=jest.fn(async()=>Response.json({...value,bars:[],latestObservationAt:null}));
  expect((await loadYahooPersonalDailySeries(owner,'AAPL',undefined,{from:'2026-10-31',to:'2026-11-01'})).bars).toEqual([]);
  await expect(loadYahooPersonalDailySeries(owner,'AAPL')).rejects.toThrow();
});

test('current and history never call Yahoo until session consent is active', async () => {
  expect((await read('current?symbols=AAPL&currency=usd')).status).toBe('unavailable');
  expect((await read('history?symbol=AAPL&currency=usd&interval=1d')).status).toBe('unavailable');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('current and history share exact USD AAPL and EUR IUSD.DE series with no invented volume', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async (_input, init) => Response.json(series(JSON.parse(String(init?.body)).symbol, null)));
  const apple = await read('current?symbols=AAPL&currency=usd');
  expect(apple.prices.AAPL).toMatchObject({ price: 100, currency: 'usd', volume24h: null, priceTiming: 'end_of_day' });
  expect(apple.prices.AAPL.fields.volume.status).toBe('unavailable');
  const history = await read('history?symbol=AAPL&currency=usd&interval=1d');
  expect(history.prices.at(-1)).toMatchObject({ close: 100, volume: null });
  const etf = await read('current?symbols=ISWD&currency=eur');
  expect(etf.prices.ISWD).toMatchObject({ price: 100, currency: 'eur', fields: { listingCurrency: 'EUR' } });
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(jest.mocked(global.fetch).mock.calls.every(([url]) => url === '/api/local/yahoo/series')).toBe(true);
});

test('browser preserves a validated source observation without changing completed EOD history', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  const current = { price: 101.25, observedAt: new Date(testClock - 60_000).toISOString() };
  global.fetch = jest.fn(async () => Response.json({ ...series(), current }));
  const result = await loadYahooPersonalDailySeries(owner, 'AAPL');
  expect(result).toHaveProperty('current', current);
  expect(result.bars.at(-1)).toMatchObject({ date: '2026-11-06', close: 100 });
  expect(result.latestObservationAt).toBe('2026-11-06');
});

test('cancelling one shared Yahoo caller does not cancel another observer of the same listing', async () => {
  setPublicSourceConsent(owner,['yahoo']);
  let finish!: (response:Response)=>void;
  global.fetch=jest.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));
  const controller=new AbortController();
  const first=loadYahooPersonalDailySeries(owner,'AAPL',controller.signal);
  const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});
  const second=loadYahooPersonalDailySeries(owner,'AAPL');
  for(let n=0;n<8&&!finish;n++) await Promise.resolve();
  controller.abort();finish(Response.json(series()));
  await rejected;expect((await second).bars.at(-1)?.close).toBe(100);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('explicit old daily backfill has its own cache key and cannot replace the current-price series', async () => {
  setPublicSourceConsent(owner,['yahoo']);
  const range={from:'2022-01-01',to:'2023-06-01'};
  const past=seriesEndingAt(Date.parse('2023-06-01T16:00:00Z'));
  global.fetch=jest.fn(async(_input,init)=>Response.json(JSON.parse(String(init?.body)).range ? past : series()));
  const history=await loadYahooPersonalDailySeries(owner,'AAPL',undefined,range);
  expect(history.latestObservationAt).toBe('2023-06-01');
  expect((await loadYahooPersonalDailySeries(owner,'AAPL')).latestObservationAt).toBe('2026-11-06');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(jest.mocked(global.fetch).mock.calls[0][1]?.body)).range).toEqual(range);
});

test('browser independently strips a current observation older than its completed EOD fallback', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ ...series(), current: {
    price: 80, observedAt: '2026-11-05T21:00:00.000Z',
  } }));
  const result = await loadYahooPersonalDailySeries(owner, 'AAPL');
  expect(result).not.toHaveProperty('current');
  expect(result.bars.at(-1)?.close).toBe(100);
});

test.each([
  ['missing price', { observedAt: 'valid' }],
  ['missing time', { price: 101 }],
  ['zero price', { price: 0, observedAt: 'valid' }],
  ['negative price', { price: -1, observedAt: 'valid' }],
  ['string price', { price: '101', observedAt: 'valid' }],
  ['unbounded price', { price: 1e8 + 1, observedAt: 'valid' }],
  ['numeric timestamp', { price: 101, observedAt: 1794052800 }],
  ['invalid timestamp', { price: 101, observedAt: 'garbage' }],
  ['non-ISO timestamp', { price: 101, observedAt: 'November 7, 2026 12:00:00 UTC' }],
  ['invalid calendar date', { price: 101, observedAt: '2026-11-31T12:00:00.000Z' }],
  ['non-object metadata', 'garbage'],
  ['null metadata', null],
])('browser strips %s while preserving EOD fallback', async (_label, current) => {
  setPublicSourceConsent(owner, ['yahoo']);
  const metadata = current && typeof current === 'object' && 'observedAt' in current && current.observedAt === 'valid'
    ? { ...current, observedAt: new Date(testClock - 60_000).toISOString() } : current;
  global.fetch = jest.fn(async () => Response.json({ ...series(), current: metadata }));
  const result = await loadYahooPersonalDailySeries(owner, 'AAPL');
  expect(result).not.toHaveProperty('current');
  expect(result.bars.at(-1)).toMatchObject({ close: 100 });
});

test.each([
  ['older than seven days', -7 * 86_400_000 - 1000, false],
  ['seven days old', -7 * 86_400_000, true],
  ['five minutes ahead', 300_000, true],
  ['more than five minutes ahead', 301_000, false],
])('browser independently validates a current observation %s', async (_label, offset, accepted) => {
  setPublicSourceConsent(owner, ['yahoo']);
  const current = { price: 101.25, observedAt: new Date(testClock + Number(offset)).toISOString() };
  const daily = Number(offset) <= -7 * 86_400_000 ? seriesEndingAt(testClock + Number(offset)) : series();
  global.fetch = jest.fn(async () => Response.json({ ...daily, current }));
  const result = await loadYahooPersonalDailySeries(owner, 'AAPL');
  if (accepted) expect(result).toHaveProperty('current', current);
  else expect(result).not.toHaveProperty('current');
});

test('a cached current observation cannot outlive the seven-day age bound', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  const current = { price: 101.25, observedAt: new Date(testClock - 7 * 86_400_000).toISOString() };
  global.fetch = jest.fn(async () => Response.json({ ...seriesEndingAt(testClock - 7 * 86_400_000), current }));
  expect(await loadYahooPersonalDailySeries(owner, 'AAPL')).toHaveProperty('current', current);
  jest.mocked(Date.now).mockReturnValue(testClock + 1000);
  const cached = await loadYahooPersonalDailySeries(owner, 'AAPL');
  expect(cached).not.toHaveProperty('current');
  expect(cached.bars.at(-1)).toMatchObject({ close: 100 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 429, 503])('HTTP %s does not cause repeated automatic Yahoo calls from current and history', async status => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ error: 'unavailable' }, { status, headers: { 'Retry-After': '120' } }));
  expect((await read('current?symbols=AAPL&currency=usd')).status).toBe('unavailable');
  expect((await read('current?symbols=ISWD&currency=eur')).status).toBe('unavailable');
  expect((await read('history?symbol=AAPL&currency=usd&interval=1d')).status).toBe('unavailable');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a rate limit honors Retry-After without blocking unrelated sources forever', async () => {
  const requestedAt = Date.now();
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  await expect(loadYahooPersonalDailySeries(owner, 'AAPL')).rejects.toThrow();
  jest.mocked(Date.now).mockReturnValue(requestedAt + 119000);
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD')).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.mocked(Date.now).mockReturnValue(requestedAt + 121000);
  global.fetch = jest.fn(async () => Response.json(series()));
  await expect(loadYahooPersonalDailySeries(owner, 'AAPL')).resolves.toMatchObject({ providerSymbol: 'AAPL' });
});

test('changing consent or leaving the workspace cannot erase an upstream Retry-After', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  await expect(loadYahooPersonalDailySeries(owner, 'AAPL')).rejects.toThrow();
  clearPublicSourceConsent(); clearYahooPersonalCache();
  setPublicSourceConsent(owner, ['yahoo']);
  await expect(loadYahooPersonalDailySeries(owner, 'ISWD')).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('revoking then reapproving the same owner cannot revive an old in-flight series or cache it', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  let finish!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const old = loadYahooPersonalDailySeries(owner, 'AAPL');
  clearPublicSourceConsent(); clearYahooPersonalCache();
  setPublicSourceConsent(owner, ['yahoo']);
  finish(Response.json(series()));
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  global.fetch = jest.fn(async () => Response.json(series()));
  await expect(loadYahooPersonalDailySeries(owner, 'AAPL')).resolves.toMatchObject({ providerSymbol: 'AAPL' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('USD Yahoo current and history are converted using sourced ECB rates and actual converted observation dates', async () => {
  setPublicSourceConsent(owner, ['yahoo']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), fx: true });
  global.fetch = jest.fn(async input => {
    const path = String(input);
    if (path.includes('/fx/history')) return Response.json({ status:'complete', sourceAttribution:'Source: ECB statistics.', data: [{ date: '2026-10-29', asOf: '2026-10-29', rate: 0.9 }] });
    if (path.includes('/fx?')) return Response.json({ data: { baseCurrency: 'USD', quoteCurrency: 'EUR', rate: {
      status: 'available', freshness: 'fresh', value: 0.9, asOf: '2026-11-06', observedAt: '2026-11-06',
      provenance: { providerId: 'ecb_reference_rates', providerName: 'European Central Bank', retrievedAt: new Date(now).toISOString() },
    } } });
    return Response.json(series());
  });
  const current = await read('current?symbols=AAPL&currency=eur');
  expect(current.prices.AAPL.price).toBe(90);
  expect(current.prices.AAPL.fields.price.quality).toBe('calculated');
  const history = await read('history?symbol=AAPL&currency=eur&interval=1d');
  expect(history.prices).toHaveLength(1);
  expect(history.prices[0]).toMatchObject({ date: '2026-11-05', close: 85.5, conversion: { rate: 0.9, asOf: '2026-10-29' } });
  expect(history.latestObservationAt).toBe('2026-11-05');
});

test.each([false, true])('revoking permission during FX conversion rejects the complete history response (reapprove=%s)', async reapprove => {
  setPublicSourceConsent(owner, ['yahoo']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), fx: true });
  let finish!: (response: Response) => void;
  let fxStarted!: () => void;
  const fxPending = new Promise<void>(resolve => { fxStarted = resolve; });
  global.fetch = jest.fn(async input => {
    if (String(input).includes('/fx/history')) {
      fxStarted();
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return Response.json(series());
  });
  const old = read('history?symbol=AAPL&currency=eur&interval=1d');
  await fxPending;
  clearPublicSourceConsent();
  if (reapprove) setPublicSourceConsent(owner, ['yahoo']);
  finish(Response.json({ status:'complete', sourceAttribution:'Source: ECB statistics.', data: [{ date: '2026-11-06', asOf: '2026-11-06', rate: 0.9 }] }));
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
});
