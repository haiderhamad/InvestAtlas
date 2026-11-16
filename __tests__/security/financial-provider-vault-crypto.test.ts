import {
  decryptFinancialCredentialVault,
  encryptFinancialCredentialVault,
  FinancialCredentialCryptoError,
} from '@/lib/financial-data/providers/credential-vault-crypto';

describe('financial provider vault encryption', () => {
  const owner = 'owner-user';
  const key = Buffer.alloc(32, 17);
  const credential = [{
    id: 'tiingo',
    apiKey: 'secret-tiingo-key-that-must-stay-server-side',
    enabled: true,
    priority: 0,
    status: 'connected',
    detectedCapabilities: ['quote', 'history'],
    lastValidatedAt: '2026-08-09T10:00:00.000Z',
  }];

  it('round-trips without exposing plaintext in persisted fields', () => {
    const encrypted = encryptFinancialCredentialVault(
      credential,
      key,
      owner,
      'primary',
      4,
    );

    expect(JSON.stringify(encrypted)).not.toContain(credential[0].apiKey);
    expect(decryptFinancialCredentialVault(encrypted, key, owner)).toEqual(
      credential,
    );
  });

  it('binds ciphertext to both the Firebase owner and credential revision', () => {
    const encrypted = encryptFinancialCredentialVault(
      credential,
      key,
      owner,
      'primary',
      4,
    );

    expect(() => decryptFinancialCredentialVault(
      encrypted,
      key,
      'different-user',
    )).toThrow(FinancialCredentialCryptoError);
    expect(() => decryptFinancialCredentialVault(
      { ...encrypted, revision: 5 },
      key,
      owner,
    )).toThrow(FinancialCredentialCryptoError);
  });

  it('rejects tampered ciphertext and invalid key material generically', () => {
    const encrypted = encryptFinancialCredentialVault(
      credential,
      key,
      owner,
      'primary',
      1,
    );
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64url');
    ciphertext[0] ^= 1;

    expect(() => decryptFinancialCredentialVault(
      { ...encrypted, ciphertext: ciphertext.toString('base64url') },
      key,
      owner,
    )).toThrow('Financial provider storage is unavailable');
    expect(() => encryptFinancialCredentialVault(
      credential,
      Buffer.alloc(16),
      owner,
      'primary',
      1,
    )).toThrow(FinancialCredentialCryptoError);
  });
});
