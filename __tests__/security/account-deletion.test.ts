const mockAdminFetch = jest.fn();

jest.mock('@/lib/firebase/admin-rest', () => ({
  FirebaseAdminUnavailableError: class FirebaseAdminUnavailableError extends Error {},
  firebaseAdminFetch: (...args: unknown[]) => mockAdminFetch(...args),
  getFirebaseAdminProjectId: () => 'demo-project',
}));

import {
  FirebaseAccountAuthError,
  FirebaseAccountDeletionUnavailableError,
  FirebaseAccountRecentAuthError,
  beginFirebaseAccountDeletion,
  deleteFirebaseAuthAccount,
  deleteKnownFirebaseCloudData,
  requireRecentFirebaseAccount,
} from '@/lib/firebase/account-deletion';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');
const UID = 'owner-user';
const DATABASE_RESOURCE =
  'projects/demo-project/databases/(default)/documents';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function firebaseToken(
  overrides: Record<string, unknown> = {},
): string {
  const claims = {
    aud: 'demo-project',
    auth_time: Math.floor(NOW / 1_000) - 60,
    exp: Math.floor(NOW / 1_000) + 3_600,
    iat: Math.floor(NOW / 1_000) - 60,
    iss: 'https://securetoken.google.com/demo-project',
    sub: UID,
    user_id: UID,
    ...overrides,
  };
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'test-signature-that-is-validated-by-identity-toolkit',
  ].join('.');
}

function authenticatedRequest(token = firebaseToken()) {
  return new Request('https://investatlas.example/api/account/delete', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Firebase account deletion service', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-public-firebase-api-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = originalApiKey;
    }
  });

  it('verifies the token with Firebase and requires matching recent claims', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ users: [{ localId: UID }] }),
    );
    global.fetch = fetchMock as typeof fetch;
    const token = firebaseToken();

    await expect(
      requireRecentFirebaseAccount(authenticatedRequest(token), NOW),
    ).resolves.toEqual({ uid: UID, token });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/accounts:lookup?key=');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({ idToken: token });
  });

  it('fails closed for stale authentication and mismatched verified claims', async () => {
    global.fetch = jest.fn().mockImplementation(async () =>
      jsonResponse({ users: [{ localId: UID }] }),
    ) as typeof fetch;

    await expect(
      requireRecentFirebaseAccount(
        authenticatedRequest(
          firebaseToken({
            auth_time: Math.floor(NOW / 1_000) - 301,
          }),
        ),
        NOW,
      ),
    ).rejects.toBeInstanceOf(FirebaseAccountRecentAuthError);

    await expect(
      requireRecentFirebaseAccount(
        authenticatedRequest(firebaseToken({ aud: 'other-project' })),
        NOW,
      ),
    ).rejects.toBeInstanceOf(FirebaseAccountAuthError);
  });

  it('rejects verified user IDs that cannot be used as one Firestore path segment', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ users: [{ localId: 'owner/user' }] }),
    ) as typeof fetch;

    await expect(
      requireRecentFirebaseAccount(authenticatedRequest(), NOW),
    ).rejects.toBeInstanceOf(FirebaseAccountAuthError);
  });

  it('deletes every known cloud-data location through bounded admin requests', async () => {
    const queryCalls = new Map<string, number>();
    mockAdminFetch.mockImplementation(
      async (urlValue: unknown, init?: RequestInit) => {
        const url = String(urlValue);

        if (url.endsWith(':runQuery')) {
          const body = JSON.parse(String(init?.body));
          const collectionId =
            body.structuredQuery.from[0].collectionId as string;
          const count = queryCalls.get(collectionId) ?? 0;
          queryCalls.set(collectionId, count + 1);
          expect(
            body.structuredQuery.where.fieldFilter.value.stringValue,
          ).toBe(UID);

          if (collectionId === 'transactions' && count === 0) {
            return jsonResponse([
              {
                document: {
                  name: `${DATABASE_RESOURCE}/transactions/owner-user~tx-1`,
                },
              },
            ]);
          }
          return jsonResponse([]);
        }

        if (url.includes('/user_hidden_assets/')) {
          return new Response(null, { status: 404 });
        }
        if (url.includes('/aiProviderVault?')) {
          return jsonResponse({
            documents: [
              {
                name:
                  `${DATABASE_RESOURCE}/users/${UID}/aiProviderVault/config`,
              },
            ],
          });
        }
        if (url.includes('/aiProviders?')) {
          return jsonResponse({
            documents: [
              {
                name:
                  `${DATABASE_RESOURCE}/users/${UID}/aiProviders/legacy`,
              },
            ],
          });
        }
        if (url.includes('/financialProviderVault?')) {
          return jsonResponse({
            documents: [
              {
                name:
                  `${DATABASE_RESOURCE}/users/${UID}/financialProviderVault/config`,
              },
            ],
          });
        }
        if (url.endsWith(':commit')) {
          return jsonResponse({ writeResults: [] });
        }
        throw new Error(`Unexpected admin request: ${url}`);
      },
    );

    await deleteKnownFirebaseCloudData(UID);

    expect(queryCalls).toEqual(
      new Map([
        ['transactions', 2],
        ['manual-accounts', 1],
        ['asset-risks', 1],
      ]),
    );
    const committedDeletes = mockAdminFetch.mock.calls
      .filter(([url]) => String(url).endsWith(':commit'))
      .flatMap(([, init]) => {
        const body = JSON.parse(String((init as RequestInit)?.body));
        return body.writes.map(
          (write: { delete: string }) => write.delete,
        );
      });
    expect(committedDeletes).toEqual(
      expect.arrayContaining([
        `${DATABASE_RESOURCE}/transactions/owner-user~tx-1`,
        `${DATABASE_RESOURCE}/users/${UID}/aiProviderVault/config`,
        `${DATABASE_RESOURCE}/users/${UID}/aiProviders/legacy`,
        `${DATABASE_RESOURCE}/users/${UID}/financialProviderVault/config`,
      ]),
    );
  });

  it('creates the server-private marker idempotently', async () => {
    mockAdminFetch
      .mockResolvedValueOnce(jsonResponse({ name: 'marker' }))
      .mockResolvedValueOnce(jsonResponse({ name: 'marker' }));

    await beginFirebaseAccountDeletion(UID);
    await beginFirebaseAccountDeletion(UID);

    const [markerUrl, markerInit] = mockAdminFetch.mock.calls[0];
    expect(String(markerUrl)).toContain(
      `/users/${UID}/accountDeletion/state`,
    );
    expect(markerInit).toEqual(
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(mockAdminFetch).toHaveBeenCalledTimes(2);
  });

  it('uses the user token for Auth deletion and accepts an already absent user', async () => {
    const token = firebaseToken();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'USER_NOT_FOUND' } },
          400,
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    await expect(deleteFirebaseAuthAccount(token)).resolves.toBeUndefined();
    await expect(deleteFirebaseAuthAccount(token)).resolves.toBeUndefined();

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain('/accounts:delete?key=');
      expect(JSON.parse(String(init?.body))).toEqual({ idToken: token });
      expect(init?.cache).toBe('no-store');
    }
  });

  it('rejects untrusted Firestore resource names instead of deleting them', async () => {
    mockAdminFetch.mockResolvedValue(
      jsonResponse([
        {
          document: {
            name:
              'projects/other/databases/(default)/documents/transactions/victim',
          },
        },
      ]),
    );

    await expect(
      deleteKnownFirebaseCloudData(UID),
    ).rejects.toBeInstanceOf(
      FirebaseAccountDeletionUnavailableError,
    );
  });
});
