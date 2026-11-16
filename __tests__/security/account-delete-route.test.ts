import {
  FirebaseAccountAuthError,
  FirebaseAccountRecentAuthError,
  beginFirebaseAccountDeletion,
  deleteFirebaseAuthAccount,
  deleteKnownFirebaseCloudData,
  requireRecentFirebaseAccount,
} from '@/lib/firebase/account-deletion';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { DELETE } from '@/app/api/account/delete/route';

jest.mock('@/lib/firebase/account-deletion', () => {
  const actual = jest.requireActual('@/lib/firebase/account-deletion');
  return {
    ...actual,
    beginFirebaseAccountDeletion: jest.fn(),
    deleteFirebaseAuthAccount: jest.fn(),
    deleteKnownFirebaseCloudData: jest.fn(),
    requireRecentFirebaseAccount: jest.fn(),
  };
});

jest.mock('@/lib/api/rate-limit', () => {
  const actual = jest.requireActual('@/lib/api/rate-limit');
  return {
    ...actual,
    enforceRateLimit: jest.fn(),
  };
});

const mockBegin = beginFirebaseAccountDeletion as jest.MockedFunction<
  typeof beginFirebaseAccountDeletion
>;
const mockDeleteAuth = deleteFirebaseAuthAccount as jest.MockedFunction<
  typeof deleteFirebaseAuthAccount
>;
const mockDeleteCloud = deleteKnownFirebaseCloudData as jest.MockedFunction<
  typeof deleteKnownFirebaseCloudData
>;
const mockRequireAccount = requireRecentFirebaseAccount as jest.MockedFunction<
  typeof requireRecentFirebaseAccount
>;
const mockRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

function request() {
  return new Request('https://investatlas.example/api/account/delete', {
    method: 'DELETE',
    headers: {
      Authorization: 'Bearer test-firebase-id-token',
      'x-vercel-forwarded-for': '203.0.113.77',
    },
  });
}

describe('DELETE /api/account/delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockReturnValue(null);
    mockRequireAccount.mockResolvedValue({
      uid: 'owner-user',
      token: 'test-firebase-id-token',
    });
    mockBegin.mockResolvedValue();
    mockDeleteCloud.mockResolvedValue();
    mockDeleteAuth.mockResolvedValue();
  });

  it('deletes known cloud data before Firebase Auth and returns privately', async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockBegin).toHaveBeenCalledWith('owner-user');
    expect(mockDeleteCloud).toHaveBeenCalledWith('owner-user');
    expect(mockDeleteAuth).toHaveBeenCalledWith('test-firebase-id-token');
    expect(mockBegin.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteCloud.mock.invocationCallOrder[0],
    );
    expect(mockDeleteCloud.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteAuth.mock.invocationCallOrder[0],
    );
  });

  it('keeps Auth and the deletion marker when cloud deletion fails', async () => {
    mockDeleteCloud.mockRejectedValue(new Error('upstream failure'));

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Account deletion is temporarily unavailable',
    });
    expect(mockDeleteAuth).not.toHaveBeenCalled();
  });

  it('requires recent authentication before creating a deletion marker', async () => {
    mockRequireAccount.mockRejectedValue(
      new FirebaseAccountRecentAuthError(),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Recent authentication required',
      code: 'recent-auth-required',
    });
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockDeleteCloud).not.toHaveBeenCalled();
  });

  it('returns a generic authentication error without starting deletion', async () => {
    mockRequireAccount.mockRejectedValue(new FirebaseAccountAuthError());

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it('keeps the marker retryable when Firebase Auth refuses deletion', async () => {
    mockDeleteAuth.mockRejectedValue(new FirebaseAccountRecentAuthError());

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(mockDeleteCloud).toHaveBeenCalled();
  });

  it('rate-limits before token verification and keeps the response private', async () => {
    mockRateLimit.mockReturnValue(
      Response.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': '600',
            'X-RateLimit-Limit': '5',
          },
        },
      ),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(response.headers.get('Retry-After')).toBe('600');
    expect(mockRequireAccount).not.toHaveBeenCalled();
  });
});
