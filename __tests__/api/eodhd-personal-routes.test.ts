import { POST as localPost } from '@/app/api/local/eodhd/history/route';
import { POST as privatePost } from '@/app/api/financial-data/eodhd/personal-history/route';
import { fetchEodhdPersonalHistory, verifyEodhdPersonalKey, EodhdUpstreamError } from '@/lib/financial-data/providers/eodhd-server';
import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';

let mockMode = 'local_personal';
jest.mock('@/lib/runtime/deployment-mode', () => ({ get INVESTATLAS_DEPLOYMENT_MODE() { return mockMode; } }));
jest.mock('@/lib/financial-data/providers/eodhd-server', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/eodhd-server'),
  fetchEodhdPersonalHistory: jest.fn(), verifyEodhdPersonalKey: jest.fn(),
}));
jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'), requireFirebaseUser: jest.fn(),
}));
const KEY = 'test-owner-only-eodhd-secret';
const oldVercel = process.env.VERCEL;
const oldOwner = process.env.INVESTATLAS_PRIVATE_OWNER_UID;
const request = (body: unknown = { action: 'connect', key: KEY, historyYears: 1 }, origin = 'http://localhost:3000') => new Request(origin + '/api/local/eodhd/history', {
  method: 'POST', headers: { Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body),
});
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 7, 12));
  mockMode = 'local_personal';
  delete process.env.VERCEL;
  process.env.INVESTATLAS_PRIVATE_OWNER_UID = 'eodhd-private-owner';
  globalThis.__investAtlasRateLimits?.clear();
  jest.mocked(requireFirebaseUser).mockReset().mockResolvedValue({ uid: 'eodhd-private-owner', token: 'test-owner-session-token' });
  jest.mocked(verifyEodhdPersonalKey).mockReset().mockResolvedValue({ connected: true, historyYears: 1 });
  jest.mocked(fetchEodhdPersonalHistory).mockReset();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
  if (oldOwner === undefined) delete process.env.INVESTATLAS_PRIVATE_OWNER_UID; else process.env.INVESTATLAS_PRIVATE_OWNER_UID = oldOwner;
});

test('local same-origin loopback sends only validated bounded key data and returns private no-store JSON', async () => {
  const response = await localPost(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.json()).toEqual({ connected: true, historyYears: 1 });
  expect(verifyEodhdPersonalKey).toHaveBeenCalledWith(expect.objectContaining({ owner: 'local-personal', key: KEY, historyYears: 1 }), expect.any(AbortSignal));
  expect(requireFirebaseUser).not.toHaveBeenCalled();
});

test('cross-site, remote-host, hosted-local and public-demo calls never reach the provider', async () => {
  const evil = new Request('http://localhost:3000/api/local/eodhd/history', { method: 'POST', headers: { Host: 'localhost:3000', Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect', key: KEY, historyYears: 1 }) });
  expect((await localPost(evil)).status).toBe(403);
  expect((await localPost(request(undefined, 'http://owner.example'))).status).toBe(403);
  process.env.VERCEL = '1';
  expect((await localPost(request())).status).toBe(403);
  delete process.env.VERCEL;
  mockMode = 'public_demo';
  expect((await localPost(request())).status).toBe(403);
  expect((await privatePost(request(undefined, 'https://private.example'))).status).toBe(403);
  expect(verifyEodhdPersonalKey).not.toHaveBeenCalled();
});

test('private access requires exact configured Firebase owner and same HTTPS origin', async () => {
  mockMode = 'private_cloud';
  expect((await privatePost(request(undefined, 'https://private.example'))).status).toBe(200);
  jest.mocked(requireFirebaseUser).mockResolvedValue({ uid: 'another-user', token: 'test-other-session-token' });
  expect((await privatePost(request(undefined, 'https://private.example'))).status).toBe(403);
  jest.mocked(requireFirebaseUser).mockRejectedValue(new ProviderStoreAuthError('Unauthorized'));
  expect((await privatePost(request(undefined, 'https://private.example'))).status).toBe(401);
  expect(verifyEodhdPersonalKey).toHaveBeenCalledTimes(1);
});

test('unknown fields, malformed instruments, non-JSON or oversized bodies cannot forward a key', async () => {
  for (const body of [
    { action: 'connect', key: KEY, historyYears: 1, url: 'https://evil.example' },
    { action: 'connect', key: KEY, historyYears: 3 },
    { action: 'history', key: KEY, historyYears: 1, instrument: 'BTC', range: { from: '2026-11-01', to: '2026-11-06' } },
    { action: 'connect', key: KEY + 'x'.repeat(9000), historyYears: 1 },
  ]) expect([400, 413]).toContain((await localPost(request(body))).status);
  const plain = request(); plain.headers.set('content-type', 'text/plain');
  expect((await localPost(plain)).status).toBe(400);
  expect(verifyEodhdPersonalKey).not.toHaveBeenCalled();
  expect(fetchEodhdPersonalHistory).not.toHaveBeenCalled();
});

test.each([402, 403, 429])('preserves provider %s and retry cooldown while redacting sensitive failures', async status => {
  jest.mocked(verifyEodhdPersonalKey).mockRejectedValue(new EodhdUpstreamError(status, 180));
  const response = await localPost(request());
  expect(response.status).toBe(status);
  expect(response.headers.get('retry-after')).toBe('180');
  expect(await response.text()).not.toContain(KEY);
});

test('an untrusted thrown message is never serialized to the owner', async () => {
  jest.mocked(verifyEodhdPersonalKey).mockRejectedValue(new Error('network ' + KEY));
  const response = await localPost(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(KEY);
});

test('forwards a validated native history request without permitting URL or owner overrides', async () => {
  jest.mocked(fetchEodhdPersonalHistory).mockResolvedValue({
    providerId: 'eodhd_personal_daily', assetSymbol: 'SAP', providerSymbol: 'SAP.XETRA', exchange: 'GER', listingCurrency: 'EUR',
    retrievedAt: new Date().toISOString(), latestObservationAt: null, cacheStatus: 'miss', adjustment: 'raw_unadjusted', volumeAdjustment: 'splits', bars: [],
    coverage: { requested: { from: '2026-11-01', to: '2026-11-06' }, checked: { from: '2026-11-01', to: '2026-11-06' }, available: null, historyYears: 1, limited: false },
  });
  const response = await localPost(request({ action: 'history', key: KEY, historyYears: 1, instrument: 'SAP', range: { from: '2026-11-01', to: '2026-11-06' } }));
  expect(response.status).toBe(200);
  expect(fetchEodhdPersonalHistory).toHaveBeenCalledWith({ key: KEY, owner: 'local-personal', historyYears: 1,
    instrument: { symbol: 'SAP', providerSymbol: 'SAP.DE', assetClass: 'stock', nativeCurrency: 'eur', exchange: 'GER' }, range: { from: '2026-11-01', to: '2026-11-06' } }, expect.any(AbortSignal));
});
