import {
  clearPersonalHistoryCache, getPersonalHistoryCacheStats, loadPersonalDailyHistory, schedulePersonalHistoryWarmup,
} from '@/lib/financial-data/providers/personal-history-service';
import { loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';
import { hasEodhd, loadEodhdHistory, readEodhdHistoryYears } from '@/lib/financial-data/providers/eodhd-personal';
import { loadTiingoBrowserDailySeries } from '@/lib/financial-data/providers/tiingo-browser';
import { loadTwelve, loadTwelveDemo } from '@/lib/financial-data/providers/twelve-personal';
import { loadMarketData } from '@/lib/financial-data/providers/marketdata-personal';
import { loadPublicExchangeSeries } from '@/lib/financial-data/providers/public-exchange-browser';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection, SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { getHistoryRepository, type DailyHistoryBar, type HistoryRange } from '@/lib/financial-data/history/cache';
import type { EodhdDailySeries } from '@/lib/financial-data/providers/eodhd-contract';
import { getEodhdTarget } from '@/lib/financial-data/providers/eodhd-contract';
import type { YahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal-server';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/financial-data/providers/eodhd-personal', () => ({
  EODHD_CHANGE_EVENT: 'investatlas:eodhd-session-changed',
  hasEodhd: jest.fn(), readEodhdHistoryYears: jest.fn(), loadEodhdHistory: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/yahoo-personal', () => ({ loadYahooPersonalDailySeries: jest.fn() }));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT: 'investatlas:tiingo-browser-provider-change',
  loadTiingoBrowserDailySeries: jest.fn(), hasTiingoBrowserCredential: () => true, supportsTiingoBrowserAsset: () => true,
}));
jest.mock('@/lib/financial-data/providers/twelve-personal', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/twelve-personal'),
  loadTwelve: jest.fn(), loadTwelveDemo: jest.fn(), hasTwelve: () => true, supportsTwelve: () => true,
}));
jest.mock('@/lib/financial-data/providers/marketdata-personal', () => ({
  loadMarketData: jest.fn(), hasMarketData: () => true, supportsMarketDataAsset: () => true,
}));
jest.mock('@/lib/financial-data/providers/public-exchange-browser', () => ({ loadPublicExchangeSeries: jest.fn() }));

const now = Date.UTC(2026, 10, 7, 12);
const owner = 'owner-a';
const range: HistoryRange = { from: '2026-10-01', to: '2026-11-06' };
let clock = now;
const bar = (date: string): DailyHistoryBar => ({ date, open: 10, high: 15, low: 9, close: 12, volume: null });
const yahoo = (checked: HistoryRange, dates = [checked.from, checked.to]): YahooPersonalDailySeries => ({
  providerId: 'yahoo_personal_daily', assetSymbol: 'AAPL', providerSymbol: 'AAPL', exchange: 'NMS',
  listingCurrency: 'USD', retrievedAt: new Date(clock).toISOString(), latestObservationAt: dates.at(-1)!,
  cacheStatus: 'miss', bars: [...new Set(dates)].map(bar),
});
const eodhd = (checked: HistoryRange, dates = [checked.from, checked.to]): EodhdDailySeries => ({
  providerId: 'eodhd_personal_daily', assetSymbol: 'AAPL', providerSymbol: 'AAPL.US', exchange: 'NMS',
  listingCurrency: 'USD', retrievedAt: new Date(clock).toISOString(), latestObservationAt: dates.at(-1) ?? null,
  cacheStatus: 'miss', adjustment: 'raw_unadjusted', volumeAdjustment: 'splits',
  bars: [...new Set(dates)].map(date => ({ ...bar(date), adjustedClose: 6 })),
  coverage: { requested: { ...checked }, checked: { ...checked },
    available: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    historyYears: jest.mocked(readEodhdHistoryYears).mock.results.at(-1)?.value ?? 5, limited: false },
});
const tickUntil = async (ready: () => boolean) => {
  for (let index = 0; index < 40 && !ready(); index++) await Promise.resolve();
  expect(ready()).toBe(true);
};
const outcome = (promise: Promise<unknown>) => promise.then(() => null, error => error);

