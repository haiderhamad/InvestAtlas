import { POST as localSearch } from '@/app/api/local/yahoo/search/route';
import { POST as localResolve } from '@/app/api/local/yahoo/resolve/route';
import { POST as privateSearch } from '@/app/api/financial-data/yahoo/personal-search/route';
import { POST as privateResolve } from '@/app/api/financial-data/yahoo/personal-resolve/route';
import { requireFirebaseUser, ProviderStoreAuthError } from '@/lib/ai/provider-store';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/ai/provider-store', () => ({
  requireFirebaseUser: jest.fn(),
  ProviderStoreAuthError: class ProviderStoreAuthError extends Error { status = 401; },
}));

const mode = require('@/lib/runtime/deployment-mode') as { INVESTATLAS_DEPLOYMENT_MODE: string };
const auth = jest.mocked(requireFirebaseUser);
const originalFetch = global.fetch;
const oldOwner = process.env.INVESTATLAS_PRIVATE_OWNER_UID;
const oldVercel = process.env.VERCEL;
const localOrigin = 'http://127.0.0.1:3191';
const privateOrigin = 'https://owner.example';
const payload = { chart: { result: [{ meta: {
  symbol: 'ADBE', currency: 'USD', instrumentType: 'EQUITY', exchangeName: 'NMS', longName: 'Adobe Inc.',
} }], error: null } };

