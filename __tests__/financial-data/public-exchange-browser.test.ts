import { parseBinanceDaily, parseKrakenDaily, loadPublicExchangeSeries } from '@/lib/financial-data/providers/public-exchange-browser';
import { marketSourceOrder, readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 2, 12);
const yesterday = Date.UTC(2026, 10, 1);
const today = Date.UTC(2026, 10, 2);
const binanceRow = (at: number, close = '100'): unknown[] =>
  [at, '95', '105', '90', close, '12.5', at + DAY - 1, '1000', 1, '4', '10', '0'];
const krakenRow = (at: number, close = '100'): unknown[] =>
  [at / 1000, '95', '105', '90', close, '98', '12.5', 10];

describe('opt-in keyless public market sources', () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;

  beforeAll(() => {
    const windowLike = new EventTarget();
    const store = new Map<string, string>();
    Object.assign(windowLike, {
      location: new URL('https://invest-atlas-owner-test.vercel.app'),
      localStorage: {
        getItem: (name: string) => store.get(name) ?? null,
        setItem: (name: string, value: string) => { store.set(name, value); },
      },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowLike });
  });

  afterEach(() => { global.fetch = originalFetch; });
  afterAll(() => {
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  test('does not contact exchanges by default; user can enable each independently and persist order per owner', () => {
    resolveBrowserWorkspace('keyless-owner');
    const initial = readSourceSelection('keyless-owner');
    expect(marketSourceOrder(initial)).not.toContain('binance');
    expect(marketSourceOrder(initial)).not.toContain('kraken');
    saveSourceSelection('keyless-owner', { ...initial, binance: true });
    expect(marketSourceOrder(readSourceSelection('keyless-owner'))).toContain('binance');
    expect(marketSourceOrder(readSourceSelection('keyless-owner'))).not.toContain('kraken');
    saveSourceSelection('keyless-owner', { ...readSourceSelection('keyless-owner'), kraken: true });
    expect(marketSourceOrder(readSourceSelection('keyless-owner'))).toContain('kraken');
    expect(marketSourceOrder(readSourceSelection('someone-else'))).not.toContain('binance');
  });

  test('validates Binance completed EUR crypto candles without mistaking EUR for USD or including the current day', () => {
    const parsed = parseBinanceDaily([binanceRow(yesterday), binanceRow(today)], 'BTC', now);
    expect(parsed).toMatchObject({ providerId: 'binance_public_daily', assetSymbol: 'BTC', listingCurrency: 'EUR' });
    expect(parsed.bars).toHaveLength(1);
    expect(parsed.bars[0].close).toBe(100);
    expect(() => parseBinanceDaily([binanceRow(yesterday)], 'AAPL', now)).toThrow();
    expect(() => parseBinanceDaily([binanceRow(yesterday, 'NaN')], 'BTC', now)).toThrow();
    expect(() => parseBinanceDaily([binanceRow(Date.UTC(2022, 1, 1))], 'BTC', now)).toThrow();
  });

  test('validates exact Kraken USD pair; rejects exchange errors, duplicate or malformed candles', () => {
    const payload = { error: [], result: { XXBTZUSD: [krakenRow(yesterday), krakenRow(today)], last: '123' } };
    const parsed = parseKrakenDaily(payload, 'BTC', now);
    expect(parsed).toMatchObject({ providerId: 'kraken_public_daily', assetSymbol: 'BTC', listingCurrency: 'USD' });
    expect(parsed.bars).toHaveLength(1);
    expect(() => parseKrakenDaily({ ...payload, error: ['EGeneral:Busy'] }, 'BTC', now)).toThrow();
    expect(() => parseKrakenDaily({ error: [], result: { XETHZUSD: [krakenRow(yesterday)] } }, 'BTC', now)).toThrow();
    expect(() => parseKrakenDaily({ error: [], result: { XXBTZUSD: [krakenRow(yesterday), krakenRow(yesterday)] } }, 'BTC', now)).toThrow();
  });

  test('uses fixed keyless browser endpoints and never a user-chosen URL, credential, or authentication header', async () => {
    resolveBrowserWorkspace('exchange-owner');
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://data-api.binance.vision');
      expect(url.pathname).toBe('/api/v3/klines');
      expect(url.searchParams.get('symbol')).toBe('BTCEUR');
      expect(url.searchParams.get('interval')).toBe('1d');
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return new Response(JSON.stringify([binanceRow(Math.floor(Date.now() / DAY) * DAY - DAY)]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    global.fetch = fetchMock;
    const series = await loadPublicExchangeSeries('binance', 'exchange-owner', 'BTC');
    expect(series.listingCurrency).toBe('EUR');
    expect(series.bars).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadPublicExchangeSeries('binance', 'exchange-owner', 'AAPL')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