let originalWindow: PropertyDescriptor | undefined;
let originalDocument: PropertyDescriptor | undefined;
const idleCallbacks = new Map<number, IdleRequestCallback>();
let nextIdle = 0;
const drainIdle = async () => {
  for (let index = 0; index < 500; index++) {
    const next = idleCallbacks.entries().next().value;
    if (next) {
      idleCallbacks.delete(next[0]);
      next[1]({ didTimeout: false, timeRemaining: () => 50 });
    }
    await Promise.resolve();
  }
};
beforeAll(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const target = new EventTarget();
  const local = new Map<string, string>(), session = new Map<string, string>();
  const store = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  Object.assign(target, { location: new URL('http://127.0.0.1:3187'), localStorage: store(local), sessionStorage: store(session),
    requestIdleCallback: (callback: IdleRequestCallback) => { const id = ++nextIdle; idleCallbacks.set(id, callback); return id; },
    cancelIdleCallback: (id: number) => { idleCallbacks.delete(id); },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
});
beforeEach(async () => {
  clock = now;
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  idleCallbacks.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  resolveBrowserWorkspace(owner);
  setPublicSourceConsent(owner, ['yahoo', 'binance', 'kraken']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: true, binance: true, kraken: true, twelveDemo: true, historyPreload: true });
  jest.mocked(hasEodhd).mockReturnValue(true);
  jest.mocked(readEodhdHistoryYears).mockReturnValue(5);
  jest.mocked(loadYahooPersonalDailySeries).mockImplementation(async (_owner, _symbol, _signal, checked) => yahoo(checked!));
  jest.mocked(loadEodhdHistory).mockImplementation(async (_owner, _identity, checked) => eodhd(checked));
  await clearPersonalHistoryCache(owner);
});
afterEach(async () => {
  resolveBrowserWorkspace(owner);
  await clearPersonalHistoryCache(owner);
  jest.restoreAllMocks();
});
afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

