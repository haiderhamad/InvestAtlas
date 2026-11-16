import {
  clearMarketData, connectMarketData, hasMarketData, loadMarketData,
  parseMarketDataDaily, reconcileMarketData, supportsMarketDataAsset,
} from '@/lib/financial-data/providers/marketdata-personal';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  hasTiingoBrowserCredential: jest.fn(() => false),
  loadTiingoBrowserDailySeries: jest.fn(),
  supportsTiingoBrowserAsset: () => false,
}));

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const candleTime = Math.floor((today.getTime() - 3 * 86_400_000) / 1000);
const response = {
  s: 'ok', t: [candleTime], o: [150.12], h: [158.9],
  l: [148.01], c: [157.55], v: [1234567],
};
const oldWindow = globalThis.window;
const oldFetch = global.fetch;
let owner = '';

beforeAll(() => {
  const view = new EventTarget();
  const storage = new Map<string, string>();
  Object.assign(view, {
    location: new URL('https://private.example'),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
});
beforeEach(() => {
  owner = 'marketdata-owner-' + Math.random().toString(16).slice(2);
  resolveBrowserWorkspace(owner);
  clearMarketData();
  global.fetch = jest.fn(async () => Response.json(response));
});
afterAll(() => {
  clearMarketData();
  global.fetch = oldFetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
});

describe('documented personal Market Data stock adapter', () => {
  test('supports exact USD US stock and ETF identifiers only', () => {
    expect(supportsMarketDataAsset('AAPL')).toBe(true);
    expect(supportsMarketDataAsset('HLAL')).toBe(true);
    expect(supportsMarketDataAsset('SPUS')).toBe(true);
    expect(supportsMarketDataAsset('ISWD')).toBe(false);
    expect(supportsMarketDataAsset('SAP')).toBe(false);
    expect(supportsMarketDataAsset('BTC')).toBe(false);
  });
  test('validates raw EOD candles, with exact UTC dates and no unobserved values', () => {
    expect(parseMarketDataDaily(response, 'AAPL')).toMatchObject({
      providerId: 'marketdata_personal_daily', listingCurrency: 'USD',
      bars: [{ open: 150.12, high: 158.9, low: 148.01, close: 157.55, volume: 1234567 }],
    });
    expect(() => parseMarketDataDaily({ ...response, h: [140] }, 'AAPL')).toThrow();
    expect(() => parseMarketDataDaily({ ...response, s: 'no_data' }, 'AAPL')).toThrow();
    expect(() => parseMarketDataDaily({ ...response, c: [-1] }, 'AAPL')).toThrow();
    expect(() => parseMarketDataDaily({ ...response, t: [candleTime, candleTime], o: [1, 2] }, 'AAPL')).toThrow();
    expect(() => parseMarketDataDaily(response, 'ISWD')).toThrow();
  });
  test('connects directly via a fixed HTTPS origin and uses only an Authorization header', async () => {
    await connectMarketData(owner, 'test-marketdata-personal-secret-token');
    expect(hasMarketData(owner)).toBe(true);
    const [url, opts] = jest.mocked(global.fetch).mock.calls[0];
    expect(new URL(String(url)).origin).toBe('https://api.marketdata.app');
    expect(new URL(String(url)).pathname).toBe('/v1/stocks/candles/D/AAPL/');
    expect(String(url)).not.toContain('test-marketdata');
    expect(new Headers(opts?.headers).get('authorization')).toBe('Bearer test-marketdata-personal-secret-token');
    expect(opts?.credentials).toBe('omit');
    const bars = await loadMarketData(owner, 'AAPL');
    expect(bars.bars).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1); // Connect test and first portfolio query share EOD cache.
    global.fetch = jest.fn(async () => Response.json({ s: 'ok', symbol: ['AAPL'], mid: [158.125], updated: [Math.floor((Date.now() - 30_000) / 1000)] }));
    saveSourceSelection(owner, { ...readSourceSelection(owner), preferred: 'marketdata' });
    const result = await handlePersonalBrowserMarketRequest(
      '/api/prices/current?symbols=AAPL&currency=usd', {}, owner,
    );
    const json = await result!.json();
    expect(json.prices.AAPL).toMatchObject({
      price: 158.125, source: 'Market Data API (indicative SmartMid)',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  test('never reuses a private credential after switching users or disconnecting', async () => {
    await connectMarketData(owner, 'test-marketdata-personal-secret-token');
    const other = owner + '-other';
    resolveBrowserWorkspace(other);
    reconcileMarketData(other);
    expect(hasMarketData(owner)).toBe(false);
    expect(hasMarketData(other)).toBe(false);
    await expect(loadMarketData(other, 'AAPL')).rejects.toThrow();
    clearMarketData();
    expect(hasMarketData(other)).toBe(false);
  });
});
