import { fetchYahooPersonalDaily, parseYahooPersonalChart } from '@/lib/financial-data/providers/yahoo-personal-server';

const now = Date.UTC(2026, 10, 3, 21, 0, 0);
const days = [Date.UTC(2026, 9, 30, 16) / 1000, Date.UTC(2026, 10, 2, 16) / 1000];
const chart = (
  symbol = 'AAPL', currency = 'USD', instrumentType = 'EQUITY',
  exchangeName = symbol.endsWith('.DE') ? 'GER' : symbol.endsWith('.AS') ? 'AMS' : symbol.endsWith('.L') ? 'LSE' : 'NMS',
) => ({
  chart: { result: [{
    meta: { symbol, currency, instrumentType, exchangeName },
    timestamp: days,
    indicators: { quote: [{
      open: [320, 330], high: [327, 339], low: [318, 328],
      close: [325, 336], volume: [120000, 130000],
    }] },
  }], error: null },
});

describe('Yahoo personal daily series is exact instrument data, never a fabricated quote', () => {
  const original = global.fetch;
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(now); });
  afterEach(() => { global.fetch = original; jest.restoreAllMocks(); });

  test('accepts an authentic USD stock and an exact EUR-listed Islamic ETF', () => {
    const apple = parseYahooPersonalChart('AAPL', chart(), now);
    expect(apple).toMatchObject({
      providerId: 'yahoo_personal_daily', assetSymbol: 'AAPL', providerSymbol: 'AAPL',
      listingCurrency: 'USD', latestObservationAt: '2026-11-02',
      bars: [{ date: '2026-10-30' }, { date: '2026-11-02', close: 336 }],
    });
    const iswd = parseYahooPersonalChart('ISWD', chart('IUSD.DE', 'EUR', 'ETF'), now);
    expect(iswd).toMatchObject({
      assetSymbol: 'ISWD', providerSymbol: 'IUSD.DE', listingCurrency: 'EUR',
      bars: [{ date: '2026-10-30' }, { date: '2026-11-02' }],
    });
  });

  test('rejects mismatched symbol, currency, instrument class and impossible OHLC', () => {
    expect(() => parseYahooPersonalChart('ISWD', chart('ISWD', 'EUR', 'ETF'), now)).toThrow();
    expect(() => parseYahooPersonalChart('ISWD', chart('IUSD.DE', 'USD', 'ETF'), now)).toThrow();
    expect(() => parseYahooPersonalChart('AAPL', chart('AAPL', 'USD', 'ETF'), now)).toThrow();
    const bad = chart();
    bad.chart.result[0].indicators.quote[0].low[1] = 350;
    expect(() => parseYahooPersonalChart('AAPL', bad, now)).toThrow();
  });

  test('does not promote an older market observation over a newer completed close', () => {
    const payload = chart();
    Object.assign(payload.chart.result[0].meta, { regularMarketPrice: 200, regularMarketTime: Date.UTC(2026, 10, 1, 18) / 1000 });
    const result = parseYahooPersonalChart('AAPL', payload, now);
    expect(result).not.toHaveProperty('current');
    expect(result.bars.at(-1)?.close).toBe(336);
  });

  test.each([
    ['AAPL', 'AAPL', 'USD', 'EQUITY', 'NMS'],
    ['HLAL', 'HLAL', 'USD', 'ETF', 'NGM'],
    ['UMMA', 'UMMA', 'USD', 'ETF', 'NGM'],
    ['SPUS', 'SPUS', 'USD', 'ETF', 'PCX'],
    ['SPWO', 'SPWO', 'USD', 'ETF', 'PCX'],
    ['SPTE', 'SPTE', 'USD', 'ETF', 'PCX'],
    ['SPRE', 'SPRE', 'USD', 'ETF', 'PCX'],
    ['SAP', 'SAP.DE', 'EUR', 'EQUITY', 'GER'],
    ['ASML', 'ASML.AS', 'EUR', 'EQUITY', 'AMS'],
    ['IVSI', 'IGDA.L', 'USD', 'ETF', 'LSE'],
  ])('accepts the catalog listing and venue for %s', (symbol, ticker, currency, type, exchange) => {
    expect(parseYahooPersonalChart(symbol, chart(ticker, currency, type, exchange), now))
      .toMatchObject({ assetSymbol: symbol, providerSymbol: ticker, listingCurrency: currency });
  });

  test.each([
    ['AAPL', 'AAPL', 'USD', 'EQUITY', 'PCX'],
    ['HLAL', 'HLAL', 'USD', 'ETF', 'NYQ'],
    ['UMMA', 'UMMA', 'USD', 'ETF', 'PCX'],
    ['SPUS', 'SPUS', 'USD', 'ETF', 'NMS'],
    ['SPRE', 'SPRE', 'USD', 'ETF', 'NYQ'],
    ['ASML', 'ASML.AS', 'EUR', 'EQUITY', 'NMS'],
    ['IVSI', 'IGDA.L', 'USD', 'ETF', 'GER'],
  ])('rejects a wrong exchange for %s before returning an observation', (symbol, ticker, currency, type, exchange) => {
    const payload = chart(ticker, currency, type, exchange);
    Object.assign(payload.chart.result[0].meta, { regularMarketPrice: 337, regularMarketTime: now / 1000 - 60 });
    expect(() => parseYahooPersonalChart(symbol, payload, now)).toThrow('mismatch');
  });

  test('returns the source market price and time separately from completed daily bars', () => {
    const payload = chart();
    Object.assign(payload.chart.result[0].meta, {
      regularMarketPrice: 337.25, regularMarketTime: now / 1000 - 60, chartPreviousClose: 200,
    });
    const result = parseYahooPersonalChart('AAPL', payload, now);
    expect(result).toMatchObject({
      current: { price: 337.25, observedAt: '2026-11-03T20:59:00.000Z' },
      latestObservationAt: '2026-11-02',
      bars: [{ date: '2026-10-30', close: 325 }, { date: '2026-11-02', close: 336 }],
    });
    expect(result).not.toHaveProperty('change24h');
    expect(result).not.toHaveProperty('chartPreviousClose');
  });

  test.each([
    ['seven days old', now / 1000 - 7 * 86_400],
    ['five minutes ahead', now / 1000 + 300],
  ])('accepts a current timestamp exactly at the %s bound', (_label, timestamp) => {
    const payload = chart();
    if (timestamp < now / 1000 - 86_400) payload.chart.result[0].timestamp = [timestamp - 86_400, timestamp];
    Object.assign(payload.chart.result[0].meta, { regularMarketPrice: 1e8, regularMarketTime: timestamp });
    expect(parseYahooPersonalChart('AAPL', payload, now)).toHaveProperty('current', {
      price: 1e8, observedAt: new Date(timestamp * 1000).toISOString(),
    });
  });

  test.each([
    ['absent price', undefined, now / 1000],
    ['absent time', 337, undefined],
    ['zero price', 0, now / 1000],
    ['negative price', -1, now / 1000],
    ['non-numeric price', '337', now / 1000],
    ['infinite price', Infinity, now / 1000],
    ['NaN price', NaN, now / 1000],
    ['unbounded price', 1e8 + 1, now / 1000],
    ['fractional timestamp', 337, now / 1000 + 0.5],
    ['non-numeric timestamp', 337, String(now / 1000)],
    ['unsafe timestamp', 337, Number.MAX_SAFE_INTEGER],
    ['infinite timestamp', 337, Infinity],
    ['NaN timestamp', 337, NaN],
    ['stale timestamp', 337, now / 1000 - 7 * 86_400 - 1],
    ['future timestamp', 337, now / 1000 + 301],
  ])('omits %s while preserving valid EOD history', (_label, price, timestamp) => {
    const payload = chart();
    Object.assign(payload.chart.result[0].meta, { regularMarketPrice: price, regularMarketTime: timestamp });
    const result = parseYahooPersonalChart('AAPL', payload, now);
    expect(result).not.toHaveProperty('current');
    expect(result.bars).toHaveLength(2);
    expect(result.bars.at(-1)).toMatchObject({ date: '2026-11-02', close: 336 });
  });

  test('does not substitute an EOD close or retrieval time for absent current metadata', () => {
    expect(parseYahooPersonalChart('AAPL', chart(), now)).not.toHaveProperty('current');
  });

  test('rejects missing, stale and duplicated EOD data', () => {
    expect(() => parseYahooPersonalChart('GOLD', chart(), now)).toThrow();
    const bad = chart();
    bad.chart.result[0].timestamp = [days[0], days[0]];
    expect(() => parseYahooPersonalChart('AAPL', bad, now)).toThrow();
    expect(() => parseYahooPersonalChart('AAPL', chart(), now + 12 * 86_400_000)).toThrow();
  });

  test('contacts a fixed official Yahoo host once, without a user URL, cookies or redirects', async () => {
    global.fetch = jest.fn(async () => Response.json(chart())) as typeof global.fetch;
    const series = await fetchYahooPersonalDaily('AAPL');
    expect(series.providerSymbol).toBe('AAPL');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe('https://query1.finance.yahoo.com');
    expect(parsed.pathname).toBe('/v8/finance/chart/AAPL');
    expect(parsed.searchParams.get('interval')).toBe('1d');
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  test('unavailable upstream fails closed; never produces made-up stock prices', async () => {
    global.fetch = jest.fn(async () => Response.json({ chart: { error: { code: 'Not Found' } } }, { status: 404 })) as typeof global.fetch;
    await expect(fetchYahooPersonalDaily('AAPL')).rejects.toThrow();
  });

  test('preserves absent or invalid volume as unavailable, while real zero stays zero', () => {
    const payload = chart();
    Object.assign(payload.chart.result[0].indicators.quote[0], { volume: [null, -1] });
    expect(parseYahooPersonalChart('AAPL', payload, now).bars.map(bar => bar.volume)).toEqual([null, null]);
    Object.assign(payload.chart.result[0].indicators.quote[0], { volume: [0, 130000] });
    expect(parseYahooPersonalChart('AAPL', payload, now).bars.map(bar => bar.volume)).toEqual([0, 130000]);
  });

  test('does not contact Yahoo for an already cancelled request', async () => {
    global.fetch = jest.fn(async () => Response.json(chart())) as typeof global.fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(fetchYahooPersonalDaily('AAPL', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