test('Yahoo reuses checked ranges in tab memory and fetches only an older missing gap', async () => {
  const first = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  expect(first?.cacheStatus).toBe('miss');
  expect((await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range))?.cacheStatus).toBe('hit_fresh');
  const extended = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', { from: '2026-09-01', to: range.to });
  expect(jest.mocked(loadYahooPersonalDailySeries).mock.calls.map(call => call[3])).toEqual([
    range, { from: '2026-09-01', to: '2026-09-30' },
  ]);
  expect(extended?.bars.map(row => row.date)).toEqual(['2026-09-01', '2026-09-30', '2026-10-01', '2026-11-06']);
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('Yahoo refreshes only the stale seven-day overlap and preserves older bars', async () => {
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  clock += 6 * 3_600_000 + 1;
  const refreshed = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  expect(jest.mocked(loadYahooPersonalDailySeries).mock.calls.map(call => call[3])).toEqual([
    range, { from: '2026-10-31', to: '2026-11-06' },
  ]);
  expect(refreshed?.bars[0].date).toBe('2026-10-01');
});

test('a short provider reply exposes its actual available span and cannot masquerade as five years', async () => {
  const requested = { from: '2021-11-07', to: '2026-11-06' };
  jest.mocked(loadYahooPersonalDailySeries).mockImplementation(async () => yahoo(requested, ['2026-11-05', '2026-11-06']));
  const result = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', requested);
  expect(result).toMatchObject({ requestedRange: requested, availableRange: { from: '2026-11-05', to: '2026-11-06' }, coverageLimited: true });
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', requested);
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(1);
});

test('an old explicitly requested backfill remains reusable without a current-tail request', async () => {
  const requested = { from: '2022-01-03', to: '2023-06-01' };
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', requested);
  clock += 3 * 86_400_000;
  const cached = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', requested);
  expect(cached).toMatchObject({ latestObservationAt: '2023-06-01', cacheStatus: 'hit_fresh', refreshFailed: false });
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(1);
});

test('a failed refresh preserves useful history and suppresses immediate automatic retries', async () => {
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  clock += 7 * 3_600_000;
  jest.mocked(loadYahooPersonalDailySeries).mockRejectedValue(new Error('Provider unavailable'));
  const cached = await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  expect(cached).toMatchObject({ cacheStatus: 'hit_stale', refreshFailed: true, availableRange: range });
  expect(cached?.bars).toHaveLength(2);
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(2);
});

test('EODHD stores native raw/adjusted values and serves licensed history after disconnect', async () => {
  const loaded = await loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  expect(loaded?.bars[0]).toMatchObject({ close: 12, adjustedClose: 6 });
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(1);
  clock += 7 * 3_600_000;
  jest.mocked(hasEodhd).mockReturnValue(false);
  window.dispatchEvent(new Event(SOURCE_CHANGE));
  const cached = await loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  expect(cached).toMatchObject({ providerSymbol: 'AAPL.US', cacheStatus: 'hit_stale', refreshFailed: false });
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
});

test('free EODHD requests clamp to the entitled year and never repeatedly request an impossible old gap', async () => {
  jest.mocked(readEodhdHistoryYears).mockReturnValue(1);
  const requested = { from: '2021-11-07', to: '2026-11-06' };
  const partial = await loadPersonalDailyHistory('eodhd', owner, 'AAPL', requested);
  expect(partial).toMatchObject({ coverageLimited: true, availableRange: { from: '2025-11-07', to: '2026-11-06' } });
  await loadPersonalDailyHistory('eodhd', owner, 'AAPL', requested);
  expect(jest.mocked(loadEodhdHistory).mock.calls.map(call => call[2])).toEqual([{ from: '2025-11-07', to: '2026-11-06' }]);
  expect(await loadPersonalDailyHistory('eodhd', owner, 'AAPL', { from: '2022-01-01', to: '2023-01-01' })).toBeNull();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
});

test('an already retained five-year EODHD history survives a later free entitlement', async () => {
  const requested = { from: '2021-11-07', to: '2026-11-06' };
  await loadPersonalDailyHistory('eodhd', owner, 'AAPL', requested);
  jest.mocked(readEodhdHistoryYears).mockReturnValue(1);
  window.dispatchEvent(new Event(SOURCE_CHANGE));
  const retained = await loadPersonalDailyHistory('eodhd', owner, 'AAPL', requested);
  expect(retained?.bars[0].date).toBe('2021-11-07');
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
});

test('one cancelled subscriber cannot abort another observer of the same history request', async () => {
  let finish!: (value: EodhdDailySeries) => void;
  jest.mocked(loadEodhdHistory).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const first = loadPersonalDailyHistory('eodhd', owner, 'AAPL', range, controller.signal);
  const rejected = outcome(first);
  const second = loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  await tickUntil(() => !!finish);
  controller.abort();
  expect(jest.mocked(loadEodhdHistory).mock.calls[0][3]?.aborted).toBe(false);
  finish(eodhd(range));
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  expect((await second)?.bars).toHaveLength(2);
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
});

test('cancelling all observers aborts the provider and prevents late cache writes', async () => {
  let finish!: (value: EodhdDailySeries) => void;
  jest.mocked(loadEodhdHistory).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const result = loadPersonalDailyHistory('eodhd', owner, 'AAPL', range, controller.signal);
  const rejected = outcome(result);
  await tickUntil(() => !!finish);
  controller.abort();
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  expect(jest.mocked(loadEodhdHistory).mock.calls[0][3]?.aborted).toBe(true);
  finish(eodhd(range));
  await Promise.resolve(); await Promise.resolve();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('clearing owner history aborts pending readers and deletion wins over late provider replies', async () => {
  let finish!: (value: EodhdDailySeries) => void;
  jest.mocked(loadEodhdHistory).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  const rejected = outcome(pending);
  await tickUntil(() => !!finish);
  await clearPersonalHistoryCache(owner);
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  finish(eodhd(range));
  await Promise.resolve(); await Promise.resolve();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('owner switches fence an asynchronous cache read before any provider request can start', async () => {
  const repo = getHistoryRepository();
  let finish!: (value: null) => void;
  const read = jest.spyOn(repo, 'read').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  const rejected = outcome(pending);
  await tickUntil(() => !!finish);
  resolveBrowserWorkspace('owner-b');
  finish(null);
  expect(await rejected).toMatchObject({ name: 'AbortError' });
  expect(loadEodhdHistory).not.toHaveBeenCalled();
  read.mockRestore();
});

test('ending Yahoo permission clears tab history while retained EODHD records remain', async () => {
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  await loadPersonalDailyHistory('eodhd', owner, 'AAPL', range);
  setPublicSourceConsent(owner, []);
  expect(await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range)).toBeNull();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(1);
  setPublicSourceConsent(owner, ['yahoo']);
  await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(2);
});

test.each(['tiingo', 'twelve', 'marketdata', 'binance', 'kraken', 'twelve_demo'] as const)
('passes %s history through its existing loader without new retention', async source => {
  const native = { ...yahoo(range), providerId: source === 'tiingo' ? 'tiingo_browser_byok' : `${source}_personal_daily`,
    bars: yahoo(range).bars.map(row => ({ ...row, volume: 10 })), listingCurrency: 'USD' as const };
  jest.mocked(loadTiingoBrowserDailySeries).mockResolvedValue(native as never);
  jest.mocked(loadTwelve).mockResolvedValue(native as never);
  jest.mocked(loadMarketData).mockResolvedValue(native as never);
  jest.mocked(loadPublicExchangeSeries).mockResolvedValue(native as never);
  jest.mocked(loadTwelveDemo).mockResolvedValue(native as never);
  expect((await loadPersonalDailyHistory(source, owner, 'AAPL', range))?.bars).toHaveLength(2);
  expect((await loadPersonalDailyHistory(source, owner, 'AAPL', range))?.bars).toHaveLength(2);
  expect([loadTiingoBrowserDailySeries, loadTwelve, loadMarketData, loadPublicExchangeSeries, loadTwelveDemo]
    .reduce((count, loader) => count + jest.mocked(loader).mock.calls.length, 0)).toBe(2);
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('an unsupported EODHD counterpart fails closed without requesting or retaining guessed history', async () => {
  expect(await loadPersonalDailyHistory('eodhd', owner, 'BTC', range)).toBeNull();
  expect(loadEodhdHistory).not.toHaveBeenCalled();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('legacy series without verified venue metadata do not acquire an invented exchange', async () => {
  jest.mocked(loadTiingoBrowserDailySeries).mockResolvedValue({
    providerId: 'tiingo_browser_byok', assetSymbol: 'AAPL', providerSymbol: 'AAPL', listingCurrency: 'USD',
    retrievedAt: new Date(now).toISOString(), latestObservationAt: range.to, cacheStatus: 'miss',
    bars: [range.from, range.to].map(date => ({ ...bar(date), volume: 10 })),
  });
  const result = await loadPersonalDailyHistory('tiingo', owner, 'AAPL', range);
  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty('exchange');
});

test('a mismatched EODHD venue or currency cannot enter the native repository', async () => {
  jest.mocked(loadEodhdHistory).mockResolvedValue({ ...eodhd(range), listingCurrency: 'EUR' });
  expect(await loadPersonalDailyHistory('eodhd', owner, 'AAPL', range)).toBeNull();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('idle warming requires a key, respects configured depth, and stops at eight exact supported assets per session', async () => {
  const symbols = ['BTC', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'HLAL', 'UMMA'];
  jest.mocked(hasEodhd).mockReturnValue(false);
  schedulePersonalHistoryWarmup(owner, symbols);
  await drainIdle();
  expect(loadEodhdHistory).not.toHaveBeenCalled();
  jest.mocked(hasEodhd).mockReturnValue(true);
  jest.mocked(readEodhdHistoryYears).mockReturnValue(1);
  jest.mocked(loadEodhdHistory).mockImplementation(async (_owner, identity, checked) => {
    const target = getEodhdTarget(identity);
    return { ...eodhd(checked), assetSymbol: target.instrument.symbol, providerSymbol: target.providerSymbol, exchange: target.exchange };
  });
  schedulePersonalHistoryWarmup(owner, symbols);
  await drainIdle();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(8);
  expect(jest.mocked(loadEodhdHistory).mock.calls.every(call => call[2].from === '2025-11-07' && call[2].to === '2026-11-06')).toBe(true);
  schedulePersonalHistoryWarmup(owner, ['UMMA', 'SPUS']);
  await drainIdle();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(8);
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(8);
});

test('idle warming waits until the visible history request finishes', async () => {
  let finish!: (value: YahooPersonalDailySeries) => void;
  jest.mocked(loadYahooPersonalDailySeries).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const visible = loadPersonalDailyHistory('yahoo', owner, 'AAPL', range);
  await tickUntil(() => !!finish);
  schedulePersonalHistoryWarmup(owner, ['AAPL']);
  await drainIdle();
  expect(loadEodhdHistory).not.toHaveBeenCalled();
  finish(yahoo(range));
  await visible;
  await drainIdle();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
});

test('hiding the document cancels the queued warmup without affecting normal history reads', async () => {
  schedulePersonalHistoryWarmup(owner, ['AAPL']);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await drainIdle();
  expect(loadEodhdHistory).not.toHaveBeenCalled();
  expect((await loadPersonalDailyHistory('yahoo', owner, 'AAPL', range))?.bars).toHaveLength(2);
});

test('disabling history preload prevents queued and subsequent background downloads', async () => {
  schedulePersonalHistoryWarmup(owner, ['AAPL']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), historyPreload: false });
  await drainIdle();
  schedulePersonalHistoryWarmup(owner, ['MSFT']);
  await drainIdle();
  expect(loadEodhdHistory).not.toHaveBeenCalled();
});

test('a quota failure stops the remaining warmup queue', async () => {
  jest.mocked(loadEodhdHistory).mockRejectedValue(Object.assign(new Error('Quota'), { status: 429, retryAfterSeconds: 90 }));
  schedulePersonalHistoryWarmup(owner, ['AAPL', 'MSFT', 'NVDA']);
  await drainIdle();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});

test('source changes abort an active warmup and block its late write', async () => {
  let finish!: (value: EodhdDailySeries) => void;
  jest.mocked(loadEodhdHistory).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  schedulePersonalHistoryWarmup(owner, ['AAPL']);
  await drainIdle();
  expect(loadEodhdHistory).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event(SOURCE_CHANGE));
  expect(jest.mocked(loadEodhdHistory).mock.calls[0][3]?.aborted).toBe(true);
  finish(eodhd({ from: '2021-11-07', to: '2026-11-06' }));
  await drainIdle();
  expect((await getPersonalHistoryCacheStats(owner)).recordCount).toBe(0);
});
