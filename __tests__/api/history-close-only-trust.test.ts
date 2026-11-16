import { GET } from '@/app/api/prices/history/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedHistory = jest.mocked(buildConsolidatedHistory);

describe('history API close-only transparency', () => {
  it('does not expose synthetic OHLC values for close-only snapshots', async () => {
    mockedHistory.mockResolvedValue({
      symbol: 'BTC',
      prices: [
        {
          date: '2026-07-27',
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 0,
          volumeAvailable: false,
          quality: 'close_only',
        },
      ],
      provenance: [
        {
          startDate: '2026-07-27',
          endDate: '2026-07-27',
          providerId: 'coingecko_public',
          providerName: 'CoinGecko Keyless Public API',
          role: 'fallback',
          dataPoints: 1,
          status: 'partial',
        },
      ],
      isComplete: false,
      warnings: ['Close-only market snapshots; open, high, and low are unavailable.'],
    });

    const response = await GET(
      new Request('http://localhost/api/prices/history?symbol=BTC', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.88' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prices).toEqual([
      expect.objectContaining({
        close: 100,
        open: null,
        high: null,
        low: null,
        volume: null,
        dataQuality: 'close_only',
        priceQuality: 'observed',
        sourceRef: expect.any(String),
      }),
    ]);
    expect(body.sources).toEqual([
      expect.objectContaining({
        ref: body.prices[0].sourceRef,
        kind: 'market',
        providerId: 'coingecko_public',
      }),
    ]);
    expect(body.currency).toBe('eur');
    expect(body.status).toBe('partial');
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.provenance[0].status).toBe('partial');
  });

  it('never reports a stale-on-error cache as complete', async () => {
    mockedHistory.mockResolvedValue({
      symbol: 'BTC',
      prices: [{
        date: '2026-07-27',
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
        quality: 'ohlc',
        providerId: 'binance_public',
        providerName: 'Binance Public API',
      }],
      provenance: [{
        startDate: '2026-07-27',
        endDate: '2026-07-27',
        providerId: 'binance_public',
        providerName: 'Binance Public API',
        role: 'primary',
        dataPoints: 1,
        status: 'structurally_valid',
      }],
      isComplete: true,
      warnings: ['Cached history is stale because every applicable provider refresh failed.'],
      cache: {
        status: 'hit_stale',
        storedAt: '2026-07-31T12:00:00.000Z',
        expiresAt: '2026-07-31T12:05:00.000Z',
        staleUntil: '2026-08-01T12:00:00.000Z',
      },
    });

    const response = await GET(
      new Request('http://localhost/api/prices/history?symbol=BTC', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.90' },
      }),
    );
    const body = await response.json();

    expect(body.status).toBe('partial');
    expect(body.cache.status).toBe('hit_stale');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not CDN-cache history whose latest observation is stale', async () => {
    mockedHistory.mockResolvedValue({
      symbol: 'BTC',
      prices: [{
        date: '2025-01-02',
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
        quality: 'ohlc',
      }],
      provenance: [],
      isComplete: false,
      freshness: 'stale',
      warnings: ['Latest historical observation is stale.'],
      cache: { status: 'miss' },
    });

    const response = await GET(
      new Request('http://localhost/api/prices/history?symbol=BTC', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.92' },
      }),
    );
    const body = await response.json();

    expect(body.freshness).toBe('stale');
    expect(body.status).toBe('partial');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('uses the recorded provider retrieval time instead of response generation time', async () => {
    mockedHistory.mockResolvedValue({
      symbol: 'BTC',
      prices: [{
        date: '2026-07-27',
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
        quality: 'ohlc',
        providerId: 'binance_public',
        providerName: 'Binance Public API',
        retrievedAt: '2026-07-27T00:05:00.000Z',
      }],
      provenance: [{
        startDate: '2026-07-27',
        endDate: '2026-07-27',
        providerId: 'binance_public',
        providerName: 'Binance Public API',
        role: 'primary',
        dataPoints: 1,
        status: 'structurally_valid',
        retrievedAt: '2026-07-27T00:05:00.000Z',
      }],
      isComplete: false,
      warnings: [],
    } as never);

    const response = await GET(
      new Request('http://localhost/api/prices/history?symbol=BTC', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.91' },
      }),
    );
    const body = await response.json();

    expect(body.sources.find(
      (source: { ref: string }) => source.ref === body.prices[0].sourceRef,
    ).retrievedAt).toBe(
      '2026-07-27T00:05:00.000Z',
    );
    expect(mockedHistory).toHaveBeenLastCalledWith(
      'BTC',
      'eur',
      '1d',
      false,
      expect.any(AbortSignal),
    );
  });
});
