import { SUPPORTED_ASSETS } from '@/lib/config/supported-assets';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { fetchPublicCoinPaprikaSpot } from '@/lib/financial-data/providers/public-coinpaprika-spot';
import { fetchPublicCoinGeckoSpot } from '@/lib/financial-data/providers/public-coingecko-spot';
import { fetchPublicMetalSpot } from '@/lib/financial-data/providers/public-gold-spot';
import { loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  hasTiingoBrowserCredential: () => false, supportsTiingoBrowserAsset: () => false,
}));
jest.mock('@/lib/financial-data/providers/public-coinpaprika-spot', () => ({ fetchPublicCoinPaprikaSpot: jest.fn() }));
jest.mock('@/lib/financial-data/providers/public-coingecko-spot', () => ({ fetchPublicCoinGeckoSpot: jest.fn() }));
jest.mock('@/lib/financial-data/providers/public-gold-spot', () => ({ fetchPublicMetalSpot: jest.fn() }));
jest.mock('@/lib/financial-data/providers/public-crypto-spot', () => ({ fetchPublicCryptoSpot: async () => null }));
jest.mock('@/lib/financial-data/providers/yahoo-personal', () => ({
  supportsYahooPersonalAsset: (s: string) => ['stock', 'etf'].includes(SUPPORTED_ASSETS.find(a => a.symbol === s)?.assetClass ?? ''),
  loadYahooPersonalDailySeries: jest.fn(),
}));

const original = { window: globalThis.window, fetch: global.fetch };
const owner = 'coverage-owner';
const time = new Date().toISOString();
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const pap = jest.mocked(fetchPublicCoinPaprikaSpot), gecko = jest.mocked(fetchPublicCoinGeckoSpot);
const metals = jest.mocked(fetchPublicMetalSpot), yahoo = jest.mocked(loadYahooPersonalDailySeries);

