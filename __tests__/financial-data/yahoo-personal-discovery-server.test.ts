import {
  fetchYahooPersonalListingCandidates,
  resolveYahooPersonalListingIdentity,
} from '@/lib/financial-data/providers/yahoo-personal-discovery-server';

const now = Date.UTC(2026, 10, 7, 12);
const originalFetch = global.fetch;

function chart(symbol = 'ADBE', currency = 'USD', type = 'EQUITY', exchange = 'NMS') {
  return { chart: { result: [{
    meta: { symbol, currency, instrumentType: type, exchangeName: exchange, longName: 'Adobe Inc.' },
    timestamp: [Date.UTC(2026, 10, 5, 14) / 1000, Date.UTC(2026, 10, 6, 14) / 1000],
    indicators: { quote: [{ open: [90, 95], high: [100, 105], low: [85, 90], close: [95, 100], volume: [1000, 1200] }] },
  }], error: null } };
}

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

test('search uses the fixed Yahoo endpoint and returns candidates without currency or screening claims', async () => {
  global.fetch = jest.fn(async () => Response.json({ quotes: [
    { symbol: 'ADBE', longname: 'Adobe Inc.', quoteType: 'EQUITY', exchange: 'NMS', currency: 'USD', isHalal: true },
    { symbol: 'IUSD.DE', shortname: 'Islamic world ETF', quoteType: 'ETF', exchange: 'GER' },
    { symbol: 'BTC-USD', shortname: 'Bitcoin', quoteType: 'CRYPTOCURRENCY', exchange: 'CCC' },
    { symbol: '../internal', shortname: 'Bad candidate', quoteType: 'EQUITY', exchange: 'NMS' },
    { symbol: 'ADBE', longname: 'Duplicate', quoteType: 'EQUITY', exchange: 'NMS' },
  ] }));
  expect(await fetchYahooPersonalListingCandidates('Adobe')).toEqual([
    { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', exchange: 'NMS' },
    { symbol: 'IUSD.DE', name: 'Islamic world ETF', assetClass: 'etf', exchange: 'GER' },
  ]);
  const [url, init] = jest.mocked(global.fetch).mock.calls[0];
  const target = new URL(String(url));
  expect(target.origin).toBe('https://query1.finance.yahoo.com');
  expect(target.pathname).toBe('/v1/finance/search');
  expect(Object.fromEntries(target.searchParams)).toEqual({ q: 'Adobe', quotesCount: '8', newsCount: '0' });
  expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' });
  expect(new Headers(init?.headers).get('user-agent')).toBeNull();
  expect(new Headers(init?.headers).get('cookie')).toBeNull();
  expect(new Headers(init?.headers).get('authorization')).toBeNull();
});

test.each(['', 'a', 'a'.repeat(81), 'Adobe\nInc.', 'Adobe\u0000'])('rejects invalid search query %# before network access', async query => {
  global.fetch = jest.fn();
  await expect(fetchYahooPersonalListingCandidates(query)).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('bounds search candidates and declared or streamed search bytes', async () => {
  global.fetch = jest.fn(async () => Response.json({ quotes: Array.from({ length: 12 }, (_, i) => ({
    symbol: `C${i}`, shortname: `Company ${i}`, quoteType: 'EQUITY', exchange: 'NMS',
  })) }));
  expect(await fetchYahooPersonalListingCandidates('company')).toHaveLength(8);
  global.fetch = jest.fn(async () => Response.json({ quotes: [] }, { headers: { 'Content-Length': String(64 * 1024 + 1) } }));
  await expect(fetchYahooPersonalListingCandidates('company')).rejects.toThrow(/large/i);
  global.fetch = jest.fn(async () => new Response(' '.repeat(64 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
  await expect(fetchYahooPersonalListingCandidates('company')).rejects.toThrow(/large/i);
});

test('resolves actual chart metadata before including a validated current daily series', async () => {
  global.fetch = jest.fn(async () => Response.json(chart()));
  const result = await resolveYahooPersonalListingIdentity('ADBE');
  expect(result.instrument).toEqual({
    version: 1, symbol: 'ADBE', providerSymbol: 'ADBE', name: 'Adobe Inc.',
    assetClass: 'stock', nativeCurrency: 'usd', exchange: 'NMS',
    source: 'yahoo_chart', resolvedAt: '2026-11-07T12:00:00.000Z',
  });
  expect(result.series).toMatchObject({ assetSymbol: 'ADBE', providerSymbol: 'ADBE', listingCurrency: 'USD' });
  const [url, init] = jest.mocked(global.fetch).mock.calls[0];
  const target = new URL(String(url));
  expect(target.origin).toBe('https://query1.finance.yahoo.com');
  expect(target.pathname).toBe('/v8/finance/chart/ADBE');
  expect(Object.fromEntries(target.searchParams)).toEqual({ interval: '1d', range: '3mo' });
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
});

test.each([
  ['VOW3.DE', 'EUR', 'EQUITY', 'GER'], ['ADBE', 'USD', 'EQUITY', 'NMS'],
  ['IBM', 'USD', 'EQUITY', 'NYQ'], ['IGDA.L', 'USD', 'ETF', 'LSE'],
  ['AIR.PA', 'EUR', 'EQUITY', 'PAR'], ['ENI.MI', 'EUR', 'EQUITY', 'MIL'],
  ['ABI.BR', 'EUR', 'EQUITY', 'BRU'], ['EDP.LS', 'EUR', 'EQUITY', 'LIS'],
  ['KRZ.IR', 'EUR', 'EQUITY', 'ISE'], ['LIGHT.AS', 'EUR', 'EQUITY', 'AMS'],
])('resolves only supported exact listings: %s', async (symbol, currency, type, exchange) => {
  global.fetch = jest.fn(async () => Response.json(chart(symbol, currency, type, exchange)));
  expect((await resolveYahooPersonalListingIdentity(symbol)).instrument)
    .toMatchObject({ symbol, providerSymbol: symbol, nativeCurrency: currency.toLowerCase(), exchange });
});

test.each([
  ['ADBE', 'MSFT', 'USD', 'EQUITY', 'NMS'],
  ['ADBE', 'ADBE', 'EUR', 'INDEX', 'NMS'],
  ['ADBE', 'ADBE', 'GBX', 'EQUITY', 'NMS'],
  ['ADBE', 'ADBE', 'USD', 'EQUITY', 'GER'],
  ['AAPL', 'AAPL', 'USD', 'EQUITY', 'NYQ'],
  ['VOW3.DE', 'VOW3.DE', 'EUR', 'EQUITY', 'NMS'],
  ['0700.HK', '0700.HK', 'USD', 'EQUITY', 'HKG'],
  ['IUSD.DE', 'IUSD.DE', 'EUR', 'ETF', 'LSE'],
  ['SAP', 'SAP', 'USD', 'EQUITY', 'NYQ'],
])('refuses metadata mismatches rather than returning identity-only: %s / %s / %s / %s / %s', async (requested, actual, currency, type, exchange) => {
  global.fetch = jest.fn(async () => Response.json(chart(actual, currency, type, exchange)));
  await expect(resolveYahooPersonalListingIdentity(requested)).rejects.toThrow();
});

test('missing history still permits identity resolution without a synthetic quote', async () => {
  const payload = chart();
  payload.chart.result[0].timestamp = [];
  global.fetch = jest.fn(async () => Response.json(payload));
  const result = await resolveYahooPersonalListingIdentity('ADBE');
  expect(result.instrument).toMatchObject({ symbol: 'ADBE', nativeCurrency: 'usd' });
  expect(result).not.toHaveProperty('series');
});

test('resolution bounds chart bytes and honors cancellation before contacting Yahoo', async () => {
  global.fetch = jest.fn(async () => new Response(' '.repeat(160 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
  await expect(resolveYahooPersonalListingIdentity('ADBE')).rejects.toThrow(/large/i);
  const abort = new AbortController();
  abort.abort();
  global.fetch = jest.fn();
  await expect(resolveYahooPersonalListingIdentity('ADBE', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['../internal', 'https://evil.example', 'ıbm', 'A'.repeat(33)])('rejects unsafe resolution symbol %# without network access', async symbol => {
  global.fetch = jest.fn();
  await expect(resolveYahooPersonalListingIdentity(symbol)).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([401, 403, 429])('retains upstream HTTP %s without retry or unsafe error content', async status => {
  global.fetch = jest.fn(async () => Response.json({ message: 'DO_NOT_REFLECT_UPSTREAM_BODY' }, {
    status, headers: { 'Retry-After': '120' },
  }));
  await expect(resolveYahooPersonalListingIdentity('ADBE')).rejects.toMatchObject({ status, retryAfterSeconds: 120 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
