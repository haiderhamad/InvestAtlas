import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn() }));
const identity = jest.mocked(getFirebaseApiIdentity);
import {
  clearTiingoBrowserCredential,
  setTiingoBrowserCredential,
} from '@/lib/financial-data/providers/tiingo-browser';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  type CurrentValuationPrices,
} from '@/lib/portfolio/current-valuation';
import type { DerivedHolding } from '@/lib/transactions/holdings-engine';

/**
 * Fixture-level integration: use the REAL browser provider parser, market
 * adapter, sourced ECB conversion, and portfolio valuation. Only HTTP and
 * browser storage are simulated. This is NOT a live-provider or Safari test.
 */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, String(value)); }
}

function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dailyFixture(): Record<string, unknown>[] {
  return [{
    date: dayOffset(-3) + 'T00:00:00.000Z',
    open: 196, high: 201, low: 195, close: 200, volume: 110000,
  }, {
    date: dayOffset(-2) + 'T00:00:00.000Z',
    open: 201, high: 205, low: 199, close: 204, volume: 123456,
  }];
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sourcedFx(rate: number, freshness: string = 'fresh'): Response {
  return response({
    data: {
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      rate: {
        status: 'available',
        value: rate,
        freshness,
        observedAt: dayOffset(-2),
        asOf: dayOffset(-2),
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: new Date().toISOString(),
        },
      },
    },
  });
}

const holding: DerivedHolding = {
  symbol: 'AAPL',
  name: 'Apple',
  assetClass: 'stock',
  amount: 2,
  avgCost: 100,
  costBasisAvailable: true,
  venue: 'fixture-broker',
};

