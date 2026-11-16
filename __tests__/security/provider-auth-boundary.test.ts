import {
  ProviderStoreAuthError,
  getFirebaseUserFromToken,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';

describe('AI provider Firebase authentication boundary', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-firebase-api-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = originalApiKey;
    }
    jest.restoreAllMocks();
  });

  it('rejects oversized bearer tokens before making an external request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const request = new Request('https://investatlas.example/api/ai', {
      headers: {
        Authorization: `Bearer ${'x'.repeat(17 * 1024)}`,
      },
    });

    await expect(requireFirebaseUser(request)).rejects.toBeInstanceOf(
      ProviderStoreAuthError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe Firebase UIDs returned by the identity boundary', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ users: [{ localId: '../another-user' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      getFirebaseUserFromToken('valid-length-test-firebase-token'),
    ).rejects.toBeInstanceOf(ProviderStoreAuthError);
  });

  it('rejects malformed direct tokens before identity lookup', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      getFirebaseUserFromToken('too-short'),
    ).rejects.toBeInstanceOf(ProviderStoreAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
