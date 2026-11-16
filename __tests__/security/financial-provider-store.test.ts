import type { ProviderStoreUser } from '@/lib/ai/provider-store';
import {
  FinancialCredentialStoreError,
  listFinancialCredentials,
  upsertFinancialCredential,
} from '@/lib/financial-data/providers/credential-store';
import { encryptFinancialCredentialVault } from '@/lib/financial-data/providers/credential-vault-crypto';
import { firebaseAdminFetch } from '@/lib/firebase/admin-rest';

jest.mock('@/lib/firebase/admin-rest', () => ({
  FirebaseAdminUnavailableError: class FirebaseAdminUnavailableError extends Error {},
  firebaseAdminFetch: jest.fn(),
  getFirebaseAdminProjectId: jest.fn(() => 'demo-project'),
}));

const mockedAdminFetch = jest.mocked(firebaseAdminFetch);
const key = Buffer.alloc(32, 23);
const previousKey = Buffer.alloc(32, 19);
const owner: ProviderStoreUser = {
  uid: 'owner-user',
  token: 'verified-firebase-token',
};
const apiKey = 'tiingo_secret_key_123456789';
const storedCredential = {
  id: 'tiingo' as const,
  apiKey,
  enabled: true,
  priority: 0,
  status: 'connected' as const,
  detectedCapabilities: ['quote', 'history'] as const,
  lastValidatedAt: '2026-08-09T10:00:00.000Z',
};

function vaultDocument(
  userId = owner.uid,
  options: { vaultKey?: Buffer; keyId?: string } = {},
) {
  const vaultKey = options.vaultKey ?? key;
  const keyId = options.keyId ?? 'primary';
  const encrypted = encryptFinancialCredentialVault(
    [storedCredential],
    vaultKey,
    owner.uid,
    keyId,
    3,
  );
  return {
    updateTime: '2026-08-09T10:05:00.000000Z',
    fields: {
      userId: { stringValue: userId },
      schemaVersion: { integerValue: '1' },
      keyId: { stringValue: encrypted.keyId },
      revision: { integerValue: String(encrypted.revision) },
      ciphertext: { stringValue: encrypted.ciphertext },
      iv: { stringValue: encrypted.iv },
      authTag: { stringValue: encrypted.authTag },
    },
  };
}

describe('financial provider server-owned storage', () => {
  const originalEnvironment = {
    activeKeyId: process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID,
    keys: process.env.AI_PROVIDER_VAULT_KEYS,
  };

  beforeEach(() => {
    mockedAdminFetch.mockReset();
    process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID = 'primary';
    process.env.AI_PROVIDER_VAULT_KEYS = JSON.stringify({
      primary: key.toString('base64'),
      previous: previousKey.toString('base64'),
    });
  });

  afterAll(() => {
    if (originalEnvironment.activeKeyId === undefined) {
      delete process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID;
    } else {
      process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID = originalEnvironment.activeKeyId;
    }
    if (originalEnvironment.keys === undefined) {
      delete process.env.AI_PROVIDER_VAULT_KEYS;
    } else {
      process.env.AI_PROVIDER_VAULT_KEYS = originalEnvironment.keys;
    }
  });

  it('writes only encrypted fields with owner and deletion preconditions', async () => {
    mockedAdminFetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ writeResults: [{}] }));

    const result = await upsertFinancialCredential(owner, {
      ...storedCredential,
      detectedCapabilities: [...storedCredential.detectedCapabilities],
    });

    const [commitUrl, commitInit] = mockedAdminFetch.mock.calls[1];
    const body = JSON.parse(String(commitInit?.body));
    const serialized = JSON.stringify(body);

    expect(commitUrl).toBe(
      'https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents:commit',
    );
    expect(serialized).not.toContain(apiKey);
    expect(body.writes[0].update.name).toContain(
      '/users/owner-user/financialProviderVault/config',
    );
    expect(body.writes[0].currentDocument).toEqual({ exists: false });
    expect(body.writes[1]).toEqual({
      verify: 'projects/demo-project/databases/(default)/documents/users/owner-user/accountDeletion/state',
      currentDocument: { exists: false },
    });
    expect(result).not.toHaveProperty('apiKey');
    expect(result.maskedKey).not.toBe(apiKey);
  });

  it('returns only masked metadata after owner-bound decryption', async () => {
    mockedAdminFetch.mockResolvedValueOnce(Response.json(vaultDocument()));

    const result = await listFinancialCredentials(owner);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('apiKey');
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'tiingo',
      credentialRevision: 3,
      maskedKey: expect.stringContaining(apiKey.slice(-4)),
    }));
  });

  it('fails closed when a Firestore document claims a different owner', async () => {
    mockedAdminFetch.mockResolvedValueOnce(
      Response.json(vaultDocument('different-user')),
    );

    await expect(listFinancialCredentials(owner)).rejects.toBeInstanceOf(
      FinancialCredentialStoreError,
    );
  });

  it('lazily rewraps a previous key without returning plaintext', async () => {
    mockedAdminFetch
      .mockResolvedValueOnce(Response.json(vaultDocument(owner.uid, {
        vaultKey: previousKey,
        keyId: 'previous',
      })))
      .mockResolvedValueOnce(Response.json({ writeResults: [{}] }));

    const result = await listFinancialCredentials(owner);
    const commit = JSON.parse(String(mockedAdminFetch.mock.calls[1][1]?.body));
    const fields = commit.writes[0].update.fields;

    expect(result[0].credentialRevision).toBe(4);
    expect(fields.keyId.stringValue).toBe('primary');
    expect(fields.revision.integerValue).toBe('4');
    expect(JSON.stringify(commit)).not.toContain(apiKey);
    expect(commit.writes[0].currentDocument.updateTime).toBe(
      '2026-08-09T10:05:00.000000Z',
    );
  });

  it('rejects non-canonical encryption keys before any Firestore request', async () => {
    process.env.AI_PROVIDER_VAULT_KEYS = JSON.stringify({
      primary: `${key.toString('base64')}!!`,
    });

    await expect(listFinancialCredentials(owner)).rejects.toBeInstanceOf(
      FinancialCredentialStoreError,
    );
    expect(mockedAdminFetch).not.toHaveBeenCalled();
  });

  it('reports a bounded conflict after three failed optimistic writes', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      mockedAdminFetch
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(
          'FAILED_PRECONDITION',
          { status: 409 },
        ));
    }

    await expect(upsertFinancialCredential(owner, {
      ...storedCredential,
      detectedCapabilities: [...storedCredential.detectedCapabilities],
    })).rejects.toMatchObject({
      status: 409,
      message: 'Financial provider settings changed in another request',
    });
    expect(mockedAdminFetch).toHaveBeenCalledTimes(6);
  });
});
