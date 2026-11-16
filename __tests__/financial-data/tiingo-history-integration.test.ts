import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn() }));
const identity = jest.mocked(getFirebaseApiIdentity);
import {
  clearTiingoBrowserCredential,
  setTiingoBrowserCredential,
} from '@/lib/financial-data/providers/tiingo-browser';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const observations = () => [{
  date: day(3) + 'T00:00:00.000Z',
  open: 100, high: 104, low: 99, close: 103, volume: 1000,
}, {
  date: day(2) + 'T00:00:00.000Z',
  open: 103, high: 108, low: 101, close: 107, volume: 1200,
}];

describe('Tiingo BYOK raw EOD history and ECB conversion', () => {
  const oldFetch = global.fetch;
  const oldWindow = globalThis.window;
  let providerRequests: number;
  let fxRows: Array<{ date: string; asOf: string; rate: number }>;
  beforeAll(() => {
    const mockWindow = new EventTarget();
    Object.assign(mockWindow, { location: new URL('https://investatlas.example/charts') });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });
  });
  beforeEach(() => {
    clearTiingoBrowserCredential();
    identity.mockReset().mockResolvedValue({ userId: 'user-a', token: 'synthetic-firebase-id-token' });
    providerRequests = 0;
    fxRows = [3, 2].map((offset) => ({ date: day(offset), asOf: day(offset), rate: 0.9 }));
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(String(url), 'https://investatlas.example');
      if (target.pathname === '/api/financial-data/tiingo/local-series') {
        providerRequests++;
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-firebase-id-token');
        expect(JSON.parse(String(init?.body))).toEqual({ apiKey: 'SYNTHETIC_TEST_ONLY', symbol: 'AAPL' });
        return new Response(JSON.stringify({ symbol: 'AAPL', data: observations() }), { status: 200 });
      }
      if (target.pathname === '/api/financial-data/fx/history') {
        return new Response(JSON.stringify({ data: fxRows }), { status: 200 });
      }
      throw Error('Unexpected Tiingo EOD or ECB route');
    });
  });
  afterAll(() => {
    clearTiingoBrowserCredential();
    global.fetch = oldFetch;
    identity.mockReset();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  });
  const history = async (symbol = 'AAPL', currency = 'usd') => {
    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=' + symbol + '&interval=1d&currency=' + currency, {}, 'user-a',
    );
    expect(response).not.toBeNull();
    return response!.json() as Promise<{
      status: string; symbol: string; source?: string; prices: Array<{
        date: string; close: number; dataQuality: string; priceQuality: string;
        conversion?: { sourceCurrency: string; rate: number; sourceRef: string };
      }>; sources: Array<{ providerId: string }>; adjustment?: string;
      latestObservationAt?: string; priceTiming?: string; realtime?: boolean;
    }>;
  };

  it('returns only raw Tiingo EOD observations, not adjusted or realtime prices', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    const result = await history('AAPL', 'usd');
    expect(result.status).toBe('partial');
    expect(result.symbol).toBe('AAPL');
    expect(result.prices).toHaveLength(2);
    expect(result.prices.at(-1)).toMatchObject({ close: 107, dataQuality: 'ohlc', priceQuality: 'observed' });
    expect(result.sources).toContainEqual(expect.objectContaining({ providerId: 'tiingo_browser_byok' }));
    expect(result).toMatchObject({ adjustment: 'raw_unadjusted', priceTiming: 'end_of_day', realtime: false });
    expect(providerRequests).toBe(1);
  });

  it('converts each date from sourced historical ECB FX, not a single current rate', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    const result = await history('AAPL', 'eur');
    expect(result.prices).toHaveLength(2);
    expect(result.prices.at(-1)?.close).toBeCloseTo(96.3);
    expect(result.prices.at(-1)?.conversion).toMatchObject({
      sourceCurrency: 'USD', rate: 0.9, sourceRef: 'fx_1',
    });
    expect(result.sources).toContainEqual(expect.objectContaining({ providerId: 'ecb_reference_rates' }));
  });

  it('never fabricates EUR value from missing historical ECB observations', async () => {
    fxRows = [];
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    const result = await history('AAPL', 'eur');
    expect(result).toMatchObject({ status: 'unavailable', prices: [] });
  });

  it('does not substitute US quotes for unsupported European symbols', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    const result = await history('IVSI', 'usd');
    expect(result).toMatchObject({ status: 'unavailable', prices: [] });
    expect(providerRequests).toBe(0);
  });

  it('does not expose personal history without that user’s key', async () => {
    setTiingoBrowserCredential('other-user', 'SYNTHETIC_TEST_ONLY');
    const result = await history();
    expect(result).toMatchObject({ status: 'unavailable', prices: [] });
    expect(providerRequests).toBe(0);
  });
});
