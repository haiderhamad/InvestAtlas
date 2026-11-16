import { POST as series } from '@/app/api/local/yahoo/series/route';
import { POST as search } from '@/app/api/local/yahoo/search/route';
import { POST as resolve } from '@/app/api/local/yahoo/resolve/route';
import { POST as aiTest } from '@/app/api/local/ai/test/route';
import { POST as tiingo } from '@/app/api/local/tiingo/series/route';
import { POST as documentImport } from '@/app/api/local/transactions/import/route';
import { fetchYahooPersonalDaily } from '@/lib/financial-data/providers/yahoo-personal-server';
import { requireFirebaseUser } from '@/lib/ai/provider-store';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/financial-data/providers/yahoo-personal-server', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/yahoo-personal-server'),
  fetchYahooPersonalDaily: jest.fn(),
}));
jest.mock('@/lib/ai/provider-store', () => ({
  requireFirebaseUser: jest.fn(),
  ProviderStoreAuthError: class extends Error { status = 401; },
}));

const mode = require('@/lib/runtime/deployment-mode') as { INVESTATLAS_DEPLOYMENT_MODE: string };
const yahoo = jest.mocked(fetchYahooPersonalDaily);
const originalFetch = global.fetch;
const oldOrigin = process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN;
const oldVercel = process.env.VERCEL;
const lan = 'http://192.168.178.26:3000';

function request(path = 'series', origin = lan, headers: Record<string, string> = {}, body: unknown = { symbol: 'ISWD' }) {
  return new Request(origin + '/api/local/yahoo/' + path, {
    method: 'POST', headers: {
      Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin', ...headers,
    }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mode.INVESTATLAS_DEPLOYMENT_MODE = 'local_personal';
  delete process.env.VERCEL;
  process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN = lan;
  globalThis.__investAtlasRateLimits?.clear();
  jest.mocked(requireFirebaseUser).mockClear();
  yahoo.mockReset().mockResolvedValue({
    providerId: 'yahoo_personal_daily', assetSymbol: 'ISWD', providerSymbol: 'IUSD.DE',
    listingCurrency: 'EUR', retrievedAt: '2026-11-08T10:00:00Z', latestObservationAt: '2026-11-06',
    cacheStatus: 'miss', bars: [],
  });
  global.fetch = jest.fn(async input => String(input).includes('/search')
    ? Response.json({ quotes: [{ symbol: 'ADBE', shortname: 'Adobe', quoteType: 'EQUITY', exchange: 'NMS' }] })
    : Response.json({ chart: { result: [{ meta: {
      symbol: 'ADBE', currency: 'USD', instrumentType: 'EQUITY', exchangeName: 'NMS', longName: 'Adobe Inc.',
    } }], error: null } }));
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
afterAll(() => {
  if (oldOrigin === undefined) delete process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN;
  else process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN = oldOrigin;
  if (oldVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = oldVercel;
});

test('serves configured same-origin WLAN ETF prices/history without Firebase or CORS exposure', async () => {
  const response = await series(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ assetSymbol: 'ISWD', listingCurrency: 'EUR' });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  expect(yahoo).toHaveBeenCalledWith('ISWD', expect.any(AbortSignal));
  expect(requireFirebaseUser).not.toHaveBeenCalled();
});

test('supports HTTP Safari requests that omit Fetch Metadata but retain exact Origin and Host', async () => {
  const input = request(); input.headers.delete('sec-fetch-site');
  expect((await series(input)).status).toBe(200);
});

test('supports public instrument discovery through the same explicit WLAN boundary', async () => {
  expect((await search(request('search', lan, {}, { query: 'Adobe' }))).status).toBe(200);
  expect((await resolve(request('resolve', lan, {}, { symbol: 'ADBE' }))).status).toBe(200);
  expect(requireFirebaseUser).not.toHaveBeenCalled();
});

test.each(['http://10.0.0.8:3010', 'http://172.16.0.8:3000', 'http://172.31.255.8:3000'])('supports explicit RFC1918 origin %s', async origin => {
  process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN = origin;
  expect((await series(request('series', origin))).status).toBe(200);
});

test.each([
  undefined, '', '*', 'http://0.0.0.0:3000', 'http://8.8.8.8:3000',
  'http://172.15.0.8:3000', 'http://172.32.0.8:3000', 'http://169.254.1.8:3000',
  'http://owner.local:3000', 'http://[::]:3000', 'https://192.168.178.26:3000',
  lan + '/', lan + '/path', lan + '?a=b', lan + '#hash', lan + ',http://10.0.0.8:3000',
  'http://user:pass@192.168.178.26:3000', ' ' + lan, 'http://0xc0a8b21a:3000',
])('fails closed for absent or invalid LAN configuration %#', async configured => {
  if (configured === undefined) delete process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN;
  else process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN = configured;
  expect((await series(request())).status).toBe(403);
  expect(yahoo).not.toHaveBeenCalled();
});

test.each<Record<string, string>>([
  { Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: lan + '/' },
  { Origin: 'http://192.168.178.26:3001' }, { Host: 'evil.example:3000' },
  { Host: '192.168.178.26:3001' }, { 'Sec-Fetch-Site': 'cross-site' },
  { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' },
  { Authorization: 'Bearer synthetic-not-a-real-token' },
])('denies untrusted WLAN headers %# before any provider access', async headers => {
  expect((await series(request('series', lan, headers))).status).toBe(403);
  expect(yahoo).not.toHaveBeenCalled();
});

test.each(['origin', 'host'])('requires %s even without Fetch Metadata', async header => {
  const input = request();input.headers.delete(header);input.headers.delete('sec-fetch-site');
  expect((await series(input)).status).toBe(403);
  expect(yahoo).not.toHaveBeenCalled();
});

test.each(['http://evil.example:3000', 'http://192.168.178.27:3000', 'http://0.0.0.0:3000', 'http://localhost:3000'])(
  'does not use forwarded or spoofed Host headers to authorize request URL %s', async url => {
    const input = request('series', url, {
      Origin: lan, Host: new URL(lan).host, 'X-Forwarded-Host': new URL(lan).host,
      'X-Forwarded-Proto': 'http', Forwarded: 'host=' + new URL(lan).host,
    });
    expect((await series(input)).status).toBe(403);
    expect(yahoo).not.toHaveBeenCalled();
  },
);

test.each(['public_demo', 'private_cloud', 'legacy'])('never enables local WLAN routes in %s', async deployment => {
  mode.INVESTATLAS_DEPLOYMENT_MODE = deployment;
  expect((await series(request())).status).toBe(403);
  expect((await search(request('search', lan, {}, { query: 'Adobe' }))).status).toBe(403);
  expect(yahoo).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
});

test('never enables local WLAN routes in the Vercel runtime', async () => {
  process.env.VERCEL = '1';
  expect((await series(request())).status).toBe(403);
  expect(yahoo).not.toHaveBeenCalled();
});

test.each([aiTest, tiingo, documentImport])('keeps credential and document routes loopback-only %#', async handler => {
  expect((await handler(request())).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('retains loopback access and one shared minute budget across LAN/loopback and spoofed client IPs', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 8, 11));
  for (let i = 0; i < 24; i++) {
    const origin = i % 2 ? 'http://127.0.0.1:3000' : lan;
    expect((await series(request('series', origin, { 'X-Forwarded-For': '10.1.0.' + i }))).status).toBe(200);
  }
  const limited = await series(request());
  expect(limited.status).toBe(429);expect(limited.headers.get('retry-after')).toBe('60');
  expect(yahoo).toHaveBeenCalledTimes(24);
});
