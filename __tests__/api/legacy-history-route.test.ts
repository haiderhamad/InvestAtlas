import { GET } from '@/app/api/prices/historical/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedHistory = jest.mocked(buildConsolidatedHistory);

describe('legacy crypto history compatibility route', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-31T13:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the consolidated history foundation and keeps close-only gaps explicit', async () => {
    mockedHistory.mockResolvedValueOnce({
      symbol: 'BTC',
      prices: [{
        date: '2026-07-30',
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 10,
        quality: 'close_only',
      }],
      provenance: [{
        startDate: '2026-07-30',
        endDate: '2026-07-30',
        providerId: 'coingecko_public',
        providerName: 'CoinGecko Public API',
        role: 'fallback',
        dataPoints: 1,
        status: 'partial',
      }],
      isComplete: false,
      warnings: [],
    });

    const response = await GET(new Request(
      'https://investatlas.example/api/prices/historical?symbol=BTC&days=30&currency=eur',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.90' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedHistory).toHaveBeenCalledWith(
      'BTC',
      'eur',
      '1d',
      false,
      expect.any(AbortSignal),
    );
    expect(body).toEqual(expect.objectContaining({
      status: 'partial',
      symbol: 'BTC',
      currency: 'eur',
      data: [{
        date: '2026-07-30',
        open: null,
        high: null,
        low: null,
        close: 100,
        volume: 10,
        dataQuality: 'close_only',
      }],
      provenance: expect.any(Array),
    }));
  });

  it('does not CDN-cache stale-on-error history beyond its trust window', async () => {
    mockedHistory.mockResolvedValueOnce({
      symbol: 'BTC',
      prices: [{
        date: new Date().toISOString().slice(0, 10),
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 10,
        quality: 'ohlc',
      }],
      provenance: [],
      isComplete: true,
      warnings: [],
      cache: {
        status: 'hit_stale',
        storedAt: '2026-07-31T12:00:00.000Z',
        expiresAt: '2026-07-31T12:05:00.000Z',
        staleUntil: '2026-08-01T12:00:00.000Z',
      },
    });

    const response = await GET(new Request(
      'https://investatlas.example/api/prices/historical?symbol=BTC&days=30&currency=eur',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.92' } },
    ));

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
