import { fetchTiingoCryptoDailyPrices, TiingoProviderError } from '@/lib/financial-data/providers/tiingo';

const base = {
  apiKey: 'SYNTHETIC_TEST_ONLY', healthKey: 'unit-crypto-personal',
  symbol: 'BTC' as const, startDate: '2026-10-20', endDate: '2026-10-24',
};
const rows = [
  { date: '2026-10-22T00:00:00.000Z', open: 100, high: 111, low: 95, close: 110, volume: 12.5 },
  { date: '2026-10-23T00:00:00.000Z', open: 110, high: 115, low: 101, close: 113, volume: 16.75 },
];
const payload = () => [{ ticker: 'btcusd', baseCurrency: 'btc', quoteCurrency: 'usd', priceData: rows }];
describe('Tiingo BYOK crypto daily aggregate trust boundary', () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });

  it('uses a fixed-host, authorized, token-free URL with completed daily OHLCV', async () => {
    global.fetch = jest.fn(async () => Response.json(payload()));
    const result = await fetchTiingoCryptoDailyPrices(base);
    expect(result.map((r) => r.close)).toEqual([110, 113]);
    expect(result.at(-1)?.volume).toBe(16.75);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.tiingo.com');
    expect(parsed.pathname).toBe('/tiingo/crypto/prices');
    expect(parsed.searchParams.get('tickers')).toBe('btcusd');
    expect(parsed.searchParams.get('resampleFreq')).toBe('1day');
    expect(url).not.toContain(base.apiKey);
    expect(new Headers(init.headers).get('Authorization')).toBe('Token ' + base.apiKey);
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
  });

  it.each([
    [{ ticker: 'ethusd', baseCurrency: 'eth', quoteCurrency: 'usd', priceData: rows }],
    [{ ticker: 'btcusd', baseCurrency: 'btc', quoteCurrency: 'eur', priceData: rows }],
    [{ ticker: 'btcusd', baseCurrency: 'btc', quoteCurrency: 'usd', priceData: [{ ...rows[0], close: -1 }] }],
    [{ ticker: 'btcusd', baseCurrency: 'btc', quoteCurrency: 'usd', priceData: [rows[0], { ...rows[0] }] }],
  ])('rejects mismatched metadata, malformed values and duplicated dates', async (responseData) => {
    global.fetch = jest.fn(async () => Response.json(responseData));
    await expect(fetchTiingoCryptoDailyPrices(base)).rejects.toBeInstanceOf(TiingoProviderError);
  });

  it('does not allow arbitrary currency pair or symbol', async () => {
    global.fetch = jest.fn();
    await expect(fetchTiingoCryptoDailyPrices({ ...base, symbol: 'BTC-EUR' as 'BTC' }))
      .rejects.toMatchObject({ status: 'misconfigured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
