import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import {
  clearTiingoBrowserCredential, getTiingoBrowserBudget, hasTiingoBrowserCredential,
  loadTiingoBrowserDailySeries, reconcileTiingoBrowserCredentialOwner,
  setTiingoBrowserCredential, supportsTiingoBrowserAsset, testTiingoBrowserCredential,
} from '@/lib/financial-data/providers/tiingo-browser';

jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn() }));
const identity = jest.mocked(getFirebaseApiIdentity);

function fixture(dateOffset: number, price: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - dateOffset);
  return {
    date: day.toISOString().slice(0, 10) + 'T00:00:00.000Z',
    open: price, high: price + 2, low: price - 2,
    close: price + 1, volume: 120000, adjClose: price + 20,
  };
}
const payload = () => ({ symbol: 'AAPL', data: [fixture(2, 200), fixture(1, 201)] });

describe('Tiingo personal same-origin Next.js BYOK boundary', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    clearTiingoBrowserCredential();
    identity.mockReset().mockResolvedValue({ userId: 'user-a', token: 'synthetic-firebase-id-token' });
    global.fetch = jest.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }));
  });
  afterAll(() => {
    clearTiingoBrowserCredential();
    identity.mockReset();
    global.fetch = originalFetch;
  });

  it('accepts only the explicit USD stock and ETF allowlist', () => {
    expect(supportsTiingoBrowserAsset('AAPL')).toBe(true);
    expect(supportsTiingoBrowserAsset('SPUS')).toBe(true);
    expect(supportsTiingoBrowserAsset('BTC')).toBe(true);
    expect(supportsTiingoBrowserAsset('ETH')).toBe(true);
    expect(supportsTiingoBrowserAsset('GOLD')).toBe(false);
    expect(supportsTiingoBrowserAsset('IVSI')).toBe(false);
  });

  it('tests the key without storing it and obtains raw EOD via a same-origin authenticated POST', async () => {
    const key = 'SYNTHETIC_TEST_ONLY';
    await expect(testTiingoBrowserCredential('user-a', key)).resolves.toBe('connected');
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
    setTiingoBrowserCredential('user-a', key);
    const series = await loadTiingoBrowserDailySeries('user-a', 'AAPL');
    expect(series).toMatchObject({
      providerId: 'tiingo_browser_byok', assetSymbol: 'AAPL',
      listingCurrency: 'USD', cacheStatus: 'miss',
      bars: expect.arrayContaining([expect.objectContaining({ close: 201 })]),
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/financial-data/tiingo/local-series');
    expect(JSON.parse(String(init.body))).toEqual({ apiKey: key, symbol: 'AAPL' });
    expect(url).not.toContain(key);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-firebase-id-token');
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error', credentials: 'same-origin', referrerPolicy: 'no-referrer' });
  });

  it('permits only same-origin SSO cookies on the Firebase-authenticated endpoint and omits referrer', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    await loadTiingoBrowserDailySeries('user-a', 'AAPL');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('classifies invalid personal provider token without storing it', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ code: 'invalid_key', error: 'Personal market data unavailable' }), { status: 422 }));
    await expect(testTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY'))
      .rejects.toMatchObject({ status: 'invalid_key' });
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
  });

  it('surfaces safe HTTP status and hides provider/credential response details', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html>blocked by protected preview</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }));
    await expect(testTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY'))
      .rejects.toMatchObject({ status: 'provider_unavailable', diagnostic: 'HTTP 403' });
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
  });

  it('marks a blocked browser redirect or failed network request without exposing its URL', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Sensitive URL or redirect details'); });
    await expect(testTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY'))
      .rejects.toMatchObject({ status: 'provider_unavailable', diagnostic: 'NETWORK' });
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
  });

  it('rejects malformed close data instead of using adjusted prices', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      symbol: 'AAPL', data: [fixture(2, 200), { ...fixture(1, 201), close: null }],
    }), { status: 200 }));
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL'))
      .rejects.toMatchObject({ status: 'unexpected_response' });
  });

  it('rejects aborted caller before reaching server', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    const controller = new AbortController();
    controller.abort();
    await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('discards in-flight provider data after user switch', async () => {
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    let finish!: (response: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { finish = resolve; started(); }));
    const pending = loadTiingoBrowserDailySeries('user-a', 'AAPL');
    await began;
    const rejection = expect(pending).rejects.toMatchObject({ status: 'provider_unavailable' });
    reconcileTiingoBrowserCredentialOwner('user-b');
    finish(new Response(JSON.stringify(payload()), { status: 200 }));
    await rejection;
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
  });

  it('fails closed on Firebase/portfolio UID mismatch', async () => {
    identity.mockResolvedValueOnce({ userId: 'user-b', token: 'synthetic-other-token' });
    setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
    await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL'))
      .rejects.toMatchObject({ status: 'provider_unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('enforces tab rolling hourly budget', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-26T09:00:00.000Z'));
      setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
      for (let i = 0; i < 25; i++) await loadTiingoBrowserDailySeries('user-a', 'AAPL');
      await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL'))
        .rejects.toMatchObject({ status: 'quota_exhausted' });
      jest.setSystemTime(new Date('2026-10-26T10:05:00.000Z'));
      await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL'))
        .resolves.toMatchObject({ cacheStatus: 'miss' });
    } finally { jest.useRealTimers(); }
  });

  it('does not reset budget at a UTC hour boundary', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-26T09:59:30.000Z'));
      setTiingoBrowserCredential('user-a', 'SYNTHETIC_TEST_ONLY');
      for (let i = 0; i < 25; i++) await loadTiingoBrowserDailySeries('user-a', 'AAPL');
      jest.setSystemTime(new Date('2026-10-26T10:00:05.000Z'));
      expect(getTiingoBrowserBudget('user-a')).toEqual({ used: 25, limit: 25 });
      await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL'))
        .rejects.toMatchObject({ status: 'quota_exhausted' });
      expect(global.fetch).toHaveBeenCalledTimes(25);
      jest.setSystemTime(new Date('2026-10-26T10:59:31.000Z'));
      await expect(loadTiingoBrowserDailySeries('user-a', 'AAPL')).resolves.toMatchObject({ cacheStatus: 'miss' });
    } finally { jest.useRealTimers(); }
  });

  it('rejects malformed credentials without saving', () => {
    expect(() => setTiingoBrowserCredential('user-a', 'bad\nsecret')).toThrow();
    expect(hasTiingoBrowserCredential('user-a')).toBe(false);
  });
});
