import {
  fetchEodhdPersonalHistory, parseEodhdDaily, resolveEodhdMapping,
  verifyEodhdPersonalKey, EodhdUpstreamError,
} from '@/lib/financial-data/providers/eodhd-server';

const NOW = Date.UTC(2026, 10, 7, 12);
const KEY = 'test-eodhd-owner-private-key';
const apple = { symbol: 'AAPL', providerSymbol: 'AAPL', assetClass: 'stock' as const, nativeCurrency: 'usd' as const, exchange: 'NMS' };
const sap = { symbol: 'SAP', providerSymbol: 'SAP.DE', assetClass: 'stock' as const, nativeCurrency: 'eur' as const, exchange: 'GER' };
const bars = [
  { date: '2026-11-05', open: 100, high: 105, low: 99, close: 104, adjusted_close: 93.5, volume: 1000 },
  { date: '2026-11-06', open: 104, high: 106, low: 103, close: 105, adjusted_close: 94.4, volume: 2000 },
];
const listing = (code = 'AAPL', exchange = 'US', currency = 'USD', type = 'Common Stock') => ({
  Code: code, Exchange: exchange, Currency: currency, Type: type, Name: 'Example listing', Country: 'USA', ISIN: 'US0378331005',
});
const oldFetch = global.fetch;
let owner: string;

beforeEach(() => {
  owner = 'eodhd-server-' + Math.random().toString(16).slice(2);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = jest.fn(async (url) => String(url).includes('/search/')
    ? Response.json([String(url).includes('/search/SAP') ? listing('SAP', 'XETRA', 'EUR') : listing()]) : Response.json(bars));
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = oldFetch; });

test('maps only exact venue/currency counterparts and validates security type independently', () => {
  expect(resolveEodhdMapping(apple, [listing()])).toMatchObject({ providerSymbol: 'AAPL.US', exchange: 'NMS', listingCurrency: 'USD' });
  expect(resolveEodhdMapping(sap, [listing('SAP', 'XETRA', 'EUR')])).toMatchObject({ providerSymbol: 'SAP.XETRA', listingCurrency: 'EUR' });
  for (const row of [listing('MSFT'), listing('AAPL', 'LSE'), listing('AAPL', 'US', 'EUR'), listing('AAPL', 'US', 'ETF')]) {
    expect(() => resolveEodhdMapping(apple, [row])).toThrow();
  }
  expect(() => resolveEodhdMapping({ ...apple, providerSymbol: 'AAPL.DE' }, [listing()])).toThrow();
  expect(() => resolveEodhdMapping({ ...apple, exchange: 'LSE' }, [listing()])).toThrow();
  expect(() => resolveEodhdMapping(apple, [listing(), listing()])).toThrow();
  expect(() => resolveEodhdMapping(apple, [listing(), listing('AAPL', 'US', 'EUR')])).toThrow();
});

test('supports exact EUR Amsterdam and USD London ETF counterparts without guessing other venues', () => {
  const amsterdam = { symbol: 'ASML', providerSymbol: 'ASML.AS', assetClass: 'stock' as const, nativeCurrency: 'eur' as const, exchange: 'AMS' };
  const london = { symbol: 'IVSI', providerSymbol: 'IGDA.L', assetClass: 'etf' as const, nativeCurrency: 'usd' as const, exchange: 'LSE' };
  expect(resolveEodhdMapping(amsterdam, [listing('ASML', 'AS', 'EUR')]).providerSymbol).toBe('ASML.AS');
  expect(resolveEodhdMapping(london, [listing('IGDA', 'LSE', 'USD', 'ETF')]).providerSymbol).toBe('IGDA.LSE');
  expect(() => resolveEodhdMapping({ ...london, nativeCurrency: 'eur' }, [listing('IGDA', 'LSE', 'EUR', 'ETF')])).toThrow();
  expect(() => resolveEodhdMapping({ ...apple, exchange: 'PAR', providerSymbol: 'AAPL.PA' }, [listing('AAPL', 'PA')])).toThrow();
});

test('preserves raw OHLC, adjusted close and split-adjusted volume with truthful checked coverage', () => {
  const mapping = resolveEodhdMapping(apple, [listing()]);
  const parsed = parseEodhdDaily(bars, mapping, {
    requested: { from: '2021-11-07', to: '2026-11-06' },
    checked: { from: '2025-11-07', to: '2026-11-06' }, historyYears: 1,
  }, NOW);
  expect(parsed).toMatchObject({
    providerId: 'eodhd_personal_daily', adjustment: 'raw_unadjusted', volumeAdjustment: 'splits',
    bars: [{ close: 104, adjustedClose: 93.5, volume: 1000 }, { close: 105, adjustedClose: 94.4, volume: 2000 }],
    coverage: { limited: true, historyYears: 1, available: { from: '2026-11-05', to: '2026-11-06' } },
  });
  expect(() => parseEodhdDaily([{ ...bars[0], date: '2026-02-30' }], mapping, {
    requested: { from: '2026-01-01', to: '2026-11-06' }, checked: { from: '2026-01-01', to: '2026-11-06' }, historyYears: 1,
  }, NOW)).toThrow();
  expect(() => parseEodhdDaily([{ ...bars[0], high: 99 }], mapping, {
    requested: { from: '2026-11-01', to: '2026-11-06' }, checked: { from: '2026-11-01', to: '2026-11-06' }, historyYears: 1,
  }, NOW)).toThrow();
});

