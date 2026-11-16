import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { fetchTiingoDailyPrices, fetchTiingoCryptoDailyPrices, TiingoProviderError } from '@/lib/financial-data/providers/tiingo';
import { POST } from '@/app/api/financial-data/tiingo/local-series/route';

jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'), requireFirebaseUser: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/tiingo', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/tiingo'), fetchTiingoDailyPrices: jest.fn(), fetchTiingoCryptoDailyPrices: jest.fn(),
}));

const auth = jest.mocked(requireFirebaseUser);
const provider = jest.mocked(fetchTiingoDailyPrices);
const cryptoProvider = jest.mocked(fetchTiingoCryptoDailyPrices);
const baseEnv = process.env;
let ipCounter = 0;
const fixture = [
  { date: '2026-10-22T00:00:00.000Z', open: 9, high: 12, low: 8, close: 11, volume: 100 },
  { date: '2026-10-23T00:00:00.000Z', open: 11, high: 13, low: 10, close: 12, volume: 120 },
];
function request(body: unknown = { apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' },
  url = 'http://127.0.0.1:3001/api/financial-data/tiingo/local-series',
  origin: string | null = 'http://127.0.0.1:3001') {
  ipCounter += 1;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', Authorization: 'Bearer synthetic-firebase-token',
    'x-forwarded-for': '192.0.2.' + (ipCounter % 200 + 1),
  };
  if (origin !== null) headers.Origin = origin;
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('local-only authenticated Tiingo portfolio/chart server boundary', () => {
  beforeEach(() => {
    process.env = { ...baseEnv, NODE_ENV: 'development' };
    delete process.env.VERCEL;
    globalThis.__investAtlasRateLimits?.clear();
    auth.mockReset().mockResolvedValue({ uid: 'owner-a', token: 'synthetic-firebase-token' });
    provider.mockReset().mockResolvedValue(fixture);
    cryptoProvider.mockReset().mockResolvedValue(fixture.map((row) => ({ ...row, volume: row.volume / 3 })));
  });
  afterAll(() => { process.env = baseEnv; });

  it('returns bounded sourced EOD without leaking token or permitting arbitrary upstream parameters', async () => {
    const response = await POST(request());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ symbol: 'AAPL', data: fixture });
    expect(JSON.stringify(json)).not.toContain('SYNTHETIC_KEY_ONLY');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL', healthKey: 'personal-series:owner-a',
      signal: expect.any(AbortSignal),
    }));
    expect(provider.mock.calls[0][0].startDate).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it.each(['BTC', 'ETH'] as const)('uses only the own token for %s daily USD crypto bars', async (symbol) => {
    const response = await POST(request({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.symbol).toBe(symbol);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].volume).toBeCloseTo(100 / 3);
    expect(cryptoProvider).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'SYNTHETIC_KEY_ONLY', symbol, healthKey: 'personal-series:owner-a',
    }));
    expect(provider).not.toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toContain('SYNTHETIC_KEY_ONLY');
  });

  it('requires Firebase auth before contacting Tiingo', async () => {
    auth.mockRejectedValueOnce(new ProviderStoreAuthError());
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: 'short', symbol: 'AAPL' },
    { apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'DOGE' },
    { apiKey: 'SYNTHETIC_KEY_ONLY', symbol: '../../api' },
    { apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'aapl' },
    { apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL', endpoint: 'https://evil.example' },
  ])('rejects untrusted symbols, extra fields and invalid tokens', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1:3001/api/financial-data/tiingo/local-series', 'http://127.0.0.1:3000'],
    ['http://192.168.1.8:3001/api/financial-data/tiingo/local-series', 'http://192.168.1.8:3001'],
    ['https://investatlas.example/api/financial-data/tiingo/local-series', 'https://investatlas.example'],
    ['http://127.0.0.1:3001/api/financial-data/tiingo/local-series', null],
  ])('blocks non-loopback or mismatched Origin before auth', async (url, origin) => {
    expect((await POST(request(undefined, url, origin))).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('allows a matching browser Host/Origin even when Next dev normalizes request.url to localhost', async () => {
    const req = new Request('http://localhost:3001/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1:3001',
        Origin: 'http://127.0.0.1:3001',
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(req)).status).toBe(200);
  });

  it('rejects a forged non-loopback Host with a matching Origin', async () => {
    const req = new Request('http://localhost:3001/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: 'evil.example:3001',
        Origin: 'http://evil.example:3001',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(req)).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects localhost in production and on Vercel development previews', async () => {
    process.env = { ...baseEnv, NODE_ENV: 'production' };
    expect((await POST(request())).status).toBe(403);
    process.env = { ...baseEnv, NODE_ENV: 'development', VERCEL: '1' };
    expect((await POST(request())).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it('fails closed on hosted deployment without explicit platform abuse protection activation', async () => {
    process.env = { ...baseEnv, NODE_ENV: 'production', VERCEL: '1' };
    delete process.env.INVESTATLAS_TIINGO_HOSTED_ENABLED;
    const origin = 'https://invest-atlas-tan.vercel.app';
    const req = new Request(origin + '/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: 'invest-atlas-tan.vercel.app', Origin: origin,
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(req)).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    process.env.INVESTATLAS_TIINGO_HOSTED_ENABLED = 'false';
    expect((await POST(req)).status).toBe(403);
  });

  it('permits the exact current Vercel preview hostname only with the hosted protection switch', async () => {
    const previewHostname = 'invest-atlas-git-test-123.vercel.app';
    process.env = {
      ...baseEnv, NODE_ENV: 'production', VERCEL: '1',
      VERCEL_URL: previewHostname,
      INVESTATLAS_TIINGO_HOSTED_ENABLED: 'true',
    };
    const origin = 'https://' + previewHostname;
    const req = new Request(origin + '/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: previewHostname, Origin: origin,
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(req)).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    const other = new Request('https://arbitrary.vercel.app/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: 'arbitrary.vercel.app', Origin: 'https://arbitrary.vercel.app',
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(other)).status).toBe(403);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('allows authenticated production requests only from the configured public Vercel origin', async () => {
    process.env = { ...baseEnv, NODE_ENV: 'production', VERCEL: '1', INVESTATLAS_TIINGO_HOSTED_ENABLED: 'true' };
    const origin = 'https://invest-atlas-tan.vercel.app';
    const req = new Request(origin + '/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: 'invest-atlas-tan.vercel.app',
        Origin: origin,
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(provider.mock.calls[0][0]).toMatchObject({ symbol: 'AAPL', apiKey: 'SYNTHETIC_KEY_ONLY' });
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_KEY_ONLY');
  });

  it('rejects forged origins and unsupported production hosts even with a valid Firebase token', async () => {
    process.env = { ...baseEnv, NODE_ENV: 'production', VERCEL: '1', INVESTATLAS_TIINGO_HOSTED_ENABLED: 'true' };
    const origin = 'https://evil.example';
    const denied = new Request(origin + '/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: {
        Host: 'evil.example',
        Origin: origin,
        Authorization: 'Bearer synthetic-firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(denied)).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects missing Firebase auth in production before examining personal token', async () => {
    process.env = { ...baseEnv, NODE_ENV: 'production', VERCEL: '1', INVESTATLAS_TIINGO_HOSTED_ENABLED: 'true' };
    auth.mockRejectedValueOnce(new ProviderStoreAuthError());
    const origin = 'https://invest-atlas-tan.vercel.app';
    const req = new Request(origin + '/api/financial-data/tiingo/local-series', {
      method: 'POST',
      headers: { Host: 'invest-atlas-tan.vercel.app', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'SYNTHETIC_KEY_ONLY', symbol: 'AAPL' }),
    });
    expect((await POST(req)).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it('preserves independent UID isolation and strict hourly server budget', async () => {
    for (let i = 0; i < 25; i += 1) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
    auth.mockResolvedValueOnce({ uid: 'owner-b', token: 'synthetic-firebase-token' });
    expect((await POST(request())).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(26);
    expect(provider.mock.calls.at(-1)?.[0].healthKey).toBe('personal-series:owner-b');
  });

  it('returns safe classified upstream failures without provider details', async () => {
    provider.mockRejectedValueOnce(new TiingoProviderError('invalid_key'));
    const response = await POST(request());
    const text = JSON.stringify(await response.json());
    expect(response.status).toBe(422);
    expect(text).not.toContain('SYNTHETIC_KEY_ONLY');
    expect(text).toContain('invalid_key');
  });
});
