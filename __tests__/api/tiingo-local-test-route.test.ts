import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { fetchTiingoDailyPrices, TiingoProviderError } from '@/lib/financial-data/providers/tiingo';
import { POST } from '@/app/api/financial-data/tiingo/local-test/route';

jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'),
  requireFirebaseUser: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/tiingo', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/tiingo'),
  fetchTiingoDailyPrices: jest.fn(),
}));

const mockedRequireUser = jest.mocked(requireFirebaseUser);
const mockedFetch = jest.mocked(fetchTiingoDailyPrices);
const user = { uid: 'local-test-user', token: 'verified-firebase-token' };
const originalProcessEnv = process.env;
let requestNumber = 0;

function request(body: unknown = { apiKey: 'private_tiingo_token_123' }, options: { url?: string; origin?: string; ip?: string } = {}) {
  requestNumber += 1;
  const url = options.url ?? 'http://localhost:3000/api/financial-data/tiingo/local-test';
  const origin = options.origin ?? 'http://localhost:3000';
  return new Request(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-firebase-token',
      'Content-Type': 'application/json',
      Origin: origin,
      'x-forwarded-for': options.ip ?? `192.0.2.${requestNumber}`,
    },
    body: JSON.stringify(body),
  });
}

describe('local Tiingo server connection test', () => {
  beforeEach(() => {
    process.env = { ...originalProcessEnv, NODE_ENV: 'development' };
    delete process.env.VERCEL;
    globalThis.__investAtlasRateLimits?.clear();
    mockedRequireUser.mockReset().mockResolvedValue(user);
    mockedFetch.mockReset();
  });

  afterAll(() => {
    process.env = originalProcessEnv;
  });

  it('returns only validated AAPL data and never echoes the personal token', async () => {
    const token = 'private_tiingo_token_123';
    mockedFetch.mockResolvedValueOnce([{ date: '2026-10-23T00:00:00.000Z', open: 10, high: 12, low: 9, close: 11, volume: 100 }]);

    const response = await POST(request({ apiKey: token }));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(serialized).not.toContain(token);
    expect(serialized).toContain('AAPL');
    expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: token,
      healthKey: `local-test:${user.uid}`,
      symbol: 'AAPL',
      signal: expect.any(AbortSignal),
    }));
    const call = mockedFetch.mock.calls[0][0];
    expect(call.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(call.endDate) - Date.parse(call.startDate)).toBe(10 * 86_400_000);
  });

  it('requires Firebase authentication before reading the request body', async () => {
    mockedRequireUser.mockRejectedValueOnce(new ProviderStoreAuthError());
    const response = await POST(request({ apiKey: 'private_tiingo_token_123' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('keeps each test request bound to the authenticated user and never returns either token', async () => {
    mockedFetch.mockResolvedValue([{ date: '2026-10-23T00:00:00.000Z', open: 10, high: 12, low: 9, close: 11, volume: 100 }]);
    const firstToken = 'first_user_tiingo_token_123';
    const secondToken = 'second_user_tiingo_token_456';
    const first = await POST(request({ apiKey: firstToken }, { ip: '198.51.100.31' }));
    mockedRequireUser.mockResolvedValueOnce({ ...user, uid: 'different-local-test-user' });
    const second = await POST(request({ apiKey: secondToken }, { ip: '198.51.100.32' }));
    const serialized = `${JSON.stringify(await first.json())}${JSON.stringify(await second.json())}`;

    expect(mockedFetch.mock.calls.map(([input]) => input.healthKey)).toEqual([
      `local-test:${user.uid}`,
      'local-test:different-local-test-user',
    ]);
    expect(serialized).not.toContain(firstToken);
    expect(serialized).not.toContain(secondToken);
    expect(mockedFetch.mock.calls.map(([input]) => input.apiKey)).toEqual([firstToken, secondToken]);
  });

  it('enforces the per-user request budget even when forwarded IP addresses change', async () => {
    mockedFetch.mockResolvedValue([{ date: '2026-10-23T00:00:00.000Z', open: 10, high: 12, low: 9, close: 11, volume: 100 }]);
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await POST(request(
        { apiKey: 'private_tiingo_token_123' },
        { ip: `203.0.113.${40 + index}` },
      )));
    }

    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect(mockedFetch).toHaveBeenCalledTimes(5);
    expect(responses[5].headers.get('Cache-Control')).toContain('no-store');
  });

  it.each([
    { apiKey: 'short' },
    { apiKey: 'private_tiingo_token_123', symbol: 'MSFT' },
    { apiKey: 'private_tiingo_token_123', url: 'https://attacker.example' },
    null,
  ])('rejects malformed or expanded inputs without provider access', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies and non-JSON requests before provider access', async () => {
    const oversized = new Request('http://localhost:3000/api/financial-data/tiingo/local-test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-firebase-token',
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        'Content-Length': '3000',
      },
      body: JSON.stringify({ apiKey: 'private_tiingo_token_123' }),
    });
    const oversizedResponse = await POST(oversized);
    const nonJson = request({ apiKey: 'private_tiingo_token_123' });
    const nonJsonRequest = new Request(nonJson.url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified-firebase-token',
        Origin: 'http://localhost:3000',
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ apiKey: 'private_tiingo_token_123' }),
    });
    const nonJsonResponse = await POST(nonJsonRequest);

    expect(oversizedResponse.status).toBe(413);
    expect(nonJsonResponse.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'https://investatlas.example/api/financial-data/tiingo/local-test', origin: 'https://investatlas.example' },
    { url: 'http://localhost:3000/api/financial-data/tiingo/local-test', origin: 'http://localhost:3001' },
    { url: 'http://192.168.1.4:3000/api/financial-data/tiingo/local-test', origin: 'http://192.168.1.4:3000' },
    { url: 'http://localhost:3000/api/financial-data/tiingo/local-test', origin: undefined },
  ])('rejects non-loopback or mismatched Origin requests', async ({ url, origin }) => {
    const headersRequest = origin === undefined
      ? new Request(url, { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ apiKey: 'private_tiingo_token_123' }) })
      : request({ apiKey: 'private_tiingo_token_123' }, { url, origin });
    const response = await POST(headersRequest);
    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('is disabled when running outside the local development process', async () => {
    const environments: NodeJS.ProcessEnv[] = [
      { ...originalProcessEnv, NODE_ENV: 'production' },
      { ...originalProcessEnv, NODE_ENV: 'development', VERCEL: '1' },
    ];
    for (const environment of environments) {
      process.env = environment;
      const response = await POST(request());
      expect(response.status).toBe(404);
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_key', 422],
    ['rate_limited', 429],
    ['quota_exhausted', 429],
    ['unexpected_response', 502],
    ['provider_unavailable', 503],
  ] as const)('maps Tiingo %s to a safe response', async (code, status) => {
    mockedFetch.mockRejectedValueOnce(new TiingoProviderError(code));
    const response = await POST(request());
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(serialized).not.toContain('private_tiingo_token_123');
    expect(serialized).not.toContain('Authorization');
  });
});
