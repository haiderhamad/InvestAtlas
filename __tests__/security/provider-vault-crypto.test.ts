import {
  ProviderVaultCryptoError,
  decryptProviderVault,
  decryptProviderVaultV2,
  encryptProviderVault,
  encryptProviderVaultV2,
} from '@/lib/ai/provider-vault-crypto';

const TEST_SECRET = 'test-only-provider-vault-secret-with-adequate-length';
const TEST_USER_ID = 'owner-user';

describe('AI provider vault encryption', () => {
  const providers = [
    {
      id: 'provider-1',
      name: 'Test Provider',
      type: 'openai',
      apiKey: 'test-api-key-that-must-not-appear-in-firestore',
      enabled: true,
      priority: 0,
    },
  ];

  it('round-trips provider data without placing the key in ciphertext fields', () => {
    const encrypted = encryptProviderVault(providers, TEST_SECRET, TEST_USER_ID);

    expect(JSON.stringify(encrypted)).not.toContain(providers[0].apiKey);
    expect(decryptProviderVault(encrypted, TEST_SECRET, TEST_USER_ID)).toEqual(providers);
  });

  it('binds ciphertext to its Firebase owner', () => {
    const encrypted = encryptProviderVault(providers, TEST_SECRET, TEST_USER_ID);

    expect(() =>
      decryptProviderVault(encrypted, TEST_SECRET, 'different-user'),
    ).toThrow(ProviderVaultCryptoError);
  });

  it('rejects tampered ciphertext without exposing sensitive details', () => {
    const encrypted = encryptProviderVault(providers, TEST_SECRET, TEST_USER_ID);
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64url');
    tamperedCiphertext[0] ^= 1;
    const tampered = {
      ...encrypted,
      ciphertext: tamperedCiphertext.toString('base64url'),
    };

    expect(() =>
      decryptProviderVault(tampered, TEST_SECRET, TEST_USER_ID),
    ).toThrow('AI provider storage is unavailable');
  });

  it('fails closed when the server encryption secret is too weak', () => {
    expect(() =>
      encryptProviderVault(providers, 'too-short', TEST_USER_ID),
    ).toThrow(ProviderVaultCryptoError);
  });

  it('round-trips v2 data with a raw 32-byte key and revision-bound AAD', () => {
    const key = Buffer.alloc(32, 42);
    const encrypted = encryptProviderVaultV2(
      providers,
      key,
      TEST_USER_ID,
      'primary',
      7,
    );

    expect(decryptProviderVaultV2(
      encrypted,
      key,
      TEST_USER_ID,
    )).toEqual(providers);
    expect(() =>
      decryptProviderVaultV2(
        { ...encrypted, revision: 8 },
        key,
        TEST_USER_ID,
      ),
    ).toThrow(ProviderVaultCryptoError);
  });

  it('rejects malformed v2 key material', () => {
    expect(() =>
      encryptProviderVaultV2(
        providers,
        Buffer.alloc(16),
        TEST_USER_ID,
        'primary',
        1,
      ),
    ).toThrow(ProviderVaultCryptoError);
  });
});
