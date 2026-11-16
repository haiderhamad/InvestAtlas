import { getHistoricalProviders } from '@/lib/data/historical-providers';
import { getCoinbaseProductCandidates } from '@/lib/data/historical-engine';

describe('historical provider provenance', () => {
  it('declares the actual historical data shape for every provider', async () => {
    const providers = await getHistoricalProviders();

    expect(
      providers.find((provider) => provider.id === 'coingecko_public'),
    ).toEqual(expect.objectContaining({ dataShape: 'close_only' }));
    expect(
      providers.find((provider) => provider.id === 'binance_public'),
    ).toEqual(expect.objectContaining({ quoteCurrencies: ['eur'] }));
    expect(
      providers
        .filter((provider) => provider.id !== 'coingecko_public')
        .every((provider) => provider.dataShape === 'ohlcv'),
    ).toBe(true);
  });

  it('does not treat USDC as a USD historical quote', () => {
    expect(getCoinbaseProductCandidates('BTC', 'usd')).toEqual(['BTC-USD']);
    expect(getCoinbaseProductCandidates('BTC', 'eur')).toEqual(['BTC-EUR']);
  });

  it('keeps permission-required exchange providers inactive by default', async () => {
    const providers = await getHistoricalProviders();

    expect(providers.find((provider) => provider.id === 'kraken_public')?.isActive).toBe(false);
    expect(providers.find((provider) => provider.id === 'coinbase_public')?.isActive).toBe(false);
  });
});
