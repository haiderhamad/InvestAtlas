import { GET } from '@/app/api/prices/ath/route';
import { fetchProvider } from '@/lib/data/provider-fetch';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);

describe('ATH market-data trust boundary', () => {
  it('keeps missing ATH values unavailable instead of copying the current price', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'bitcoin',
            current_price: 100,
            last_updated: new Date().toISOString(),
          },
        ]),
      ),
    );

    const response = await GET(
      new Request('http://localhost/api/prices/ath?symbols=BTC&currency=eur'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prices.BTC).toEqual(expect.objectContaining({
      price: 100,
      ath: null,
      athDate: null,
      athValDropPct: null,
      freshness: 'fresh',
      asOf: expect.any(String),
    }));
  });

  it('does not use an old CoinGecko current price for savings-plan calculations', async () => {
    mockedFetchProvider.mockResolvedValueOnce(Response.json([
      {
        id: 'bitcoin',
        current_price: 100,
        ath: 120,
        last_updated: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
    ]));

    const response = await GET(
      new Request('http://localhost/api/prices/ath?symbols=BTC&currency=eur'),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual(expect.objectContaining({
      status: 'unavailable',
      prices: {},
    }));
  });
});
