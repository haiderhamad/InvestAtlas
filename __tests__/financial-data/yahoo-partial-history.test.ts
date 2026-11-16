import { clearPersonalHistoryCache, loadPersonalDailyHistory } from '@/lib/financial-data/providers/personal-history-service';
import { loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => null }));
jest.mock('@/lib/financial-data/providers/yahoo-personal', () => ({ loadYahooPersonalDailySeries: jest.fn() }));
const owner = 'yahoo-gap-owner';
const now = Date.parse('2026-11-08T12:00:00Z');
const range = { from: '2025-11-07', to: '2026-11-07' };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let clock = now;
beforeAll(() => {
  const target = new EventTarget();
  const local = new Map<string, string>(), session = new Map<string, string>();
  const store = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
  Object.assign(target, { location: new URL('http://127.0.0.1:3000'), localStorage: store(local), sessionStorage: store(session) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
});
beforeEach(async () => {
  clock = now; jest.spyOn(Date, 'now').mockImplementation(() => clock); jest.clearAllMocks();
  resolveBrowserWorkspace(owner); setPublicSourceConsent(owner, ['yahoo']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), yahoo: true });
  await clearPersonalHistoryCache(owner);
  jest.mocked(loadYahooPersonalDailySeries).mockImplementation(async (_owner, _symbol, _signal, checked) => {
    const dates = checked!.from === '2026-10-31' ? ['2026-11-06'] : ['2025-11-07', '2026-03-05', '2026-03-09', '2026-11-06'];
    return { providerId: 'yahoo_personal_daily', assetSymbol: 'ISWD', providerSymbol: 'IUSD.DE', listingCurrency: 'EUR', exchange: 'GER',
      retrievedAt: new Date(clock).toISOString(), latestObservationAt: '2026-11-06', cacheStatus: 'miss',
      bars: dates.map(date => ({ date, open: 58, high: 59, low: 57, close: 58.45, volume: null })),
      ...(checked!.from < '2026-03-06' ? { missingTradingDates: ['2026-03-06'] } : {}) };
  });
});
afterEach(async () => { await clearPersonalHistoryCache(owner); jest.restoreAllMocks(); });
afterAll(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });

test('a missing interior Yahoo session keeps history partial on repeated memory cache reads', async () => {
  const first = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', range);
  expect(first).toMatchObject({ coverageLimited: true, missingTradingDates: ['2026-03-06'] });
  const cached = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', range);
  expect(cached).toMatchObject({ coverageLimited: true, missingTradingDates: ['2026-03-06'], cacheStatus: 'hit_fresh' });
  expect(cached?.bars.some(bar => bar.date === '2026-03-06')).toBe(false);
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(1);
});

test('a valid recent overlap cannot erase a known missing older session', async () => {
  await loadPersonalDailyHistory('yahoo', owner, 'ISWD', range);
  clock += 7 * 3600000;
  const updated = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', range);
  expect(updated).toMatchObject({ coverageLimited: true, missingTradingDates: ['2026-03-06'] });
  expect(loadYahooPersonalDailySeries).toHaveBeenCalledTimes(2);
  const recent = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', { from: '2026-10-31', to: range.to });
  expect(recent).toMatchObject({ coverageLimited: false });
  expect(recent).not.toHaveProperty('missingTradingDates');
});

test('an explicit missing refresh candle cannot leave an earlier cached price for that date', async () => {
  const recentRange = { from: '2026-11-01', to: '2026-11-07' };
  jest.mocked(loadYahooPersonalDailySeries).mockResolvedValue({ providerId: 'yahoo_personal_daily', assetSymbol: 'ISWD',
    providerSymbol: 'IUSD.DE', listingCurrency: 'EUR', exchange: 'GER', retrievedAt: new Date(clock).toISOString(),
    latestObservationAt: '2026-11-06', cacheStatus: 'miss',
    bars: ['2026-11-01', '2026-11-05', '2026-11-06'].map(date => ({ date, open: 58, high: 59, low: 57, close: 58.45, volume: null })) });
  await loadPersonalDailyHistory('yahoo', owner, 'ISWD', recentRange);
  clock += 7 * 3600000;
  jest.mocked(loadYahooPersonalDailySeries).mockResolvedValue({ providerId: 'yahoo_personal_daily', assetSymbol: 'ISWD',
    providerSymbol: 'IUSD.DE', listingCurrency: 'EUR', exchange: 'GER', retrievedAt: new Date(clock).toISOString(),
    latestObservationAt: '2026-11-06', cacheStatus: 'miss', missingTradingDates: ['2026-11-05'],
    bars: [{ date: '2026-11-06', open: 58, high: 59, low: 57, close: 58.45, volume: null }] });
  const result = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', recentRange);
  expect(result).toMatchObject({ coverageLimited: true, missingTradingDates: ['2026-11-05'] });
  expect(result?.bars.some(bar => bar.date === '2026-11-05')).toBe(false);
});

test('only an authentic replacement candle can clear a previously explicit missing trading date', async () => {
  const recentRange = { from: '2026-11-01', to: '2026-11-07' };
  const base = { providerId: 'yahoo_personal_daily' as const, assetSymbol: 'ISWD', providerSymbol: 'IUSD.DE',
    listingCurrency: 'EUR' as const, exchange: 'GER', retrievedAt: new Date(clock).toISOString(),
    latestObservationAt: '2026-11-06', cacheStatus: 'miss' as const,
    bars: ['2026-11-01', '2026-11-06'].map(date => ({ date, open: 58, high: 59, low: 57, close: 58.45, volume: null })) };
  jest.mocked(loadYahooPersonalDailySeries).mockResolvedValue({ ...base, missingTradingDates: ['2026-11-05'] });
  await loadPersonalDailyHistory('yahoo', owner, 'ISWD', recentRange);
  clock += 7 * 3600000;
  jest.mocked(loadYahooPersonalDailySeries).mockResolvedValue({ ...base, bars: base.bars.slice(-1), retrievedAt: new Date(clock).toISOString() });
  const stillMissing = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', recentRange);
  expect(stillMissing).toMatchObject({ coverageLimited: true, missingTradingDates: ['2026-11-05'] });
  clock += 7 * 3600000;
  jest.mocked(loadYahooPersonalDailySeries).mockResolvedValue({ ...base, retrievedAt: new Date(clock).toISOString(),
    bars: ['2026-11-05', '2026-11-06'].map(date => ({ date, open: 58, high: 59, low: 57, close: 58.45, volume: null })) });
  const repaired = await loadPersonalDailyHistory('yahoo', owner, 'ISWD', recentRange);
  expect(repaired).toMatchObject({ coverageLimited: false });
  expect(repaired).not.toHaveProperty('missingTradingDates');
  expect(repaired?.bars.some(bar => bar.date === '2026-11-05')).toBe(true);
});