async function current(symbols: string[], currency = 'usd') {
  const result = await handlePersonalBrowserMarketRequest(`/api/prices/current?symbols=${symbols.join(',')}&currency=${currency}`, {}, owner);
  return result!.json();
}
beforeAll(() => {
  const events = new EventTarget(); const values = new Map<string, string>();
  Object.assign(events, { location: new URL('https://private.example'), localStorage: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
});
beforeEach(() => {
  resolveBrowserWorkspace(owner); clearPublicSourceConsent();
  setPublicSourceConsent(owner, ['yahoo', 'spot', 'coinpaprika', 'coingecko']);
  saveSourceSelection(owner, { ...readSourceSelection(owner), publicFirst: true, yahoo: true, spot: true, coinpaprika: true, coingecko: true, fx: true });
  pap.mockReset().mockImplementation(async symbol => ({ providerId: 'coinpaprika_public', symbol, priceUsdPerCoin: 100, observedAt: time, retrievedAt: time }));
  gecko.mockReset().mockImplementation(async symbol => ({ providerId: 'coingecko_public', symbol, priceUsdPerCoin: 101, observedAt: time, retrievedAt: time }));
  metals.mockReset().mockImplementation(async symbol => ({ symbol, priceUsdPerTroyOunce: symbol === 'GOLD' ? 3500 : 40, observedAt: time, retrievedAt: time }));
  yahoo.mockReset().mockImplementation(async (_owner, symbol) => {
    const asset = SUPPORTED_ASSETS.find(a => a.symbol === symbol)!;
    return { providerId: 'yahoo_personal_daily', assetSymbol: symbol, providerSymbol: asset.yahooSymbol!,
      exchange: asset.nativeCurrency === 'eur' ? 'GER' : 'NMS', assetClass: asset.assetClass as 'stock' | 'etf',
      listingCurrency: asset.nativeCurrency.toUpperCase() as 'USD' | 'EUR', retrievedAt: time, latestObservationAt: day, cacheStatus: 'miss',
      bars: [{ date: day, open: 98, high: 102, low: 97, close: 99, volume: 10 }],
      current: { price: 102, observedAt: time },
    };
  });
  global.fetch = jest.fn(async () => Response.json({}));
});
afterAll(() => { clearPublicSourceConsent(); global.fetch = original.fetch; Object.defineProperty(globalThis, 'window', { configurable: true, value: original.window }); });

test('all 49 catalog instruments have an explicit keyless price route in their native fiat currency', async () => {
  expect(SUPPORTED_ASSETS).toHaveLength(49);
  const seen = new Set<string>();
  for (const asset of SUPPORTED_ASSETS) {
    const result = await current([asset.symbol], asset.nativeCurrency);
    const quote = result.prices[asset.symbol];
    expect(quote).toBeDefined();
    expect(quote.fields.assetId).toBe(asset.symbol);
    expect(quote.currency).toBe(asset.nativeCurrency);
    expect(quote.realtime).toBe(false);
    expect(result.refreshPolicy).toBe('manual_only');
    seen.add(asset.symbol);
  }
  expect(seen.size).toBe(49);
});

test('an unsupported imported holding cannot suppress compatible prices in the same batch', async () => {
  const result = await current(['AAPL', 'UNRESOLVED.STOCK', 'X'.repeat(64)]);
  expect(result.prices.AAPL.price).toBe(102);
  expect(result.prices['UNRESOLVED.STOCK']).toBeUndefined();
  expect(result.issues.map((issue: {symbol:string}) => issue.symbol).sort()).toEqual(['UNRESOLVED.STOCK', 'X'.repeat(64)].sort());
});

test.each(['eur', 'usd'])('all catalog prices can use %s display with sourced ECB conversions', async currency => {
  global.fetch = jest.fn(async () => Response.json({ data: {
    baseCurrency: 'USD', quoteCurrency: 'EUR', rate: { status: 'available', value: 0.85, freshness: 'fresh',
      observedAt: time, asOf: day, provenance: { providerId: 'ecb_reference_rates', providerName: 'ECB', retrievedAt: time } },
  } }));
  for (let offset = 0; offset < SUPPORTED_ASSETS.length; offset += 25) {
    const symbols = SUPPORTED_ASSETS.slice(offset, offset + 25).map(a => a.symbol);
    const result = await current(symbols, currency);
    expect(Object.keys(result.prices).sort()).toEqual([...symbols].sort());
    for (const quote of Object.values(result.prices) as Array<{ price: number; currency: string }>) {
      expect(quote.price).toBeGreaterThan(0); expect(quote.currency).toBe(currency);
    }
  }
});

test('CoinGecko is an independently approved fallback after CoinPaprika fails, with its own source and time', async () => {
  pap.mockResolvedValue(null);
  const result = await current(['SOL', 'RENDER']);
  expect(result.prices.SOL).toMatchObject({ price: 101, priceTiming: 'delayed', source: 'CoinGecko (personal-use public USD spot)' });
  expect(result.prices.RENDER.fields.price).toMatchObject({ observedAt: time, provenance: { providerId: 'coingecko_public' } });
  expect(gecko).toHaveBeenCalledTimes(2);
  clearPublicSourceConsent(); setPublicSourceConsent(owner, ['coinpaprika']);
  expect((await current(['SOL'])).status).toBe('unavailable');
  expect(gecko).toHaveBeenCalledTimes(2);
});

test('MATIC stays unavailable when neither source supplies a valid exact observation', async () => {
  pap.mockResolvedValue(null); gecko.mockResolvedValue(null);
  const result = await current(['MATIC']);
  expect(result.prices).toEqual({});
  expect(result.status).toBe('unavailable');
  expect(gecko).toHaveBeenCalledWith('MATIC', undefined);
});

test('physical silver uses fine troy ounces and never falls back to a token or future', async () => {
  const result = await current(['SILVER']);
  expect(result.prices.SILVER).toMatchObject({ price: 40, instrumentType: 'metal', fields: { assetId: 'SILVER', listingCurrency: 'USD' } });
  expect(result.prices.SILVER.fields.price.provenance.method).toContain('troy ounce');
  expect(metals).toHaveBeenCalledWith('SILVER', undefined);
  metals.mockResolvedValue(null);
  expect((await current(['SILVER'])).prices).toEqual({});
  expect(pap).not.toHaveBeenCalled(); expect(gecko).not.toHaveBeenCalled(); expect(yahoo).not.toHaveBeenCalled();
});

test('Yahoo current metadata is distinct from the completed daily close and drops unrelated EOD volume', async () => {
  const result = await current(['AAPL']);
  expect(result.prices.AAPL).toMatchObject({ price: 102, priceTiming: 'delayed', volume24h: null, source: 'Yahoo Finance (personal research market quote)' });
  expect(result.prices.AAPL.fields.price).toMatchObject({ observedAt: time, provenance: { providerId: 'yahoo_personal_market' } });
  expect(result.prices.AAPL.fields.volume.status).toBe('unavailable');
});

test('missing FX fails USD sources closed while native EUR Yahoo can continue', async () => {
  expect((await current(['SILVER', 'SOL'], 'eur')).prices).toEqual({});
  expect(metals).not.toHaveBeenCalled(); expect(pap).not.toHaveBeenCalled(); expect(gecko).not.toHaveBeenCalled();
  expect((await current(['ISWD'], 'eur')).prices.ISWD.price).toBe(102);
});

test('a native EUR listing converts safely to USD using the inverse sourced ECB reference', async () => {
  global.fetch = jest.fn(async () => Response.json({ data: {
    baseCurrency: 'USD', quoteCurrency: 'EUR', rate: { status: 'available', value: 0.85, freshness: 'fresh',
      observedAt: time, asOf: day, provenance: { providerId: 'ecb_reference_rates', providerName: 'ECB', retrievedAt: time } },
  } }));
  const result = await current(['ISWD'], 'usd');
  expect(result.prices.ISWD.price).toBeCloseTo(120);
  expect(result.prices.ISWD.fields).toMatchObject({ listingCurrency: 'EUR', outputCurrency: 'USD', price: {
    quality: 'calculated', observedAt: time, provenance: { derivedFrom: [{ providerId: 'yahoo_personal_market' }, { providerId: 'ecb_reference_rates' }] },
  } });
  saveSourceSelection(owner, { ...readSourceSelection(owner), fx: false });
  expect((await current(['ISWD'], 'usd')).prices).toEqual({});
});

test('EUR-native history converts each bar with date-aligned inverse FX and preserves its native source currency', async () => {
  global.fetch = jest.fn(async () => Response.json({ status:'complete', sourceAttribution:'Source: ECB statistics.', data: [{ date: day, asOf: day, rate: 0.9 }] }));
  const response = await handlePersonalBrowserMarketRequest('/api/prices/history?symbol=ISWD&currency=usd&interval=1d', {}, owner);
  const result = await response!.json();
  expect(result.prices[0]).toMatchObject({ date: day, close: 110, priceQuality: 'calculated',
    conversion: { sourceCurrency: 'EUR', rate: 1 / 0.9, asOf: day, sourceRef: 'fx_1' } });
  expect(result.sources[1].providerId).toBe('ecb_reference_rates');
});

test('revoking and reapproving consent while a fallback is pending cannot release it', async () => {
  pap.mockResolvedValue(null);
  let finish!: (value: Awaited<ReturnType<typeof fetchPublicCoinGeckoSpot>>) => void;
  gecko.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const task = current(['SOL']);
  for (let n = 0; n < 8 && !finish; n++) await Promise.resolve();
  expect(finish).toBeDefined();
  clearPublicSourceConsent(); setPublicSourceConsent(owner, ['coingecko']);
  finish({ providerId: 'coingecko_public', symbol: 'SOL', priceUsdPerCoin: 101, observedAt: time, retrievedAt: time });
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
});
