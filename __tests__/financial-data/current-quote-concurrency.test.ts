import { getCurrentQuotes } from '@/lib/financial-data/quotes/current-quote-service';
import { fetchYahooCurrentQuote } from '@/lib/prices/yahoo';

jest.mock('@/lib/prices/yahoo', () => ({
  fetchYahooCurrentQuote: jest.fn(),
}));
jest.mock('@/lib/prices/bitfinex', () => ({
  fetchBitfinexPrice: jest.fn().mockResolvedValue(null),
}));

const mockedFetchYahooCurrentQuote = jest.mocked(fetchYahooCurrentQuote);

describe('current quote provider workload', () => {
  beforeEach(() => {
    mockedFetchYahooCurrentQuote.mockReset();
  });

  it('caps simultaneous Yahoo requests for a multi-symbol public query', async () => {
    let active = 0;
    let maximumActive = 0;
    mockedFetchYahooCurrentQuote.mockImplementation(async (symbols) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;

      const sourceSymbol = Array.isArray(symbols) ? symbols[0] : symbols;
      return {
        price: 100,
        previousClose: 99,
        volume: 1_000,
        marketCap: 1_000_000,
        currency: 'usd',
        displayName: sourceSymbol,
        fiftyTwoWeekHigh: 120,
        fiftyTwoWeekLow: 80,
        instrumentType: 'EQUITY',
        nativeCurrency: 'usd',
        sourceSymbol,
        asOf: '2026-07-31T15:30:00.000Z',
        retrievedAt: '2026-07-31T15:31:00.000Z',
        marketFreshness: 'fresh',
        fx: {
          providerId: 'investatlas_calculation',
          providerName: 'InvestAtlas',
          rate: 1,
          asOf: null,
          freshness: 'fresh',
          retrievedAt: '2026-07-31T15:31:00.000Z',
          method: 'identity exchange rate',
        },
      };
    });

    const result = await getCurrentQuotes(
      ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'],
      'usd',
    );

    expect(Object.keys(result.prices)).toHaveLength(7);
    expect(maximumActive).toBeLessThanOrEqual(4);
    const requestSignals = mockedFetchYahooCurrentQuote.mock.calls.map(
      (call) => call[3],
    );
    expect(requestSignals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(new Set(requestSignals).size).toBe(1);
  });
});