describe('v1.2.4 Tiingo BYOK fixture provider → EUR ECB FX → portfolio valuation', () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;
  let store: MemoryStorage;
  let providerCalls: number;
  let ecbCalls: number;
  let fxResponse: () => Response;

  beforeAll(() => {
    store = new MemoryStorage();
    const fakeWindow = new EventTarget();
    Object.assign(fakeWindow, {
      localStorage: store,
      location: new URL('https://investatlas.example/portfolio'),
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });
  });

  beforeEach(() => {
    clearTiingoBrowserCredential();
    identity.mockReset();
    store.clear();
    providerCalls = 0;
    ecbCalls = 0;
    fxResponse = () => sourcedFx(0.9);
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input), 'https://investatlas.example');
      if (url.pathname === '/api/financial-data/tiingo/local-series') {
        providerCalls += 1;
        expect(url.origin).toBe('https://investatlas.example');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-firebase-id-token');
        expect(JSON.parse(String(init?.body))).toEqual({ apiKey: 'SYNTHETIC_TEST_ONLY', symbol: 'AAPL' });
        return response({ symbol: 'AAPL', data: dailyFixture() });
      }
      if (url.pathname === '/api/financial-data/fx') {
        ecbCalls += 1;
        expect(url.searchParams.get('from')).toBe('USD');
        expect(url.searchParams.get('to')).toBe('EUR');
        return fxResponse();
      }
      throw new Error('Unexpected host or route in fixture integration test');
    });
  });

  afterAll(() => {
    clearTiingoBrowserCredential();
    global.fetch = originalFetch;
    identity.mockReset();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  async function current(userId: string, currency: 'usd' | 'eur' = 'eur') {
    identity.mockResolvedValue({ userId, token: 'synthetic-firebase-id-token' });
    const result = await handlePersonalBrowserMarketRequest(
      `/api/prices/current?symbols=AAPL&currency=${currency}`,
      {},
      userId,
    );
    expect(result).not.toBeNull();
    return result!.json() as Promise<{
      status: string;
      prices: CurrentValuationPrices & Record<string, { dataMode?: string }>;
      issues?: Array<{ symbol: string; code: string }>;
    }>;
  }

  it('carries a fixed-host EOD close and sourced ECB conversion through exact position/P&L maths', async () => {
    setTiingoBrowserCredential('fixture-user-a', 'SYNTHETIC_TEST_ONLY');
    const data = await current('fixture-user-a');
    expect(data.status).toBe('partial');
    expect(providerCalls).toBe(1);
    expect(ecbCalls).toBe(1);

    const quote = data.prices.AAPL;
    expect(quote).toMatchObject({
      price: 183.6,
      currency: 'eur',
      change24h: null,
      changePeriod: 'unavailable',
      source: 'Tiingo (personal EOD)',
      dataMode: 'personal_provider',
      priceTiming: 'end_of_day',
      realtime: false,
    });
    expect(quote.fields?.price).toMatchObject({
      status: 'available',
      quality: 'calculated',
      value: { amount: 183.6, currency: 'EUR' },
      provenance: {
        providerId: 'investatlas_calculation',
        derivedFrom: [
          { providerId: 'tiingo_browser_byok' },
          { providerId: 'ecb_reference_rates' },
        ],
      },
    });

    const [position] = buildCurrentHoldingValuations([holding], data.prices);
    expect(isCurrentValuationComplete([position])).toBe(true);
    expect(position.valuationAvailable).toBe(true);
    expect(position.currentPrice).toBeCloseTo(183.6);
    expect(position.value).toBeCloseTo(367.2);
    expect(position.pnl).toBeCloseTo(167.2);
    expect(position.pnlPct).toBeCloseTo(83.6);
    expect(position.change24h).toBeNull();
    expect(position.changePeriod).toBe('unavailable');
    expect(position.isVerified).toBe(false);
  });

  it('keeps provider series and credentials out of persistent browser storage', async () => {
    setTiingoBrowserCredential('fixture-user-cache', 'SYNTHETIC_TEST_ONLY');
    await current('fixture-user-cache');
    await current('fixture-user-cache');
    expect(providerCalls).toBe(2);
    expect(ecbCalls).toBe(2);
    expect(store.length).toBe(0);
  });

  it('never supplies another UID with cached market values after key removal', async () => {
    setTiingoBrowserCredential('fixture-user-a', 'SYNTHETIC_TEST_ONLY');
    await current('fixture-user-a', 'usd');
    clearTiingoBrowserCredential();
    const other = await current('fixture-user-b', 'usd');
    expect(other).toMatchObject({ status: 'unavailable', prices: {} });
    const [position] = buildCurrentHoldingValuations([holding], other.prices);
    expect(position.valuationAvailable).toBe(false);
    expect(position.pnl).toBe(0);
    expect(providerCalls).toBe(1);
  });

  it('rejects unknown FX freshness instead of turning it into a personal EUR valuation', async () => {
    fxResponse = () => sourcedFx(0.9, 'unknown');
    setTiingoBrowserCredential('fixture-user-unknown-fx', 'SYNTHETIC_TEST_ONLY');
    const data = await current('fixture-user-unknown-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('rejects FX data whose currency pair is reversed', async () => {
    fxResponse = () => response({ data: {
      baseCurrency: 'EUR', quoteCurrency: 'USD',
      rate: { status: 'available', value: 0.9, freshness: 'fresh', asOf: dayOffset(-2), provenance: { providerId: 'ecb_reference_rates' } },
    } });
    setTiingoBrowserCredential('fixture-user-reversed-fx', 'SYNTHETIC_TEST_ONLY');
    const data = await current('fixture-user-reversed-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('rejects FX responses without verified ECB provenance', async () => {
    fxResponse = () => response({ data: {
      baseCurrency: 'USD', quoteCurrency: 'EUR',
      rate: { status: 'available', value: 0.9, freshness: 'fresh', asOf: dayOffset(-2), provenance: { providerId: 'untrusted_source' } },
    } });
    setTiingoBrowserCredential('fixture-user-unsourced-fx', 'SYNTHETIC_TEST_ONLY');
    const data = await current('fixture-user-unsourced-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('fails closed before requesting a personal market quote when ECB FX is stale', async () => {
    fxResponse = () => sourcedFx(0.9, 'stale');
    setTiingoBrowserCredential('fixture-user-fx', 'SYNTHETIC_TEST_ONLY');
    const data = await current('fixture-user-fx');
    expect(data).toMatchObject({
      status: 'unavailable',
      prices: {},
      issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }],
    });
    const [position] = buildCurrentHoldingValuations([holding], data.prices);
    expect(position.valuationAvailable).toBe(false);
    expect(position.pnl).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ecbCalls).toBe(1);
  });
});

