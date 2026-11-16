const mockLoadSeries = jest.fn();
const mockSupportsAsset = jest.fn((symbol: string) => ['AAPL', 'MSFT'].includes(symbol));

jest.mock('@/lib/financial-data/providers/alpha-vantage-browser', () => ({
  AlphaVantageBrowserError: class AlphaVantageBrowserError extends Error {},
  loadAlphaVantageDailySeries: (...args: unknown[]) => mockLoadSeries(...args),
  supportsAlphaVantageBrowserAsset: (symbol: string) => mockSupportsAsset(symbol),
}));

import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/personal-browser-market-data';

const SERIES = {
  providerId: 'alpha_vantage_browser_byok' as const,
  assetSymbol: 'AAPL',
  providerSymbol: 'AAPL',
  listingCurrency: 'USD' as const,
  retrievedAt: '2026-08-29T12:00:00.000Z',
  latestObservationAt: '2026-08-28',
  cacheStatus: 'miss' as const,
  bars: [
    { date: '2026-08-27', open: 198, high: 202, low: 197, close: 200, volume: 120000 },
    { date: '2026-08-28', open: 201, high: 205, low: 199, close: 204, volume: 123456 },
  ],
};

describe('personal browser market-data response adapter', () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: new URL('https://investatlas.example/settings') },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadSeries.mockResolvedValue(SERIES);
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('returns a truthful EOD current-price contract without inventing daily change', async () => {
    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/current?symbols=AAPL&currency=usd',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload).toMatchObject({
      status: 'partial',
      currency: 'usd',
      dataMode: 'personal_provider',
      refreshPolicy: 'manual_only',
      priceTiming: 'end_of_day',
      realtime: false,
      synthetic: false,
      prices: {
        AAPL: {
          price: 204,
          change24h: null,
          changePeriod: 'unavailable',
          dataStatus: 'partial',
          source: 'Alpha Vantage (personal EOD)',
        },
      },
    });
    expect(payload.prices.AAPL.fields.changePercent).toMatchObject({
      status: 'unavailable',
      reason: 'not_provided',
    });
    expect(mockLoadSeries).toHaveBeenCalledWith('firebase-user', 'AAPL', undefined);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails EUR valuation closed when sourced ECB FX is unavailable', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response('{}', { status: 503 }));

    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/current?symbols=AAPL&currency=eur',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload).toMatchObject({
      status: 'unavailable',
      prices: {},
      issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }],
    });
    expect(mockLoadSeries).not.toHaveBeenCalled();
  });

  it('returns partial raw/unadjusted compact history with explicit limitations', async () => {
    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&currency=usd&interval=1d',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload).toMatchObject({
      contractVersion: 'history.v2',
      status: 'partial',
      symbol: 'AAPL',
      currency: 'usd',
      isComplete: false,
      dataMode: 'personal_provider',
      priceTiming: 'end_of_day',
      adjustment: 'raw_unadjusted',
      realtime: false,
      synthetic: false,
      cache: { status: 'miss' },
    });
    expect(payload.prices).toHaveLength(2);
    expect(payload.warnings.join(' ')).toContain('raw, unadjusted daily EOD history');
    expect(payload.warnings.join(' ')).toContain('at most the latest 100');
  });

  it('uses stale normalized cache only for history and labels it stale', async () => {
    mockLoadSeries.mockResolvedValue({ ...SERIES, cacheStatus: 'hit_stale' });

    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&currency=usd&interval=1d',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload).toMatchObject({
      status: 'partial',
      freshness: 'stale',
      dataMode: 'cached_personal',
      cache: { status: 'hit_stale' },
    });
    expect(payload.warnings.join(' ')).toContain('bounded cached personal response');
  });

  it('does not forward-fill an ECB rate through a long historical data gap', async () => {
    mockLoadSeries.mockResolvedValue({
      ...SERIES,
      bars: [
        { ...SERIES.bars[0], date: '2026-08-18' },
        { ...SERIES.bars[1], date: '2026-08-28' },
      ],
    });
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      data: [{ date: '2026-08-18', asOf: '2026-08-18', rate: 0.9 }],
    }), { status: 200 }));

    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&currency=eur&interval=1d',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload.status).toBe('partial');
    expect(payload.prices).toHaveLength(1);
    expect(payload.prices[0]).toMatchObject({ date: '2026-08-18', close: 180 });
    expect(payload.warnings.join(' ')).toContain('Historical ECB reference FX coverage is incomplete');
  });

  it('accepts a recent preceding ECB rate for a bounded holiday/weekend gap', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      data: [{ date: '2026-08-26', asOf: '2026-08-26', rate: 0.9 }],
    }), { status: 200 }));

    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&currency=eur&interval=1d',
      {},
      'firebase-user',
    );
    const payload = await response?.json();

    expect(payload.status).toBe('partial');
    expect(payload.prices).toHaveLength(2);
    expect(payload.prices[1]).toMatchObject({
      date: '2026-08-28',
      close: 183.6,
      conversion: { rate: 0.9, asOf: '2026-08-26' },
    });
  });

  it('rejects mismatched or malformed ECB observation dates instead of deriving history', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      data: [{ date: '2026-08-26', asOf: '2026-08-24', rate: 0.9 }],
    }), { status: 200 }));

    const response = await handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&currency=eur&interval=1d',
      {},
      'firebase-user',
    );
    const payload = await response?.json();
    expect(payload).toMatchObject({ status: 'unavailable', prices: [] });
  });

  it('does not intercept cross-origin, mutation, or metadata requests', async () => {
    await expect(handlePersonalBrowserMarketRequest(
      new URL('https://attacker.example/api/prices/current?symbols=AAPL'),
      {},
      'firebase-user',
    )).resolves.toBeNull();
    await expect(handlePersonalBrowserMarketRequest(
      '/api/prices/current?symbols=AAPL',
      { method: 'POST' },
      'firebase-user',
    )).resolves.toBeNull();
    await expect(handlePersonalBrowserMarketRequest(
      '/api/prices/history?symbol=AAPL&metadata=true',
      {},
      'firebase-user',
    )).resolves.toBeNull();
  });
});
