import {
  clearAlphaVantageSessionCredential,
  setAlphaVantageSessionCredential,
} from '@/lib/financial-data/providers/alpha-vantage-browser';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/personal-browser-market-data';
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

function dailyFixture(): Record<string, unknown> {
  return {
    'Meta Data': { '2. Symbol': 'AAPL' },
    'Time Series (Daily)': {
      [dayOffset(-3)]: {
        '1. open': '196', '2. high': '201', '3. low': '195',
        '4. close': '200', '5. volume': '110000',
      },
      [dayOffset(-2)]: {
        '1. open': '201', '2. high': '205', '3. low': '199',
        '4. close': '204', '5. volume': '123456',
      },
    },
  };
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

describe('v1.2.4 fixture provider → EUR FX → portfolio valuation', () => {
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
    clearAlphaVantageSessionCredential();
    store.clear();
    providerCalls = 0;
    ecbCalls = 0;
    fxResponse = () => sourcedFx(0.9);
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input), 'https://investatlas.example');
      if (url.origin === 'https://www.alphavantage.co' && url.pathname === '/query') {
        providerCalls += 1;
        expect(url.searchParams.get('function')).toBe('TIME_SERIES_DAILY');
        expect(url.searchParams.get('symbol')).toBe('AAPL');
        return response(dailyFixture());
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
    clearAlphaVantageSessionCredential();
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  async function current(userId: string, currency: 'usd' | 'eur' = 'eur') {
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
    setAlphaVantageSessionCredential('fixture-user-a', 'synthetic-fixture-key');
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
      source: 'Alpha Vantage (personal EOD)',
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
          { providerId: 'alpha_vantage_browser_byok' },
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

  it('reuses the normalized per-user market cache without repeating the provider request', async () => {
    setAlphaVantageSessionCredential('fixture-user-cache', 'synthetic-fixture-key');
    await current('fixture-user-cache');
    const second = await current('fixture-user-cache');
    expect(providerCalls).toBe(1);
    expect(ecbCalls).toBe(2);
    expect(second.prices.AAPL.dataMode).toBe('cached_personal');
    expect(JSON.stringify([...Array(store.length)].map((_, i) =>
      [store.key(i), store.getItem(store.key(i)!)]))).not.toContain('synthetic-fixture-key');
  });

  it('never supplies another UID with cached market values after key removal', async () => {
    setAlphaVantageSessionCredential('fixture-user-a', 'synthetic-fixture-key');
    await current('fixture-user-a', 'usd');
    clearAlphaVantageSessionCredential();
    const other = await current('fixture-user-b', 'usd');
    expect(other).toMatchObject({ status: 'unavailable', prices: {} });
    const [position] = buildCurrentHoldingValuations([holding], other.prices);
    expect(position.valuationAvailable).toBe(false);
    expect(position.pnl).toBe(0);
    expect(providerCalls).toBe(1);
  });

  it('rejects unknown FX freshness instead of turning it into a personal EUR valuation', async () => {
    fxResponse = () => sourcedFx(0.9, 'unknown');
    setAlphaVantageSessionCredential('fixture-user-unknown-fx', 'synthetic-fixture-key');
    const data = await current('fixture-user-unknown-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('rejects FX data whose currency pair is reversed', async () => {
    fxResponse = () => response({ data: {
      baseCurrency: 'EUR', quoteCurrency: 'USD',
      rate: { status: 'available', value: 0.9, freshness: 'fresh', asOf: dayOffset(-2), provenance: { providerId: 'ecb_reference_rates' } },
    } });
    setAlphaVantageSessionCredential('fixture-user-reversed-fx', 'synthetic-fixture-key');
    const data = await current('fixture-user-reversed-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('rejects FX responses without verified ECB provenance', async () => {
    fxResponse = () => response({ data: {
      baseCurrency: 'USD', quoteCurrency: 'EUR',
      rate: { status: 'available', value: 0.9, freshness: 'fresh', asOf: dayOffset(-2), provenance: { providerId: 'untrusted_source' } },
    } });
    setAlphaVantageSessionCredential('fixture-user-unsourced-fx', 'synthetic-fixture-key');
    const data = await current('fixture-user-unsourced-fx');
    expect(data).toMatchObject({ status: 'unavailable', prices: {}, issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }] });
    expect(providerCalls).toBe(0);
  });

  it('fails closed before requesting a personal market quote when ECB FX is stale', async () => {
    fxResponse = () => sourcedFx(0.9, 'stale');
    setAlphaVantageSessionCredential('fixture-user-fx', 'synthetic-fixture-key');
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
