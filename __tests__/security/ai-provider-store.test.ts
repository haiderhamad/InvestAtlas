import { generateKeyPairSync } from 'node:crypto';
import {
  addProvider,
  getAllProviders,
  ProviderStoreUnavailableError,
  type ProviderStoreUser,
} from '@/lib/ai/provider-store';
import {
  encryptProviderVault,
  encryptProviderVaultV2,
} from '@/lib/ai/provider-vault-crypto';
import {
  resetFirebaseAdminTokenCacheForTests,
} from '@/lib/firebase/admin-rest';

const TEST_LEGACY_SECRET =
  'legacy-test-provider-vault-secret-with-adequate-length';
const TEST_API_KEY =
  'test-provider-api-key-never-store-as-plaintext';
const ACTIVE_KEY = Buffer.alloc(32, 7);
const PREVIOUS_KEY = Buffer.alloc(32, 3);
const user: ProviderStoreUser = {
  uid: 'owner-user',
  token: 'test-firebase-token',
};
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const TEST_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'demo-project',
  client_email:
    'investatlas-tests@demo-project.iam.gserviceaccount.com',
  private_key: privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }),
  token_uri: 'https://oauth2.googleapis.com/token',
};

function tokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: 'test-admin-access-token-with-safe-length',
      expires_in: 3_600,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function v2Document(
  providers: unknown,
  options: {
    key?: Buffer;
    keyId?: string;
    revision?: number;
    updateTime?: string;
  } = {},
) {
  const key = options.key ?? ACTIVE_KEY;
  const keyId = options.keyId ?? 'primary';
  const revision = options.revision ?? 1;
  const updateTime =
    options.updateTime ?? '2026-07-28T10:00:00.000000Z';
  const encrypted = encryptProviderVaultV2(
    providers,
    key,
    user.uid,
    keyId,
    revision,
  );

  return {
    name:
      'projects/demo-project/databases/(default)/documents/users/owner-user/aiProviderVault/config',
    updateTime,
    fields: {
      userId: { stringValue: user.uid },
      schemaVersion: {
        integerValue: String(encrypted.schemaVersion),
      },
      keyId: { stringValue: encrypted.keyId },
      revision: { integerValue: String(encrypted.revision) },
      ciphertext: { stringValue: encrypted.ciphertext },
      iv: { stringValue: encrypted.iv },
      authTag: { stringValue: encrypted.authTag },
      updatedAt: { stringValue: updateTime },
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AI provider cloud storage', () => {
  const originalFetch = global.fetch;
  const originalEnvironment = {
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    activeKeyId: process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID,
    keyring: process.env.AI_PROVIDER_VAULT_KEYS,
    legacyKey: process.env.ENCRYPTION_KEY,
  };

  beforeEach(() => {
    resetFirebaseAdminTokenCacheForTests();
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-project';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON =
      JSON.stringify(TEST_SERVICE_ACCOUNT);
    process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID = 'primary';
    process.env.AI_PROVIDER_VAULT_KEYS = JSON.stringify({
      primary: ACTIVE_KEY.toString('base64'),
      previous: PREVIOUS_KEY.toString('base64'),
    });
    process.env.ENCRYPTION_KEY = TEST_LEGACY_SECRET;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [name, value] of [
      ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', originalEnvironment.projectId],
      ['FIREBASE_SERVICE_ACCOUNT_JSON', originalEnvironment.serviceAccount],
      ['AI_PROVIDER_VAULT_ACTIVE_KEY_ID', originalEnvironment.activeKeyId],
      ['AI_PROVIDER_VAULT_KEYS', originalEnvironment.keyring],
      ['ENCRYPTION_KEY', originalEnvironment.legacyKey],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    jest.restoreAllMocks();
  });

  it('writes new providers through the server identity and encrypted v2 vault', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ writeResults: [{}] }));
    global.fetch = fetchMock as typeof fetch;

    await addProvider(user, {
      name: 'Test Provider',
      type: 'openai',
      apiKey: TEST_API_KEY,
      enabled: true,
      priority: 0,
    });

    const [readUrl, readInit] = fetchMock.mock.calls[1];
    const [writeUrl, writeInit] = fetchMock.mock.calls[2];
    const writeBody = JSON.parse(String(writeInit?.body));
    const fields = writeBody.writes[0].update.fields;

    expect(readUrl).toContain(
      '/users/owner-user/aiProviderVault/config',
    );
    expect(readInit?.headers).toEqual(
      expect.objectContaining({}),
    );
    expect(writeUrl).toContain('/documents:commit');
    expect(writeBody.writes[0].currentDocument).toEqual({
      exists: false,
    });
    expect(writeBody.writes[1]).toEqual({
      verify:
        'projects/demo-project/databases/(default)/documents/users/owner-user/accountDeletion/state',
      currentDocument: { exists: false },
    });
    expect(JSON.stringify(writeBody)).not.toContain(TEST_API_KEY);
    expect(fields.apiKey).toBeUndefined();
    expect(fields.schemaVersion.integerValue).toBe('2');
    expect(fields.keyId.stringValue).toBe('primary');
    expect(fields.revision.integerValue).toBe('1');
  });

  it('returns masked keys after server-side v2 decryption', async () => {
    const provider = {
      id: 'provider-1',
      name: 'Test Provider',
      type: 'openai' as const,
      apiKey: TEST_API_KEY,
      baseUrl: 'https://legacy.example.test/v1?token=must-not-leak',
      enabled: true,
      priority: 0,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(v2Document([provider])));
    global.fetch = fetchMock as typeof fetch;

    const providers = await getAllProviders(user);

    expect(providers).toHaveLength(1);
    expect(providers[0]).not.toHaveProperty('apiKey');
    expect(providers[0].maskedKey).toMatch(/●+text$/);
    expect(providers[0]).not.toHaveProperty('baseUrl');
  });

  it('lazily rewraps a vault encrypted with a previous key', async () => {
    const provider = {
      id: 'provider-1',
      name: 'Rotated Provider',
      type: 'openai' as const,
      apiKey: TEST_API_KEY,
      enabled: true,
      priority: 0,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          v2Document([provider], {
            key: PREVIOUS_KEY,
            keyId: 'previous',
            revision: 4,
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ writeResults: [{}] }));
    global.fetch = fetchMock as typeof fetch;

    await expect(getAllProviders(user)).resolves.toHaveLength(1);

    const commit = JSON.parse(
      String(fetchMock.mock.calls[2][1]?.body),
    );
    expect(
      commit.writes[0].update.fields.keyId.stringValue,
    ).toBe('primary');
    expect(
      commit.writes[0].update.fields.revision.integerValue,
    ).toBe('5');
    expect(commit.writes[0].currentDocument.updateTime).toBe(
      '2026-07-28T10:00:00.000000Z',
    );
  });

  it('migrates a v1.0.1 vault without returning plaintext to the browser', async () => {
    const provider = {
      id: 'provider-1',
      name: 'Legacy Provider',
      type: 'openai' as const,
      apiKey: TEST_API_KEY,
      enabled: true,
      priority: 0,
    };
    const encrypted = encryptProviderVault(
      [provider],
      TEST_LEGACY_SECRET,
      user.uid,
    );
    const legacyDocument = {
      name: 'legacy-vault',
      updateTime: '2026-07-28T09:00:00.000000Z',
      fields: {
        userId: { stringValue: user.uid },
        version: { integerValue: '1' },
        ciphertext: { stringValue: encrypted.ciphertext },
        iv: { stringValue: encrypted.iv },
        authTag: { stringValue: encrypted.authTag },
        updatedAt: {
          stringValue: '2026-07-28T09:00:00.000000Z',
        },
      },
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(legacyDocument))
      .mockResolvedValueOnce(jsonResponse({ writeResults: [{}] }));
    global.fetch = fetchMock as typeof fetch;

    const providers = await getAllProviders(user);

    expect(providers[0]).not.toHaveProperty('apiKey');
    const commitBody = String(fetchMock.mock.calls[2][1]?.body);
    expect(commitBody).not.toContain(TEST_API_KEY);
    expect(JSON.parse(commitBody).writes[0].update.fields).toEqual(
      expect.objectContaining({
        schemaVersion: { integerValue: '2' },
        revision: { integerValue: '1' },
      }),
    );
  });

  it('retries a concurrent mutation with a fresh update-time precondition', async () => {
    const existing = {
      id: 'provider-1',
      name: 'Existing',
      type: 'openai' as const,
      apiKey: TEST_API_KEY,
      enabled: true,
      priority: 0,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          v2Document([existing], {
            revision: 1,
            updateTime: '2026-07-28T10:00:00.000000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { status: 'FAILED_PRECONDITION' } },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          v2Document([existing], {
            revision: 2,
            updateTime: '2026-07-28T10:01:00.000000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ writeResults: [{}] }));
    global.fetch = fetchMock as typeof fetch;

    await addProvider(user, {
      name: 'Concurrent',
      type: 'gemini',
      apiKey: 'another-test-provider-key',
      enabled: true,
      priority: 1,
    });

    const retriedCommit = JSON.parse(
      String(fetchMock.mock.calls[4][1]?.body),
    );
    expect(
      retriedCommit.writes[0].currentDocument.updateTime,
    ).toBe('2026-07-28T10:01:00.000000Z');
    expect(
      retriedCommit.writes[0].update.fields.revision.integerValue,
    ).toBe('3');
  });

  it('fails closed before cloud access for placeholder keyring configuration', async () => {
    process.env.AI_PROVIDER_VAULT_KEYS =
      '{"primary":"replace-with-32-random-bytes-in-base64"}';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      addProvider(user, {
        name: 'Test Provider',
        type: 'openai',
        apiKey: TEST_API_KEY,
        enabled: true,
        priority: 0,
      }),
    ).rejects.toEqual(
      expect.any(ProviderStoreUnavailableError),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
