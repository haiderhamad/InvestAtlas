import { GET as searchAssets } from '@/app/api/assets/search/route';
import { GET as getAth } from '@/app/api/prices/ath/route';
import { GET as getBenchmarkHistory } from '@/app/api/prices/benchmark-history/route';
import { GET as getCryptoHistory } from '@/app/api/prices/historical/route';
import { GET as getConsolidatedHistory } from '@/app/api/prices/history/route';
import { GET as getMetalSpot } from '@/app/api/prices/metal-spot/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';
import { fetchProvider } from '@/lib/data/provider-fetch';
import {
  fetchYahooCurrentQuote,
  fetchYahooHistoricalBars,
} from '@/lib/prices/yahoo';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

jest.mock('@/lib/prices/yahoo', () => ({
  fetchYahooCurrentQuote: jest.fn(),
  fetchYahooHistoricalBars: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);
const mockedBuildConsolidatedHistory = jest.mocked(buildConsolidatedHistory);
const mockedFetchYahooHistoricalBars = jest.mocked(fetchYahooHistoricalBars);
const mockedFetchYahooCurrentQuote = jest.mocked(fetchYahooCurrentQuote);

let requestSequence = 0;

function request(path: string): Request {
  requestSequence += 1;
  return new Request(`https://investatlas.example${path}`, {
    headers: {
      'x-vercel-forwarded-for': `198.51.100.${requestSequence}`,
    },
  });
}

describe('public market-data error boundaries', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('does not expose CoinGecko response details from ATH requests', async () => {
    mockedFetchProvider.mockRejectedValue(
      new Error('upstream secret and internal URL'),
    );

    const response = await getAth(
      request('/api/prices/ath?symbols=BTC&currency=eur'),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toBe('{"error":"Market data is temporarily unavailable"}');
    expect(body).not.toContain('upstream secret');
  });

  it('does not expose Yahoo response details from benchmark requests', async () => {
    mockedFetchYahooHistoricalBars.mockRejectedValue(
      new Error('provider credential and private response'),
    );

    const response = await getBenchmarkHistory(
      request('/api/prices/benchmark-history?yahooSymbol=%5EGSPC&currency=eur'),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe('{"error":"Benchmark data is temporarily unavailable"}');
    expect(body).not.toContain('provider credential');
  });

  it('rejects an HTTP-successful benchmark set whose latest bar is stale', async () => {
    mockedFetchYahooHistoricalBars.mockResolvedValue({
      currency: 'eur',
      bars: [{
        date: '2025-01-02',
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
        volumeAvailable: true,
        retrievedAt: '2026-08-01T12:00:00.000Z',
      }],
    });

    const response = await getBenchmarkHistory(
      request('/api/prices/benchmark-history?yahooSymbol=%5EGSPC&currency=eur'),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({
      status: 'unavailable',
      error: 'Benchmark data is temporarily unavailable',
    });
  });

  it('does not substitute a remote metal quote far from the requested date', async () => {
    mockedFetchYahooHistoricalBars.mockResolvedValue({
      currency: 'eur',
      bars: [
        {
          date: '2025-01-02',
          open: 2_000,
          high: 2_010,
          low: 1_990,
          close: 2_005,
          volume: 100,
          volumeAvailable: true,
          retrievedAt: '2025-01-02T12:00:00.000Z',
        },
      ],
    });

    const response = await getMetalSpot(
      request('/api/prices/metal-spot?symbol=GOLD&date=2020-01-02&currency=eur'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'No historical market data is available near the requested date',
    });
  });

  it('uses the last trading day on or before a historical metal transaction date', async () => {
    mockedFetchYahooHistoricalBars.mockResolvedValue({
      currency: 'eur',
      bars: [
        {
          date: '2026-07-03',
          open: 2_000,
          high: 2_010,
          low: 1_990,
          close: 2_005,
          volume: 100,
          volumeAvailable: true,
          retrievedAt: '2026-07-03T12:00:00.000Z',
        },
        {
          date: '2026-07-06',
          open: 2_100,
          high: 2_110,
          low: 2_090,
          close: 2_105,
          volume: 100,
          volumeAvailable: true,
          retrievedAt: '2026-07-06T12:00:00.000Z',
        },
      ],
    });

    const response = await getMetalSpot(
      request('/api/prices/metal-spot?symbol=GOLD&date=2026-07-05&currency=eur'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.date).toBe('2026-07-03');
    expect(body.spotPricePerOz).toBe(2_005);
  });

  it('does not auto-fill a transaction from a stale current metal quote', async () => {
    mockedFetchYahooCurrentQuote.mockResolvedValue({
      price: 2_000,
      previousClose: 1_990,
      volume: 100,
      marketCap: null,
      currency: 'eur',
      displayName: 'Gold',
      fiftyTwoWeekHigh: 2_100,
      fiftyTwoWeekLow: 1_800,
      instrumentType: 'COMMODITY',
      nativeCurrency: 'eur',
      sourceSymbol: 'GC=F',
      asOf: '2026-07-28T15:30:00.000Z',
      retrievedAt: '2026-08-01T12:00:00.000Z',
      marketFreshness: 'stale',
      fx: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        rate: 1,
        asOf: null,
        freshness: 'fresh',
        retrievedAt: '2026-08-01T12:00:00.000Z',
      },
    });

    const response = await getMetalSpot(
      request('/api/prices/metal-spot?symbol=GOLD&currency=eur'),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects future metal quote dates before contacting a provider', async () => {
    const response = await getMetalSpot(
      request('/api/prices/metal-spot?symbol=GOLD&date=2999-01-01&currency=eur'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Future dates are not supported',
    });
    expect(mockedFetchYahooHistoricalBars).not.toHaveBeenCalled();
  });

  it('does not expose CoinGecko response details from history requests', async () => {
    mockedBuildConsolidatedHistory.mockRejectedValue(
      new Error('quota token and upstream payload'),
    );

    const response = await getCryptoHistory(
      request('/api/prices/historical?symbol=BTC&days=30&currency=eur'),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe(
      '{"error":"Historical market data is temporarily unavailable"}',
    );
    expect(body).not.toContain('quota token');
  });

  it('does not expose consolidated provider errors from history requests', async () => {
    mockedBuildConsolidatedHistory.mockRejectedValue(
      new Error('private provider payload and internal endpoint'),
    );

    const response = await getConsolidatedHistory(
      request('/api/prices/history?symbol=BTC&currency=eur&interval=1d'),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toBe(
      '{"error":"Historical market data is temporarily unavailable"}',
    );
    expect(body).not.toContain('private provider payload');
  });

  it('does not expose malformed request internals from asset search', async () => {
    const malformedRequest = {
      headers: new Headers({
        'x-vercel-forwarded-for': `198.51.100.${++requestSequence}`,
      }),
      url: 'not a valid URL',
    } as Request;

    const response = await searchAssets(malformedRequest);
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe('{"error":"Asset search is temporarily unavailable"}');
    expect(body).not.toContain('Invalid URL');
  });
});
