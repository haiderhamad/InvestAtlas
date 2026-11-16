import { DELETE as deleteCoin, GET as getCoins, POST as addCoin } from '@/app/api/coins/route';
import {
  GET as getDataProviders,
  POST as updateDataProviders,
} from '@/app/api/data-providers/route';
import { POST as testDataProvider } from '@/app/api/data-providers/test/route';
import { GET as getHistory } from '@/app/api/prices/history/route';
import { POST as exportReport } from '@/app/api/reports/export/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedBuildConsolidatedHistory = jest.mocked(buildConsolidatedHistory);

describe('public configuration endpoints', () => {
  test('keeps the legacy public report generator closed', async () => {
    const response = await exportReport();

    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('exposes only the curated read-only provider catalogue', async () => {
    const response = await getDataProviders();
    const providers = await response.json() as Array<{
      id: string;
      baseUrl?: string;
      capabilities: string[];
      publicDisplayStatus: string;
      termsUrl: string;
    }>;

    expect(response.status).toBe(200);
    expect(providers.map((provider) => provider.id)).toEqual([
      'alpha_vantage_browser_byok',
      'tiingo_browser_byok',
      'ecb_reference_rates',
      'binance_public',
      'kraken_public',
      'coinbase_public',
      'yahoo_finance',
      'coingecko_public',
      'bitfinex_public',
      'sec_edgar',
      'tiingo_byok',
    ]);
    expect(providers.every((provider) => provider.baseUrl === undefined)).toBe(true);
    expect(providers.every((provider) => provider.capabilities.length > 0)).toBe(true);
    expect(
      providers.find((provider) => provider.id === 'ecb_reference_rates'),
    ).toEqual(expect.objectContaining({ publicDisplayStatus: 'allowed' }));
    expect(
      providers.find((provider) => provider.id === 'alpha_vantage_browser_byok'),
    ).toEqual(expect.objectContaining({
      publicDisplayStatus: 'review_required',
      termsUrl: 'https://www.alphavantage.co/terms_of_service/',
    }));
    expect(
      providers.find((provider) => provider.id === 'coinbase_public'),
    ).toEqual(expect.objectContaining({ publicDisplayStatus: 'permission_required' }));
  });

  test('rejects global provider mutations without parsing their payload', async () => {
    const response = await updateDataProviders();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('read-only') }),
    );
  });

  test('keeps the retired provider connection tester unable to make requests', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    try {
      const response = await testDataProvider();

      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('serves a defensive copy of the curated coin list', async () => {
    const firstResponse = await getCoins();
    const firstPayload = await firstResponse.json() as {
      coins: Array<{ symbol: string; name: string }>;
    };
    firstPayload.coins[0].name = 'mutated';

    const secondResponse = await getCoins();
    const secondPayload = await secondResponse.json() as {
      coins: Array<{ symbol: string; name: string }>;
    };

    expect(secondPayload.coins[0]).toEqual({ symbol: 'BTC', name: 'Bitcoin' });
  });

  test.each([
    ['POST', addCoin],
    ['DELETE', deleteCoin],
  ])('rejects global coin %s mutations', async (_method, handler) => {
    const response = await handler();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('read-only') }),
    );
  });
});

describe('historical price request validation', () => {
  beforeEach(() => {
    mockedBuildConsolidatedHistory.mockReset();
    mockedBuildConsolidatedHistory.mockResolvedValue({
      symbol: 'BTC',
      prices: [
        {
          date: '2026-07-25',
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1_000,
        },
      ],
      provenance: [],
      isComplete: false,
      warnings: [],
    });
  });

  test.each([
    'symbol=..%2F..%2F..%2Ftmp%2Finvestatlas-pwn',
    'symbol=UNKNOWN_ASSET',
    'symbol=BTC&currency=..%2F..%2Ftmp',
    'symbol=BTC&currency=gbp',
    'symbol=BTC&interval=..%2F..%2Ftmp',
    'symbol=BTC&interval=2d',
    'symbol=AAPL&interval=5m',
  ])('rejects an unsafe or unsupported query: %s', async (query) => {
    const response = await getHistory(
      new Request(`http://localhost/api/prices/history?${query}`),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockedBuildConsolidatedHistory).not.toHaveBeenCalled();
  });

  test('canonicalizes supported aliases before reaching provider URLs or cache keys', async () => {
    mockedBuildConsolidatedHistory.mockResolvedValueOnce({
      symbol: 'ISWD',
      prices: [],
      provenance: [],
      isComplete: false,
      warnings: [],
    });

    const response = await getHistory(
      new Request(
        'http://localhost/api/prices/history?symbol=iusd.de&currency=USD&interval=1D',
      ),
    );
    const payload = await response.json() as { symbol: string };

    expect(response.status).toBe(200);
    expect(payload.symbol).toBe('ISWD');
    expect(mockedBuildConsolidatedHistory).toHaveBeenCalledWith(
      'ISWD',
      'usd',
      '1d',
      false,
      expect.any(AbortSignal),
    );
  });
});
