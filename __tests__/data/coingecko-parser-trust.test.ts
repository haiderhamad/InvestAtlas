import { fetchProvider } from '@/lib/data/provider-fetch';
import {
  fetchCurrentPrice,
  fetchHistoricalPrices,
  fetchMultiplePrices,
} from '@/lib/prices/coingecko';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);

describe('CoinGecko price parser trust', () => {
  beforeEach(() => {
    mockedFetchProvider.mockReset();
  });

  it('preserves valid OHLC and rejects inconsistent provider rows', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      Response.json([
        [
          Date.parse('2026-07-27T00:00:00.000Z'),
          105,
          100,
          90,
          95,
        ],
        [
          Date.parse('2026-07-28T00:00:00.000Z'),
          100,
          110,
          90,
          105,
        ],
      ]),
    );

    await expect(
      fetchHistoricalPrices('bitcoin', 365, 'eur'),
    ).resolves.toEqual([
      {
        date: '2026-07-28',
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: null,
      },
    ]);
  });

  it('does not turn a missing or invalid current price into zero', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      Response.json({ bitcoin: { eur: null } }),
    );

    await expect(
      fetchCurrentPrice('bitcoin', 'eur'),
    ).rejects.toThrow('no valid current price');
  });

  it('omits unavailable values from a multi-price result', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      Response.json({
        bitcoin: { eur: 100 },
        ethereum: { eur: Number.POSITIVE_INFINITY },
      }),
    );

    await expect(
      fetchMultiplePrices(['bitcoin', 'ethereum'], 'eur'),
    ).resolves.toEqual({ bitcoin: 100 });
  });

  it('rejects path-like identifiers before calling the provider', async () => {
    await expect(
      fetchHistoricalPrices('../bitcoin', 365, 'eur'),
    ).rejects.toThrow('Invalid CoinGecko identifier');
    expect(mockedFetchProvider).not.toHaveBeenCalled();
  });
});
