import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import {
  clearTiingoBrowserCredential, hasTiingoBrowserCredential, loadTiingoBrowserDailySeries,
  reconcileTiingoBrowserCredentialOwner, setTiingoBrowserCredential,
  testTiingoBrowserCredential,
} from '@/lib/financial-data/providers/tiingo-browser';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { clearPublicGoldSpotCache } from '@/lib/financial-data/providers/public-gold-spot';

jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn() }));
const identity = jest.mocked(getFirebaseApiIdentity);
const originalFetch = global.fetch;
const originalWindow = globalThis.window;
const originalEnv = process.env;

function dailyRow(offset: number, price: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return {
    date: date.toISOString().slice(0, 10) + 'T00:00:00.000Z',
    open: price - 1, high: price + 2, low: price - 2, close: price, volume: 2500,
  };
}
const dailyData = () => [dailyRow(2, 200), dailyRow(1, 204)];

describe('local Next.js Tiingo server → Portfolio / Charts', () => {
  beforeAll(() => {
    process.env = { ...originalEnv, NODE_ENV: 'development' };
    const win = new EventTarget();
    Object.assign(win, { location: new URL('http://127.0.0.1:3001/portfolio') });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  });
  beforeEach(() => {
    clearPublicGoldSpotCache();
    clearTiingoBrowserCredential();
    identity.mockReset().mockResolvedValue({ userId: 'owner-a', token: 'synthetic-firebase-id-token' });
    global.fetch = jest.fn(async (url, options) => {
      expect(url).toBe('/api/financial-data/tiingo/local-series');
      const request = options as RequestInit;
      const body = JSON.parse(String(request.body));
      expect(body).toEqual({ apiKey: 'SYNTHETIC_PERSONAL_KEY', symbol: 'AAPL' });
      expect(request.method).toBe('POST');
      expect(new Headers(request.headers).get('Authorization')).toBe('Bearer synthetic-firebase-id-token');
      expect(request.credentials).toBe('same-origin');
      expect(request.cache).toBe('no-store');
      expect(String(url)).not.toContain('SYNTHETIC_PERSONAL_KEY');
      return new Response(JSON.stringify({ symbol: 'AAPL', data: dailyData() }), { status: 200 });
    });
  });
  afterAll(() => {
    clearTiingoBrowserCredential();
    identity.mockReset();
    global.fetch = originalFetch;
    process.env = originalEnv;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('verifies token over local server and retains it only when explicitly connected', async () => {
    await expect(testTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY')).resolves.toBe('connected');
    expect(hasTiingoBrowserCredential('owner-a')).toBe(false);
    setTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY');
    const series = await loadTiingoBrowserDailySeries('owner-a', 'AAPL');
    expect(series).toMatchObject({ providerId: 'tiingo_browser_byok', cacheStatus: 'miss', listingCurrency: 'USD' });
    expect(series.bars.at(-1)?.close).toBe(204);
  });

  it('feeds validated personal EOD into USD current holdings and charts history', async () => {
    setTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY');
    const current = await handlePersonalBrowserMarketRequest('/api/prices/current?symbols=AAPL&currency=usd', {}, 'owner-a');
    const prices = await current!.json();
    expect(prices.prices.AAPL.price).toBe(204);
    expect(prices.prices.AAPL.source).toBe('Tiingo (personal EOD)');
    const history = await handlePersonalBrowserMarketRequest('/api/prices/history?symbol=AAPL&currency=usd&interval=1d', {}, 'owner-a');
    const data = await history!.json();
    expect(data.prices.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain('SYNTHETIC_PERSONAL_KEY');
  });

  it('delivers validated completed BTC daily bars and fractional base-currency volume to portfolio and charts', async () => {
    setTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY');
    global.fetch = jest.fn(async (url, options) => {
      expect(url).toBe('/api/financial-data/tiingo/local-series');
      expect(JSON.parse(String((options as RequestInit).body))).toEqual({
        apiKey: 'SYNTHETIC_PERSONAL_KEY', symbol: 'BTC',
      });
      return new Response(JSON.stringify({
        symbol: 'BTC', data: dailyData().map((row) => ({
          ...row, volume: 2.125,
        })),
      }), { status: 200 });
    });
    const current = await handlePersonalBrowserMarketRequest('/api/prices/current?symbols=BTC&currency=usd', {}, 'owner-a');
    const snapshot = await current!.json();
    expect(snapshot.prices.BTC.price).toBe(204);
    expect(snapshot.prices.BTC.volume24h).toBe(2.125);
    expect(snapshot.prices.BTC.realtime).toBe(false);
    const history = await handlePersonalBrowserMarketRequest('/api/prices/history?symbol=BTC&currency=usd&interval=1d', {}, 'owner-a');
    const prices = await history!.json();
    expect(prices.prices).toHaveLength(2);
    expect(prices.priceTiming).toBe('end_of_day');
  });

  it('gets physical GOLD as a free public pure-gold USD/oz quote and still refuses ISWD without a source', async () => {
    const observedAt = new Date(Date.now() - 40_000).toISOString();
    global.fetch = jest.fn(async (url, options) => {
      expect(url).toBe('https://api.gold-api.com/price/XAU');
      const init = options as RequestInit;
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('omit');
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return new Response(JSON.stringify({
        symbol: 'XAU', currency: 'USD', price: 4150.75, updatedAt: observedAt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const response = await handlePersonalBrowserMarketRequest('/api/prices/current?symbols=GOLD,ISWD&currency=usd', {}, 'owner-a');
    const data = await response!.json();
    expect(data.status).toBe('partial');
    expect(data.prices.GOLD.price).toBe(4150.75);
    expect(data.prices.GOLD.source).toBe('Gold API (indicative XAU spot)');
    expect(data.prices.GOLD.dataMode).toBe('public_market_api');
    expect(data.prices.GOLD.fields.price.provenance.providerId).toBe('gold_api_public_spot');
    expect(data.prices.GOLD.fields.price.value.currency).toBe('USD');
    expect(data.prices.GOLD.realtime).toBe(false);
    expect(data.prices.ISWD).toBeUndefined();
    expect(data.issues).toContainEqual({ symbol: 'ISWD', code: 'provider_unavailable' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('converts physical gold ounce price into EUR using sourced ECB rate, never an invented FX', async () => {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const asOf = day.toISOString().slice(0, 10);
    global.fetch = jest.fn(async (url) => {
      if (String(url).startsWith('/api/financial-data/fx?')) {
        return new Response(JSON.stringify({
          data: {
            baseCurrency: 'USD', quoteCurrency: 'EUR',
            rate: {
              status: 'available', freshness: 'fresh', value: 0.84,
              asOf, observedAt: asOf,
              provenance: { providerId: 'ecb_reference_rates', providerName: 'ECB', retrievedAt: now.toISOString() },
            },
          },
        }), { status: 200 });
      }
      expect(url).toBe('https://api.gold-api.com/price/XAU');
      return new Response(JSON.stringify({
        symbol: 'XAU', currency: 'USD', price: 4100,
        updatedAt: new Date(Date.now() - 70_000).toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const response = await handlePersonalBrowserMarketRequest('/api/prices/current?symbols=GOLD&currency=eur', {}, 'owner-a');
    const data = await response!.json();
    expect(data.prices.GOLD.price).toBeCloseTo(4100 * 0.84);
    expect(data.prices.GOLD.currency).toBe('eur');
    expect(data.prices.GOLD.fields.price.provenance.derivedFrom.map((x: { providerId: string }) => x.providerId))
      .toEqual(['gold_api_public_spot', 'ecb_reference_rates']);
    expect(data.prices.GOLD.fields.price.value.currency).toBe('EUR');
    expect(data.prices.GOLD.change24h).toBeNull();
    expect(data.prices.GOLD.priceTiming).toBe('delayed');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not classify a missing Tiingo session as an FX failure', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 503 }));
    const response = await handlePersonalBrowserMarketRequest('/api/prices/current?symbols=AAPL&currency=eur', {}, 'owner-a');
    expect(await response?.json()).toMatchObject({
      status: 'unavailable', issues: [{ symbol: 'AAPL', code: 'provider_unavailable' }],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when Firebase user changes, without sending another user token', async () => {
    setTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY');
    identity.mockResolvedValueOnce({ userId: 'owner-b', token: 'different-firebase-id-token' });
    await expect(loadTiingoBrowserDailySeries('owner-a', 'AAPL'))
      .rejects.toMatchObject({ status: 'provider_unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
    reconcileTiingoBrowserCredentialOwner('owner-b');
    expect(hasTiingoBrowserCredential('owner-a')).toBe(false);
  });

  it('rejects malformed local server rows rather than displaying invented prices', async () => {
    setTiingoBrowserCredential('owner-a', 'SYNTHETIC_PERSONAL_KEY');
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      symbol: 'AAPL', data: [{ ...dailyRow(2, 200), close: null }, dailyRow(1, 204)],
    }), { status: 200 }));
    await expect(loadTiingoBrowserDailySeries('owner-a', 'AAPL'))
      .rejects.toMatchObject({ status: 'unexpected_response' });
  });
});
