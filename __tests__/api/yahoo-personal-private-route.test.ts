import { handleYahooPersonalRequest } from '@/lib/financial-data/providers/yahoo-personal-route';
import { requireFirebaseUser, ProviderStoreAuthError } from '@/lib/ai/provider-store';
import { fetchYahooPersonalDaily } from '@/lib/financial-data/providers/yahoo-personal-server';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/ai/provider-store', () => ({
  requireFirebaseUser: jest.fn(),
  ProviderStoreAuthError: class ProviderStoreAuthError extends Error { status = 401; },
}));
jest.mock('@/lib/financial-data/providers/yahoo-personal-server', () => ({
  supportsYahooPersonalAsset: (s: string) => s === 'AAPL' || s === 'ISWD',
  fetchYahooPersonalDaily: jest.fn(),
}));
const caller = jest.mocked(requireFirebaseUser);
const yahoo = jest.mocked(fetchYahooPersonalDaily);
const ownerUid = 'test-owner-yahoo';
const source = 'https://invest-atlas-owner-test.vercel.app';
const request = (symbol: string, origin = source) => new Request(source + '/api/financial-data/yahoo/personal-series', {
  method: 'POST',
  headers: { Host: 'invest-atlas-owner-test.vercel.app', Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer test-account-credential-12345' },
  body: JSON.stringify({ symbol }),
});
const previousUid = process.env.INVESTATLAS_PRIVATE_OWNER_UID;

beforeEach(() => {
  process.env.INVESTATLAS_PRIVATE_OWNER_UID = ownerUid;
  caller.mockReset().mockResolvedValue({ uid: ownerUid, token: 'dummy-token' });
  yahoo.mockReset().mockResolvedValue({
    providerId: 'yahoo_personal_daily', assetSymbol: 'ISWD',
    providerSymbol: 'IUSD.DE', listingCurrency: 'EUR',
    retrievedAt: '2026-11-03T18:00:00Z',
    latestObservationAt: '2026-11-02', cacheStatus: 'miss',
    bars: [{ date: '2026-11-02', open: 59, high: 61, low: 58, close: 60, volume: 120 }],
  });
});
afterAll(() => {
  if (previousUid === undefined) delete process.env.INVESTATLAS_PRIVATE_OWNER_UID;
  else process.env.INVESTATLAS_PRIVATE_OWNER_UID = previousUid;
});

describe('private Yahoo owner bridge', () => {
  it('requires a verified owner, then serves exact IUSD.DE EUR observations without a key', async () => {
    const res = await handleYahooPersonalRequest(request('ISWD'), 'private');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await res.json()).providerSymbol).toBe('IUSD.DE');
    expect(yahoo).toHaveBeenCalledWith('ISWD', expect.anything());
  });
  it('denies a valid signed-in user that is not the configured owner', async () => {
    caller.mockResolvedValue({ uid: 'someone-else', token: 'dummy-token' });
    expect((await handleYahooPersonalRequest(request('AAPL'), 'private')).status).toBe(403);
    expect(yahoo).not.toHaveBeenCalled();
  });
  it('returns 401 for an invalid owner session before contacting Yahoo', async () => {
    caller.mockRejectedValue(new ProviderStoreAuthError());
    expect((await handleYahooPersonalRequest(request('AAPL'), 'private')).status).toBe(401);
    expect(yahoo).not.toHaveBeenCalled();
  });
  it('denies an untrusted origin before any Firebase lookup or quote fetch', async () => {
    expect((await handleYahooPersonalRequest(request('AAPL', 'https://evil.example'), 'private')).status).toBe(403);
    expect(caller).not.toHaveBeenCalled();
    expect(yahoo).not.toHaveBeenCalled();
  });
  it('rejects arbitrary tickers, URLs, extra keys and unsupported assets', async () => {
    for (const payload of [{ symbol: 'GOLD' }, { symbol: 'AAPL', url: 'http://127.0.0.1/' }, { symbol: '../../internal' }]) {
      const r = new Request(source + '/api/financial-data/yahoo/personal-series', {
        method: 'POST',
        headers: { Host: 'invest-atlas-owner-test.vercel.app', Origin: source, 'Content-Type': 'application/json', Authorization: 'Bearer test-account-credential-12345' },
        body: JSON.stringify(payload),
      });
      expect((await handleYahooPersonalRequest(r, 'private')).status).toBe(400);
    }
    expect(yahoo).not.toHaveBeenCalled();
  });
});
