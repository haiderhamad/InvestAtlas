import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { loadPublicExchangeSeries } from '@/lib/financial-data/providers/public-exchange-browser';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/financial-data/providers/public-exchange-browser', () => ({
  loadPublicExchangeSeries: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  hasTiingoBrowserCredential: jest.fn(() => false),
  loadTiingoBrowserDailySeries: jest.fn(),
  supportsTiingoBrowserAsset: (symbol: string) => ['AAPL', 'BTC', 'ETH'].includes(symbol),
}));

const DAY = 86_400_000;
const day = new Date(Math.floor(Date.now() / DAY) * DAY - DAY).toISOString().slice(0, 10);
const bars = [{ date: day, open: 95, high: 105, low: 90, close: 100, volume: 12.5 }];
const fetchExchange = jest.mocked(loadPublicExchangeSeries);
const oldWindow = globalThis.window;
const oldFetch = global.fetch;
let ownerCounter = 0;
let owner = '';

async function read(path: string) {
  const r = await handlePersonalBrowserMarketRequest('/api/prices/' + path, {}, owner);
  if (!r) throw new Error('Personal market interception missing');
  return r.json();
}

beforeAll(() => {
  const target = new EventTarget();
  const storage = new Map<string, string>();
  Object.assign(target, { location: new URL('https://private.example'), localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
});
beforeEach(() => {
  owner = 'public-exchange-owner-' + (++ownerCounter);
  resolveBrowserWorkspace(owner);
  clearPublicSourceConsent();
  setPublicSourceConsent(owner, ['binance', 'kraken']);
  fetchExchange.mockReset().mockImplementation(async provider => ({
    providerId: provider === 'binance' ? 'binance_public_daily' : 'kraken_public_daily',
    assetSymbol: 'BTC',
    providerSymbol: provider === 'binance' ? 'BTCEUR' : 'XXBTZUSD',
    listingCurrency: provider === 'binance' ? 'EUR' : 'USD',
    retrievedAt: new Date().toISOString(), latestObservationAt: day,
    cacheStatus: 'miss', bars,
  }));
  global.fetch = jest.fn(async () => { throw Error('Unexpected external FX request'); });
});
afterAll(() => {
  global.fetch = oldFetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
});

test('a previous exchange preference cannot bypass this login consent', async () => {
  clearPublicSourceConsent();
  saveSourceSelection(owner, { ...readSourceSelection(owner), binance: true, kraken: true });
  const result = await read('history?symbol=BTC&currency=eur&interval=1d');
  expect(result.status).toBe('unavailable');
  expect(fetchExchange).not.toHaveBeenCalled();
});

test('opted-in Binance BTC/EUR supplies a real EUR history and current quote without ECB conversion', async () => {
  saveSourceSelection(owner, { ...readSourceSelection(owner), spot: false, kraken: false, binance: true, fx: false });
  const h = await read('history?symbol=BTC&currency=eur&interval=1d');
  expect(h).toMatchObject({ status: 'partial', currency: 'eur', dataMode: 'public_market_api' });
  expect(h.prices).toHaveLength(1);
  expect(h.prices[0]).toMatchObject({ close: 100, priceQuality: 'observed' });
  expect(h.sources).toContainEqual(expect.objectContaining({ providerId: 'binance_public_daily', kind: 'market' }));
  expect(h.sources).not.toContainEqual(expect.objectContaining({ providerId: 'ecb_reference_rates' }));
  const quote = await read('current?symbols=BTC&currency=eur');
  expect(quote.prices.BTC).toMatchObject({ price: 100, currency: 'eur', source: expect.stringContaining('Binance') });
  expect(fetchExchange).toHaveBeenCalledWith('binance', owner, 'BTC', expect.any(AbortSignal));
  expect(global.fetch).not.toHaveBeenCalled();
});

test('opted-in Kraken BTC/USD supplies native USD history without disguising USDT as USD', async () => {
  saveSourceSelection(owner, { ...readSourceSelection(owner), spot: false, binance: false, kraken: true });
  const h = await read('history?symbol=BTC&currency=usd&interval=1d');
  expect(h.prices).toHaveLength(1);
  expect(h.prices[0]).toMatchObject({ close: 100, priceQuality: 'observed' });
  expect(h.sources).toContainEqual(expect.objectContaining({ providerId: 'kraken_public_daily' }));
  expect(fetchExchange).toHaveBeenCalledWith('kraken', owner, 'BTC', expect.any(AbortSignal));
});

test('provider can be disabled and cannot masquerade as an AAPL or ISWD stock/ETF source', async () => {
  saveSourceSelection(owner, { ...readSourceSelection(owner), spot: false, binance: true, kraken: true, fx: false });
  expect((await read('history?symbol=AAPL&currency=usd&interval=1d')).status).toBe('unavailable');
  expect((await read('history?symbol=ISWD&currency=eur&interval=1d')).status).toBe('unavailable');
  expect(fetchExchange).not.toHaveBeenCalled();
  saveSourceSelection(owner, { ...readSourceSelection(owner), binance: false, kraken: false });
  expect((await read('history?symbol=BTC&currency=usd&interval=1d')).status).toBe('unavailable');
  expect(fetchExchange).not.toHaveBeenCalled();
});

test('explicit public Twelve Data sample supplies AAPL demo history without an owner key, but never portfolio quotes or ISWD', async () => {
  const opts = { ...readSourceSelection(owner), spot: false, binance: false, kraken: false, twelveDemo: true } as ReturnType<typeof readSourceSelection>;
  saveSourceSelection(owner, opts);
  const lastDay = new Date(Math.floor(Date.now() / DAY) * DAY - DAY).toISOString().slice(0, 10);
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.twelvedata.com');
    expect(url.pathname).toBe('/time_series');
    expect(url.searchParams.get('symbol')).toBe('AAPL');
    expect(new Headers(init?.headers).get('authorization')).toBe('apikey demo');
    return Response.json({ meta: { symbol: 'AAPL', exchange: 'NASDAQ', mic_code: 'XNGS', currency: 'USD', interval: '1day' },
      values: [{ datetime: lastDay, open: '95', high: '105', low: '90', close: '100', volume: '1200' }] });
  });
  const h = await read('history?symbol=AAPL&currency=usd&interval=1d');
  expect(h).toMatchObject({ status: 'partial', dataMode: 'public_market_api', prices: [{ close: 100 }] });
  expect(h.sources).toContainEqual(expect.objectContaining({ providerId: 'twelve_demo_daily' }));
  expect(h.warnings.join(' ')).toMatch(/demo|sample/i);
  expect((await read('current?symbols=AAPL&currency=usd')).status).toBe('unavailable');
  expect((await read('history?symbol=ISWD&currency=eur&interval=1d')).status).toBe('unavailable');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('if opted-in Binance has no EUR candle, Kraken USD is fallback only with date-aligned ECB conversion', async () => {
  saveSourceSelection(owner, { ...readSourceSelection(owner), spot: false, binance: true, kraken: true, fx: true });
  fetchExchange.mockImplementation(async provider => {
    if (provider === 'binance') throw new Error('Temporary Binance endpoint failure');
    return { providerId: 'kraken_public_daily', assetSymbol: 'BTC', providerSymbol: 'XXBTZUSD',
      listingCurrency: 'USD', retrievedAt: new Date().toISOString(), latestObservationAt: day,
      cacheStatus: 'miss', bars };
  });
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toContain('/api/financial-data/fx/history');
    return Response.json({ status:'complete', sourceAttribution:'Source: ECB statistics.', data: [{ date: day, asOf: day, rate: 0.9 }] });
  });
  const history = await read('history?symbol=BTC&currency=eur&interval=1d');
  expect(history.prices[0].close).toBe(90);
  expect(history.prices[0].conversion).toMatchObject({ sourceCurrency: 'USD', rate: 0.9 });
  expect(history.sources).toContainEqual(expect.objectContaining({ providerId: 'kraken_public_daily' }));
  expect(fetchExchange).toHaveBeenNthCalledWith(1, 'binance', owner, 'BTC', expect.any(AbortSignal));
  expect(fetchExchange).toHaveBeenNthCalledWith(2, 'kraken', owner, 'BTC', expect.any(AbortSignal));
});
