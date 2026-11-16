import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const LEGACY_PROVIDER_VAULT_VERSION = 1;
const PROVIDER_VAULT_SCHEMA_VERSION = 2;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MIN_SECRET_LENGTH = 32;

export interface EncryptedProviderVault {
  version: typeof LEGACY_PROVIDER_VAULT_VERSION;
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface EncryptedProviderVaultV2 {
  schemaVersion: typeof PROVIDER_VAULT_SCHEMA_VERSION;
  keyId: string;
  revision: number;
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class ProviderVaultCryptoError extends Error {
  constructor() {
    super('AI provider storage is unavailable');
    this.name = 'ProviderVaultCryptoError';
  }
}

function requireSecret(secret: string): Buffer {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new ProviderVaultCryptoError();
  }

  return createHash('sha256')
    .update('investatlas:ai-provider-vault:', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function associatedData(userId: string): Buffer {
  if (!userId) {
    throw new ProviderVaultCryptoError();
  }

  return Buffer.from(
    `investatlas:ai-provider-vault:v${LEGACY_PROVIDER_VAULT_VERSION}:${userId}`,
    'utf8',
  );
}

function requireRawKey(key: Buffer): Buffer {
  if (key.byteLength !== 32) {
    throw new ProviderVaultCryptoError();
  }
  return key;
}

function associatedDataV2(
  userId: string,
  keyId: string,
  revision: number,
): Buffer {
  if (
    !userId
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)
    || !Number.isSafeInteger(revision)
    || revision < 1
  ) {
    throw new ProviderVaultCryptoError();
  }

  return Buffer.from(
    `investatlas:ai-provider-vault:v${PROVIDER_VAULT_SCHEMA_VERSION}:${userId}:${keyId}:${revision}`,
    'utf8',
  );
}

function decode(value: string): Buffer {
  if (!value || value.length > MAX_PLAINTEXT_BYTES * 2) {
    throw new ProviderVaultCryptoError();
  }

  try {
    return Buffer.from(value, 'base64url');
  } catch {
    throw new ProviderVaultCryptoError();
  }
}

export function encryptProviderVault(
  value: unknown,
  secret: string,
  userId: string,
): EncryptedProviderVault {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new ProviderVaultCryptoError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', requireSecret(secret), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(associatedData(userId));

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: LEGACY_PROVIDER_VAULT_VERSION,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptProviderVault(
  vault: EncryptedProviderVault,
  secret: string,
  userId: string,
): unknown {
  if (vault.version !== LEGACY_PROVIDER_VAULT_VERSION) {
    throw new ProviderVaultCryptoError();
  }

  const iv = decode(vault.iv);
  const authTag = decode(vault.authTag);
  const ciphertext = decode(vault.ciphertext);
  if (iv.byteLength !== IV_BYTES || authTag.byteLength !== AUTH_TAG_BYTES) {
    throw new ProviderVaultCryptoError();
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', requireSecret(secret), iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(associatedData(userId));
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new ProviderVaultCryptoError();
    }

    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new ProviderVaultCryptoError();
  }
}

export function encryptProviderVaultV2(
  value: unknown,
  key: Buffer,
  userId: string,
  keyId: string,
  revision: number,
): EncryptedProviderVaultV2 {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new ProviderVaultCryptoError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    requireRawKey(key),
    iv,
    { authTagLength: AUTH_TAG_BYTES },
  );
  cipher.setAAD(associatedDataV2(userId, keyId, revision));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    schemaVersion: PROVIDER_VAULT_SCHEMA_VERSION,
    keyId,
    revision,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptProviderVaultV2(
  vault: EncryptedProviderVaultV2,
  key: Buffer,
  userId: string,
): unknown {
  if (vault.schemaVersion !== PROVIDER_VAULT_SCHEMA_VERSION) {
    throw new ProviderVaultCryptoError();
  }

  const iv = decode(vault.iv);
  const authTag = decode(vault.authTag);
  const ciphertext = decode(vault.ciphertext);
  if (iv.byteLength !== IV_BYTES || authTag.byteLength !== AUTH_TAG_BYTES) {
    throw new ProviderVaultCryptoError();
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      requireRawKey(key),
      iv,
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAAD(
      associatedDataV2(userId, vault.keyId, vault.revision),
    );
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new ProviderVaultCryptoError();
    }

    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new ProviderVaultCryptoError();
  }
}
