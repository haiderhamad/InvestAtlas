import { clearMarketData, connectMarketData, loadMarketDataMidpoints, parseMarketDataMidpoints } from '@/lib/financial-data/providers/marketdata-personal';
import * as discovery from '@/lib/financial-data/providers/yahoo-personal-discovery';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
let mockOwner = '';
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => ({ userId: mockOwner, token: 'test-owner-session' }) }));
const hasAttestation = (discovery as typeof discovery & { hasYahooPersonalListingAttestation: (owner: string, input: unknown) => boolean }).hasYahooPersonalListingAttestation;
const NOW = Date.UTC(2026, 10, 6, 19);
const KEY = 'test-marketdata-owner-secret';
const current = { s: 'ok', symbol: ['IBM'], mid: [200], updated: [(NOW - 30_000) / 1000] };
const listing = { version: 1 as const, symbol: 'IBM', providerSymbol: 'IBM', name: 'IBM', assetClass: 'stock' as const,
  nativeCurrency: 'usd' as const, exchange: 'NYQ', source: 'yahoo_chart' as const, resolvedAt: '2026-11-06T19:00:00.000Z' };
const oldWindow = globalThis.window;
const oldFetch = global.fetch;
beforeAll(() => {
  const view = new EventTarget();
  Object.assign(view, { location: new URL('https://private.example'), localStorage: { getItem: () => null, setItem: () => {} } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
});
beforeEach(async () => {
  mockOwner = 'marketdata-attestation-' + Math.random().toString(16).slice(2);
  resolveBrowserWorkspace(mockOwner);
  clearPublicSourceConsent();
  discovery.clearYahooPersonalDiscoverySession();
  clearMarketData();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = jest.fn(async () => Response.json({ s: 'ok', t: [(NOW - 86400000) / 1000], o: [100], h: [110], l: [90], c: [105], v: [100] }));
  await connectMarketData(mockOwner, KEY);
});
afterEach(() => { clearMarketData(); clearPublicSourceConsent(); jest.restoreAllMocks(); global.fetch = oldFetch; });
afterAll(() => { Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow }); });

test('imported metadata alone cannot authorize a custom USD midpoint or send the user key', async () => {
  global.fetch = jest.fn(async () => Response.json(current));
  await expect(loadMarketDataMidpoints(mockOwner, [listing])).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(hasAttestation(mockOwner, listing)).toBe(false);
});

test('a failed custom attestation leaves independently known static prices available', async () => {
  global.fetch = jest.fn(async () => Response.json({ ...current, symbol: ['AAPL'] }));
  expect(await loadMarketDataMidpoints(mockOwner, ['AAPL', listing])).toMatchObject([{ assetSymbol: 'AAPL', priceUsd: 200 }]);
  expect(new URL(String(jest.mocked(global.fetch).mock.calls[0][0])).searchParams.get('symbols')).toBe('AAPL');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('consented exact Yahoo resolution must precede a custom MarketData request and receives no MarketData credential', async () => {
  setPublicSourceConsent(mockOwner, ['yahoo']);
  global.fetch = jest.fn(async input => String(input).includes('/yahoo/') ? Response.json({ instrument: listing }) : Response.json(current));
  expect(await loadMarketDataMidpoints(mockOwner, [listing])).toMatchObject([{ assetSymbol: 'IBM', priceUsd: 200 }]);
  expect(hasAttestation(mockOwner, listing)).toBe(true);
  const [metadata, prices] = jest.mocked(global.fetch).mock.calls;
  expect(metadata[0]).toBe('/api/financial-data/yahoo/personal-resolve');
  expect(new Headers(metadata[1]?.headers).get('authorization')).toBe('Bearer test-owner-session');
  expect(JSON.stringify(metadata)).not.toContain(KEY);
  expect(new Headers(prices[1]?.headers).get('authorization')).toBe('Bearer ' + KEY);
});

test('another currency, class or venue cannot attest the imported hint and cannot poison static observations', async () => {
  setPublicSourceConsent(mockOwner, ['yahoo']);
  for (const changed of [{ nativeCurrency: 'eur' }, { assetClass: 'etf' }, { exchange: 'NMS' }]) {
    discovery.clearYahooPersonalDiscoverySession();
    global.fetch = jest.fn(async input => String(input).includes('/yahoo/')
      ? Response.json({ instrument: { ...listing, ...changed } }) : Response.json({ ...current, symbol: ['AAPL'] }));
    expect(await loadMarketDataMidpoints(mockOwner, ['AAPL', listing])).toMatchObject([{ assetSymbol: 'AAPL' }]);
    expect(new URL(String(jest.mocked(global.fetch).mock.calls.at(-1)![0])).searchParams.get('symbols')).toBe('AAPL');
    expect(hasAttestation(mockOwner, listing)).toBe(false);
  }
});

test('the parser requires current owner/session attestation instead of treating CSV hints as verification', async () => {
  setPublicSourceConsent(mockOwner, ['yahoo']);
  global.fetch = jest.fn(async () => Response.json({ instrument: listing }));
  const parse = parseMarketDataMidpoints as (payload: unknown, inputs: typeof listing[], now: number, owner: string) => unknown;
  expect(() => parse(current, [listing], NOW, mockOwner)).toThrow();
  await discovery.resolveYahooPersonalListing(mockOwner, 'IBM');
  expect(parse(current, [listing], NOW, mockOwner)).toMatchObject([{ assetSymbol: 'IBM', priceUsd: 200 }]);
  clearPublicSourceConsent(); setPublicSourceConsent(mockOwner, ['yahoo']);
  expect(hasAttestation(mockOwner, listing)).toBe(false);
  expect(() => parse(current, [listing], NOW, mockOwner)).toThrow();
  await discovery.resolveYahooPersonalListing(mockOwner, 'IBM');
  saveSourceSelection(mockOwner, { ...readSourceSelection(mockOwner), yahoo: false });
  expect(hasAttestation(mockOwner, listing)).toBe(false);
  resolveBrowserWorkspace(mockOwner + '-other');
  expect(() => parse(current, [listing], NOW, mockOwner)).toThrow();
});
