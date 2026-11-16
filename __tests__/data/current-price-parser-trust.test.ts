import { fetchProvider } from '@/lib/data/provider-fetch';
import { fetchBinancePrice } from '@/lib/prices/binance';
import { fetchBitfinexPrice } from '@/lib/prices/bitfinex';
import { fetchKuCoinPrice } from '@/lib/prices/kucoin';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);

describe('current-price provider parsers', () => {
  beforeEach(() => {
    mockedFetchProvider.mockReset();
  });

  it('does not partially parse a malformed Binance price', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      Response.json({ price: '123.45unexpected' }),
    );

    await expect(fetchBinancePrice('BTC')).resolves.toBeNull();
  });

  it('rejects non-finite Bitfinex and non-positive KuCoin prices', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(
        Response.json([0, 0, 0, 0, 0, 0, 'Infinity']),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: '200000',
          data: { price: '0' },
        }),
      );

    await expect(fetchBitfinexPrice('BTC')).resolves.toBeNull();
    await expect(fetchKuCoinPrice('BTC')).resolves.toBeNull();
  });

  it('preserves a valid numeric provider value', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      Response.json({ price: '123.45' }),
    );

    await expect(fetchBinancePrice('BTC')).resolves.toBe(123.45);
  });
});