function request(body: unknown, operation: 'search' | 'resolve', origin = localOrigin, headers = {}) {
  return new Request(origin + (origin === localOrigin ? '/api/local/yahoo/' : '/api/financial-data/yahoo/personal-') + operation, {
    method: 'POST', headers: {
      Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin', ...headers,
    }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.VERCEL;
  mode.INVESTATLAS_DEPLOYMENT_MODE = 'local_personal';
  process.env.INVESTATLAS_PRIVATE_OWNER_UID = 'owner-123';
  globalThis.__investAtlasRateLimits?.clear();
  auth.mockReset().mockResolvedValue({ uid: 'owner-123', token: 'synthetic-session' });
  global.fetch = jest.fn(async input => String(input).includes('/search')
    ? Response.json({ quotes: [{ symbol: 'ADBE', shortname: 'Adobe', quoteType: 'EQUITY', exchange: 'NMS' }] })
    : Response.json(payload));
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
afterAll(() => {
  if (oldOwner === undefined) delete process.env.INVESTATLAS_PRIVATE_OWNER_UID;
  else process.env.INVESTATLAS_PRIVATE_OWNER_UID = oldOwner;
  if (oldVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = oldVercel;
});

test('local search and resolve enforce the loopback boundary without Firebase lookup', async () => {
  const found = await localSearch(request({ query: 'Adobe' }, 'search'));
  expect(found.status).toBe(200);
  expect(await found.json()).toEqual({ candidates: [{ symbol: 'ADBE', name: 'Adobe', assetClass: 'stock', exchange: 'NMS' }] });
  const resolved = await localResolve(request({ symbol: 'ADBE' }, 'resolve'));
  expect(resolved.status).toBe(200);
  expect(await resolved.json()).toMatchObject({ instrument: { symbol: 'ADBE', nativeCurrency: 'usd' } });
  expect(resolved.headers.get('cache-control')).toContain('no-store');
  expect(auth).not.toHaveBeenCalled();
});

test.each([
  { Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'Sec-Fetch-Site': 'cross-site' },
])('denies forged local perimeter %# before upstream work', async headers => {
  expect((await localSearch(request({ query: 'Adobe' }, 'search', localOrigin, headers))).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(auth).not.toHaveBeenCalled();
});

test('denies local routing on hosted infrastructure', async () => {
  process.env.VERCEL = '1';
  expect((await localResolve(request({ symbol: 'ADBE' }, 'resolve'))).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('rejects oversized JSON bodies without forwarding any content', async () => {
  const oversized = await localSearch(request({ query: 'A'.repeat(600) }, 'search'));
  expect(oversized.status).toBe(413);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('private routes require the exact authenticated configured owner', async () => {
  mode.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  expect((await privateSearch(request({ query: 'Adobe' }, 'search', privateOrigin))).status).toBe(200);
  expect((await privateResolve(request({ symbol: 'ADBE' }, 'resolve', privateOrigin))).status).toBe(200);
  auth.mockResolvedValue({ uid: 'another-owner', token: 'synthetic-session' });
  expect((await privateSearch(request({ query: 'Adobe' }, 'search', privateOrigin))).status).toBe(403);
  auth.mockRejectedValue(new ProviderStoreAuthError('invalid'));
  expect((await privateResolve(request({ symbol: 'ADBE' }, 'resolve', privateOrigin))).status).toBe(401);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('private perimeter rejects cross-site traffic before token verification', async () => {
  mode.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  expect((await privateSearch(request({ query: 'Adobe' }, 'search', privateOrigin, { Origin: 'https://evil.example' }))).status).toBe(403);
  expect(auth).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['public_demo', 'legacy'])('both perimeters refuse deployment mode %s', async deployment => {
  mode.INVESTATLAS_DEPLOYMENT_MODE = deployment;
  expect((await localSearch(request({ query: 'Adobe' }, 'search'))).status).toBe(403);
  expect((await privateResolve(request({ symbol: 'ADBE' }, 'resolve', privateOrigin))).status).toBe(403);
  expect(auth).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  ['search', { query: 'a' }], ['search', { query: 'a'.repeat(81) }],
  ['search', { query: 'Adobe\nInc' }], ['search', { query: 'Adobe', url: 'http://127.0.0.1/' }],
  ['resolve', { symbol: '../internal' }], ['resolve', { symbol: 'https://evil.example' }],
  ['resolve', { symbol: 'ADBE', isHalal: true }], ['resolve', { symbol: 'ıbm' }],
])('rejects invalid %s payload %# without reaching upstream', async (operation, body) => {
  const kind = operation as 'search' | 'resolve';
  const response = await (kind === 'search' ? localSearch : localResolve)(request(body, kind));
  expect(response.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('enforces a shared six-per-minute discovery budget independent of price series', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 7, 12));
  for (let i = 0; i < 6; i++) {
    expect((await localSearch(request({ query: 'Adobe' }, 'search'))).status).toBe(200);
  }
  const denied = await localResolve(request({ symbol: 'ADBE' }, 'resolve'));
  expect(denied.status).toBe(429);
  expect(denied.headers.get('retry-after')).toBe('60');
  expect(global.fetch).toHaveBeenCalledTimes(6);
});

test('enforces the thirty-per-hour discovery budget across minute windows', async () => {
  const clock = jest.spyOn(Date, 'now');
  const start = Date.UTC(2026, 10, 7, 12);
  for (let i = 0; i < 30; i++) {
    clock.mockReturnValue(start + Math.floor(i / 5) * 70_000);
    expect((await localSearch(request({ query: 'Adobe' }, 'search'))).status).toBe(200);
  }
  clock.mockReturnValue(start + 420_000);
  const denied = await localSearch(request({ query: 'Adobe' }, 'search'));
  expect(denied.status).toBe(429);
  expect(global.fetch).toHaveBeenCalledTimes(30);
});

test.each([401, 403, 429])('returns safe upstream status %s without retry or reflecting its body', async status => {
  global.fetch = jest.fn(async () => Response.json({ message: 'SENSITIVE_UPSTREAM_BODY' }, { status, headers: { 'Retry-After': '120' } }));
  const response = await localResolve(request({ symbol: 'ADBE' }, 'resolve'));
  expect(response.status).toBe(status === 429 ? 429 : 503);
  expect(response.headers.get('retry-after')).toBe('120');
  const body = await response.json();
  expect(body.code).toBe(status === 429 ? 'rate_limited' : 'provider_access_denied');
  expect(JSON.stringify(body)).not.toContain('SENSITIVE_UPSTREAM_BODY');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
