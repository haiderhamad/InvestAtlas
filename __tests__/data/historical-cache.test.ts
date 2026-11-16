import { fetchProvider } from '@/lib/data/provider-fetch';
import { getHistoricalProviders } from '@/lib/data/historical-providers';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

jest.mock('@/lib/data/historical-providers', () => ({
  getHistoricalProviders: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);
const mockedGetHistoricalProviders = jest.mocked(getHistoricalProviders);

function closeOnlyResponse(timestamp: number, price: number): Response {
  return Response.json({
    prices: [[timestamp, price]],
    total_volumes: [[timestamp, 100]],
  });
}

function closeOnlySeriesResponse(
  firstTimestamp: number,
  count: number,
): Response {
  return Response.json({
    prices: Array.from({ length: count }, (_, index) => [
      firstTimestamp + index * 86_400_000,
      100 + index / 100,
    ]),
    total_volumes: [],
  });
}

function enqueueIntradayResponse(timestamp: number): void {
  mockedFetchProvider
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(Response.json([[
      timestamp,
      '100',
      '101',
      '99',
      '100',
      '10',
    ]]))
    .mockResolvedValueOnce(Response.json([]));
}

describe('historical cache and provider diagnostics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    mockedFetchProvider.mockReset();
    mockedGetHistoricalProviders.mockReset().mockResolvedValue([{
      id: 'coingecko_public',
      name: 'CoinGecko Public API',
      type: 'api',
      role: 'fallback',
      dataShape: 'close_only',
      quoteCurrencies: ['eur', 'usd'],
      isActive: true,
      priority: 1,
      requiresKey: false,
    }]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renews cache freshness when a successful refresh has no newer bar', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockImplementation(async () =>
      closeOnlyResponse(timestamp, 100)
    );

    await buildConsolidatedHistory('BTC', 'eur', '1d');
    jest.setSystemTime(new Date('2026-07-31T12:06:00.000Z'));
    await buildConsolidatedHistory('BTC', 'eur', '1d');
    await buildConsolidatedHistory('BTC', 'eur', '1d');

    expect(mockedFetchProvider).toHaveBeenCalledTimes(2);
  });

  it('does not mark or cache a broad but old initial data set as current', async () => {
    const firstTimestamp = Date.parse('2018-01-01T00:00:00.000Z');
    mockedFetchProvider.mockImplementation(async () =>
      closeOnlySeriesResponse(firstTimestamp, 1_000)
    );

    const first = await buildConsolidatedHistory('DOT', 'eur', '1d');
    const second = await buildConsolidatedHistory('DOT', 'eur', '1d');

    expect(first.prices).toHaveLength(1_000);
    expect(first.isComplete).toBe(false);
    expect(first.freshness).toBe('stale');
    expect(first.cache).toEqual({ status: 'miss' });
    expect(first.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Latest historical observation is stale'),
    ]));
    expect(second.freshness).toBe('stale');
    expect(mockedFetchProvider).toHaveBeenCalledTimes(2);
  });

  it('does not renew an intraday cache from an old identical response', async () => {
    mockedGetHistoricalProviders.mockResolvedValue([{
      id: 'binance_public',
      name: 'Binance Public API',
      type: 'api',
      role: 'primary',
      dataShape: 'ohlcv',
      quoteCurrencies: ['eur'],
      isActive: true,
      priority: 1,
      requiresKey: false,
    }]);
    enqueueIntradayResponse(Date.parse('2026-07-31T11:55:00.000Z'));
    const first = await buildConsolidatedHistory('XRP', 'eur', '5m');
    expect(first.freshness).toBe('fresh');

    jest.setSystemTime(new Date('2026-07-31T13:00:00.000Z'));
    enqueueIntradayResponse(Date.parse('2026-07-31T11:55:00.000Z'));
    const stale = await buildConsolidatedHistory('XRP', 'eur', '5m');
    expect(stale.freshness).toBe('stale');
    expect(stale.cache?.status).toBe('hit_stale');

    enqueueIntradayResponse(Date.parse('2026-07-31T12:55:00.000Z'));
    const refreshed = await buildConsolidatedHistory('XRP', 'eur', '5m');
    expect(refreshed.freshness).toBe('fresh');
    expect(mockedFetchProvider).toHaveBeenCalledTimes(9);
  });

  it('uses one in-flight request for identical concurrent histories', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockImplementation(async () => {
      await Promise.resolve();
      return closeOnlyResponse(timestamp, 100);
    });

    const [first, second] = await Promise.all([
      buildConsolidatedHistory('ETH', 'eur', '1d'),
      buildConsolidatedHistory('ETH', 'eur', '1d'),
    ]);

    expect(mockedFetchProvider).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('shares one bounded refresh across concurrent public callers', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockImplementation(async () => {
      await Promise.resolve();
      return closeOnlyResponse(timestamp, 100);
    });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const [first, second] = await Promise.all([
      buildConsolidatedHistory(
        'MATIC',
        'eur',
        '1d',
        false,
        firstController.signal,
      ),
      buildConsolidatedHistory(
        'MATIC',
        'eur',
        '1d',
        false,
        secondController.signal,
      ),
    ]);

    expect(mockedFetchProvider).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('keeps provider failures as sanitized diagnostics', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedFetchProvider.mockRejectedValueOnce(new Error('private upstream detail'));

    const result = await buildConsolidatedHistory('SOL', 'eur', '1d');

    expect(result.prices).toEqual([]);
    expect(result.warnings).toEqual([
      '[CoinGecko Public API] failed: Provider request failed',
    ]);
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
    consoleError.mockRestore();
  });

  it('marks an expired cache stale when every applicable provider fails', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockResolvedValueOnce(
      closeOnlyResponse(timestamp, 100),
    );
    const first = await buildConsolidatedHistory('LINK', 'eur', '1d');

    jest.setSystemTime(new Date('2026-07-31T12:06:00.000Z'));
    mockedFetchProvider.mockRejectedValueOnce(new Error('provider outage'));
    const stale = await buildConsolidatedHistory('LINK', 'eur', '1d');

    expect(first.cache?.status).toBe('miss');
    expect(stale.cache).toEqual(expect.objectContaining({
      status: 'hit_stale',
      storedAt: '2026-07-31T12:00:00.000Z',
    }));
    expect(stale.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Cached history is stale'),
    ]));
  });

  it('does not renew stale data after a structurally invalid provider payload', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockResolvedValueOnce(
      closeOnlyResponse(timestamp, 100),
    );
    await buildConsolidatedHistory('AVAX', 'eur', '1d');

    jest.setSystemTime(new Date('2026-07-31T12:06:00.000Z'));
    mockedFetchProvider.mockResolvedValueOnce(
      closeOnlyResponse(timestamp, -1),
    );
    const stale = await buildConsolidatedHistory('AVAX', 'eur', '1d');

    mockedFetchProvider.mockResolvedValueOnce(
      closeOnlyResponse(timestamp, 101),
    );
    await buildConsolidatedHistory('AVAX', 'eur', '1d');

    expect(stale.cache?.status).toBe('hit_stale');
    expect(mockedFetchProvider).toHaveBeenCalledTimes(3);
  });

  it('does not return a cache beyond the bounded stale-on-error window', async () => {
    const timestamp = Date.parse('2026-07-30T00:00:00.000Z');
    mockedFetchProvider.mockResolvedValueOnce(
      closeOnlyResponse(timestamp, 100),
    );
    await buildConsolidatedHistory('ADA', 'eur', '1d');

    jest.setSystemTime(new Date('2026-08-01T12:00:01.000Z'));
    mockedFetchProvider.mockRejectedValueOnce(new Error('provider outage'));

    await expect(
      buildConsolidatedHistory('ADA', 'eur', '1d'),
    ).rejects.toThrow('Historical market data unavailable');
  });

  it('propagates cancellation before starting provider work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      (buildConsolidatedHistory as unknown as (
        symbol: string,
        currency: string,
        interval: string,
        forceRefresh: boolean,
        signal: AbortSignal,
      ) => ReturnType<typeof buildConsolidatedHistory>)(
        'XRP',
        'eur',
        '1d',
        false,
        controller.signal,
      ),
    ).rejects.toThrow('Historical market data unavailable');
    expect(mockedFetchProvider).not.toHaveBeenCalled();
  });
});
