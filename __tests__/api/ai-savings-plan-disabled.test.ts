import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import { POST } from '@/app/api/ai/savings-plan/route';

jest.mock('@/lib/ai/provider-store', () => {
  class ProviderStoreAuthError extends Error {
    status = 401;
  }

  return {
    ProviderStoreAuthError,
    requireFirebaseUser: jest.fn(),
  };
});

const mockedRequireFirebaseUser = jest.mocked(requireFirebaseUser);

function request(): Request {
  return new Request('https://investatlas.example/api/ai/savings-plan', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '203.0.113.42',
    },
    body: JSON.stringify({
      action: 'generate_allocation',
      budget: 500,
      riskProfile: 'moderate',
    }),
  });
}

describe('disabled AI savings-plan endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireFirebaseUser.mockResolvedValue({
      uid: `savings-disabled-${Date.now()}`,
      token: 'verified-token',
    });
  });

  it('authenticates before returning the endpoint tombstone', async () => {
    mockedRequireFirebaseUser.mockRejectedValue(
      new ProviderStoreAuthError('Authentication required'),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('returns a private 410 without generating an allocation', async () => {
    const response = await POST(request());

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    await expect(response.json()).resolves.toEqual({
      error: 'AI-generated portfolio allocations are currently unavailable.',
    });
  });
});