test('fetches fixed-host search before candles and clamps free depth without losing source dates', async () => {
  const result = await fetchEodhdPersonalHistory({ key: KEY, owner, instrument: sap,
    range: { from: '2021-11-07', to: '2026-11-07' }, historyYears: 1 });
  expect(result.coverage.checked).toEqual({ from: '2025-11-07', to: '2026-11-06' });
  expect(result.coverage.requested).toEqual({ from: '2021-11-07', to: '2026-11-07' });
  const urls = jest.mocked(global.fetch).mock.calls.map(call => new URL(String(call[0])));
  expect(urls.map(url => url.origin)).toEqual(['https://eodhd.com', 'https://eodhd.com']);
  expect(urls.map(url => url.pathname)).toEqual(['/api/search/SAP', '/api/eod/SAP.XETRA']);
  expect(urls[1].searchParams.get('from')).toBe('2025-11-07');
  expect(urls[1].searchParams.get('api_token')).toBe(KEY);
  expect(JSON.stringify(result)).not.toContain(KEY);
});

test('accepts the core five-year boundary before yesterday while reporting the provider entitlement clamp', async () => {
  jest.mocked(Date.now).mockReturnValue(Date.UTC(2026, 10, 10, 12));
  const result = await fetchEodhdPersonalHistory({ key: KEY, owner, instrument: apple,
    range: { from: '2021-11-09', to: '2026-11-09' }, historyYears: 5 });
  expect(result.coverage).toMatchObject({
    requested: { from: '2021-11-09', to: '2026-11-09' },
    checked: { from: '2021-11-10', to: '2026-11-09' }, historyYears: 5, limited: true,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('history identity mismatch fails before candles and bounded old entitled history stays usable', async () => {
  global.fetch = jest.fn(async () => Response.json([listing('AAPL', 'US', 'EUR')]));
  await expect(fetchEodhdPersonalHistory({ key: KEY, owner, instrument: apple,
    range: { from: '2026-11-01', to: '2026-11-06' }, historyYears: 1 })).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const old = [{ ...bars[0], date: '2022-01-03' }];
  global.fetch = jest.fn(async url => String(url).includes('/search/') ? Response.json([listing()]) : Response.json(old));
  const result = await fetchEodhdPersonalHistory({ key: KEY, owner: owner + '-old', instrument: apple,
    range: { from: '2022-01-01', to: '2022-01-31' }, historyYears: 5 });
  expect(result.bars[0].date).toBe('2022-01-03');
  expect(result.coverage.limited).toBe(false);
});

test.each([402, 403, 429])('preserves upstream %s and cooldown without exposing the token or retrying', async status => {
  global.fetch = jest.fn(async () => Response.json({ error: KEY }, { status, headers: { 'Retry-After': '180' } }));
  const action = () => verifyEodhdPersonalKey({ key: KEY, owner, historyYears: 1 });
  await expect(action()).rejects.toMatchObject({ status, retryAfterSeconds: 180 });
  await expect(action()).rejects.toBeInstanceOf(EodhdUpstreamError);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await action().catch(error => expect(String(error)).not.toContain(KEY));
});

test('enforces 20 actual upstream requests per owner even when reconnecting', async () => {
  for (let i = 0; i < 20; i++) await verifyEodhdPersonalKey({ key: KEY, owner, historyYears: 1 });
  await expect(verifyEodhdPersonalKey({ key: KEY + '-rotated', owner, historyYears: 1 })).rejects.toMatchObject({ status: 429 });
  expect(global.fetch).toHaveBeenCalledTimes(20);
});

test('rejects malformed, over-five-year or out-of-range history without upstream requests', async () => {
  for (const range of [{ from: '2020-11-01', to: '2026-11-06' }, { from: '2026-02-30', to: '2026-11-06' }, { from: '2026-11-07', to: '2026-11-06' }]) {
    await expect(fetchEodhdPersonalHistory({ key: KEY, owner, instrument: apple, range, historyYears: 5 })).rejects.toThrow();
  }
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = jest.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Length': '2097153' } }));
  await expect(verifyEodhdPersonalKey({ key: KEY, owner, historyYears: 1 })).rejects.toThrow();
});

test('never reports an impossible checked interval for wholly unavailable free history', async () => {
  await expect(fetchEodhdPersonalHistory({ key: KEY, owner, instrument: apple,
    range: { from: '2022-01-01', to: '2022-01-31' }, historyYears: 1 })).rejects.toThrow(/depth|outside|entitle/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('does not expose provider URLs from network exceptions or accept unfinished/out-of-range candles', async () => {
  global.fetch = jest.fn(async () => { throw new Error('upstream failed https://eodhd.com/api/search/AAPL?api_token=' + KEY); });
  await verifyEodhdPersonalKey({ key: KEY, owner, historyYears: 1 }).catch(error => expect(String(error)).not.toContain(KEY));
  const mapping = resolveEodhdMapping(apple, [listing()]);
  const coverage = { requested: { from: '2026-11-01', to: '2026-11-06' }, checked: { from: '2026-11-01', to: '2026-11-06' }, historyYears: 1 as const };
  for (const row of [{ ...bars[0], date: '2026-11-07' }, { ...bars[0], date: '2026-10-30' }, { ...bars[0], adjusted_close: -1 }, { ...bars[0], volume: 0.5 }]) {
    expect(() => parseEodhdDaily([row], mapping, coverage, NOW)).toThrow();
  }
});

test('detects oversized streamed bodies without trusting content-length', async () => {
  global.fetch = jest.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close();
  } }), { headers: { 'Content-Type': 'application/json' } }));
  await expect(verifyEodhdPersonalKey({ key: KEY, owner, historyYears: 1 })).rejects.toThrow(/bounded|large/i);
});
