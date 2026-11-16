import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const SCHEMA_VERSION = 1;
const DOMAIN = 'investatlas:financial-provider-vault';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 32 * 1024;

export interface EncryptedFinancialCredentialVault {
  schemaVersion: typeof SCHEMA_VERSION;
  keyId: string;
  revision: number;
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class FinancialCredentialCryptoError extends Error {
  constructor() {
    super('Financial provider storage is unavailable');
    this.name = 'FinancialCredentialCryptoError';
  }
}

function derivedKey(key: Buffer): Buffer {
  if (key.byteLength !== 32) throw new FinancialCredentialCryptoError();
  return createHmac('sha256', key)
    .update(`${DOMAIN}:encryption-key:v1`, 'utf8')
    .digest();
}

function associatedData(
  userId: string,
  keyId: string,
  revision: number,
): Buffer {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(userId)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId)
    || !Number.isSafeInteger(revision)
    || revision < 1
  ) {
    throw new FinancialCredentialCryptoError();
  }
  return Buffer.from(
    `${DOMAIN}:v${SCHEMA_VERSION}:${userId}:${keyId}:${revision}`,
    'utf8',
  );
}

function decode(value: string): Buffer {
  if (!value || value.length > MAX_PLAINTEXT_BYTES * 2) {
    throw new FinancialCredentialCryptoError();
  }
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    throw new FinancialCredentialCryptoError();
  }
}

export function encryptFinancialCredentialVault(
  value: unknown,
  key: Buffer,
  userId: string,
  keyId: string,
  revision: number,
): EncryptedFinancialCredentialVault {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new FinancialCredentialCryptoError();
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(key), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(associatedData(userId, keyId, revision));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    schemaVersion: SCHEMA_VERSION,
    keyId,
    revision,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptFinancialCredentialVault(
  vault: EncryptedFinancialCredentialVault,
  key: Buffer,
  userId: string,
): unknown {
  if (vault.schemaVersion !== SCHEMA_VERSION) {
    throw new FinancialCredentialCryptoError();
  }
  const iv = decode(vault.iv);
  const authTag = decode(vault.authTag);
  const ciphertext = decode(vault.ciphertext);
  if (iv.byteLength !== IV_BYTES || authTag.byteLength !== AUTH_TAG_BYTES) {
    throw new FinancialCredentialCryptoError();
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', derivedKey(key), iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(associatedData(userId, vault.keyId, vault.revision));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new FinancialCredentialCryptoError();
    }
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new FinancialCredentialCryptoError();
  }
}
