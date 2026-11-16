import { analyzeMarket, getAvailableProviders } from '@/lib/ai/analyzer';
import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import { GET, POST } from '@/app/api/ai/route';

jest.mock('@/lib/ai/analyzer', () => ({
  analyzeMarket: jest.fn(),
  getAvailableProviders: jest.fn(),
}));

jest.mock('@/lib/ai/provider-store', () => {
  class ProviderStoreAuthError extends Error {
    status = 401;

    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'ProviderStoreAuthError';
    }
  }

  return {
    ProviderStoreAuthError,
    requireFirebaseUser: jest.fn(),
  };
});

const mockedAnalyzeMarket = jest.mocked(analyzeMarket);
const mockedGetAvailableProviders = jest.mocked(getAvailableProviders);
const mockedRequireFirebaseUser = jest.mocked(requireFirebaseUser);

let requestSequence = 0;

function request(method: 'GET' | 'POST', body?: string): Request {
  requestSequence += 1;
  return new Request('https://investatlas.example/api/ai', {
    method,
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': `203.0.113.${requestSequence}`,
    },
    body,
  });
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe(
    'private, no-store, max-age=0',
  );
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/ai security boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireFirebaseUser.mockResolvedValue({
      uid: `ai-route-user-${requestSequence}`,
      token: 'verified-token',
    });
    mockedGetAvailableProviders.mockResolvedValue([]);
  });

  it('authenticates before returning provider metadata', async () => {
    mockedRequireFirebaseUser.mockRejectedValue(
      new ProviderStoreAuthError('Authentication required'),
    );

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
    expect(mockedGetAvailableProviders).not.toHaveBeenCalled();
  });

  it('marks authenticated provider metadata as private and non-cacheable', async () => {
    mockedGetAvailableProviders.mockResolvedValue([
      {
        name: 'Configured provider',
        model: 'configured-model',
        isFree: true,
        isAvailable: true,
        maxTokens: 8192,
        rateLimit: 'varies',
      },
    ]);

    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
  });

  it('rejects oversized analysis payloads before invoking a provider', async () => {
    const response = await POST(
      request(
        'POST',
        JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
      ),
    );

    expect(response.status).toBe(413);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toEqual({
      error: 'Request payload is too large',
    });
    expect(mockedAnalyzeMarket).not.toHaveBeenCalled();
  });

  it('does not expose downstream provider errors', async () => {
    mockedAnalyzeMarket.mockRejectedValue(
      new Error('secret provider response and internal URL'),
    );
    const body = JSON.stringify({
      asset: 'TEST',
      assetClass: 'stock',
      currency: 'usd',
      currentPrice: 100,
      smaValues: { 50: 95 },
      recentPrices: [95, 100],
    });

    const response = await POST(request('POST', body));
    const responseBody = await response.text();

    expect(response.status).toBe(502);
    expectPrivateNoStore(response);
    expect(responseBody).toBe('{"error":"AI analysis failed"}');
    expect(responseBody).not.toContain('secret provider');
    expect(mockedAnalyzeMarket).toHaveBeenCalledTimes(1);
  });
});
