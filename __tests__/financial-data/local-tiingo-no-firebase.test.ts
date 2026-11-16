import { POST } from '@/app/api/local/tiingo/series/route';
import { fetchTiingoDailyPrices, fetchTiingoCryptoDailyPrices } from '@/lib/financial-data/providers/tiingo';
import { enforceRateLimit } from '@/lib/api/rate-limit';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'local_personal',
}));
jest.mock('@/lib/financial-data/providers/tiingo', () => ({
  TiingoProviderError: class TiingoProviderError extends Error {
    constructor(public status: string) { super('provider failed'); }
  },
  fetchTiingoDailyPrices: jest.fn(),
  fetchTiingoCryptoDailyPrices: jest.fn(),
}));
jest.mock('@/lib/api/rate-limit', () => ({
  enforceRateLimit: jest.fn(() => null),
}));

const stockFetch = jest.mocked(fetchTiingoDailyPrices);
const cryptoFetch = jest.mocked(fetchTiingoCryptoDailyPrices);
const rateLimit = jest.mocked(enforceRateLimit);
const today = new Date().toISOString();

function request(
  body: unknown,
  headers: Record<string, string> = {},
  url = 'http://127.0.0.1:3191/api/local/tiingo/series',
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3191',
      Host: '127.0.0.1:3191',
      'Sec-Fetch-Site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const rows = [{ date: today, open: 100, high: 110, low: 90, close: 101, volume: 1000 }];

describe('Firebase-free localhost Tiingo BYOK server route', () => {
  const originalVercel = process.env.VERCEL;
  beforeEach(() => {
    delete process.env.VERCEL;
    stockFetch.mockReset().mockResolvedValue(rows);
    cryptoFetch.mockReset().mockResolvedValue(rows);
    rateLimit.mockReset().mockReturnValue(null);
  });
  afterAll(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it('permits only a valid same-origin loopback personal token sent in JSON body', async () => {
    const result = await POST(request({ apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL' }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ symbol: 'AAPL', data: rows });
    expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(stockFetch).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL',
      healthKey: 'self-hosted-local-tiingo',
    }));
    expect(cryptoFetch).not.toHaveBeenCalled();
  });

  it('handles BTC with the documented dedicated crypto source', async () => {
    const result = await POST(request({ apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'BTC' }));
    expect(result.status).toBe(200);
    expect(cryptoFetch).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC' }));
    expect(stockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ Origin: 'https://other.example' }, 'http://127.0.0.1:3191/api/local/tiingo/series'],
    [{ Host: 'external.example' }, 'http://127.0.0.1:3191/api/local/tiingo/series'],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 'http://127.0.0.1:3191/api/local/tiingo/series'],
    [{ Origin: '' }, 'http://127.0.0.1:3191/api/local/tiingo/series'],
    [{ Host: '127.0.0.1:3191', Origin: 'http://127.0.0.1:3191' }, 'http://0.0.0.0:3191/api/local/tiingo/series'],
  ])('rejects forged origin/host without fetching provider', async (headers, url) => {
    const res = await POST(request({ apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL' }, headers, url));
    expect(res.status).toBe(403);
    expect(stockFetch).not.toHaveBeenCalled();
  });

  it('refuses the same request on Vercel, regardless of environment flags', async () => {
    process.env.VERCEL = '1';
    const res = await POST(request({ apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL' }));
    expect(res.status).toBe(403);
    expect(stockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'ISWD' },
    { apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'GOLD' },
    { apiKey: 'short', symbol: 'AAPL' },
    { apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL', url: 'https://example.com' },
  ])('rejects unsupported or malformed input', async (body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(stockFetch).not.toHaveBeenCalled();
  });

  it('enforces local quota before parsing provider credentials', async () => {
    rateLimit.mockReturnValueOnce(new Response('too many requests', { status: 429 }) as never);
    const res = await POST(request({ apiKey: 'SYNTHETIC_OWNER_TOKEN', symbol: 'AAPL' }));
    expect(res.status).toBe(429);
    expect(stockFetch).not.toHaveBeenCalled();
  });
});
