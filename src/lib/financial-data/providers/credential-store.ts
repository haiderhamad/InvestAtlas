import {
  FirebaseAdminUnavailableError,
  firebaseAdminFetch,
  getFirebaseAdminProjectId,
} from '@/lib/firebase/admin-rest';
import type { FinancialCapability } from '@/lib/financial-data/contracts';
import type { ProviderStoreUser } from '@/lib/ai/provider-store';
import {
  decryptFinancialCredentialVault,
  encryptFinancialCredentialVault,
  FinancialCredentialCryptoError,
  type EncryptedFinancialCredentialVault,
} from './credential-vault-crypto';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MUTATION_ATTEMPTS = 3;
const MAX_VAULT_KEYS = 4;
const SUPPORTED_PROVIDER_IDS = new Set(['tiingo']);

export type FinancialProviderId = 'tiingo';
export type FinancialConnectionStatus =
  | 'connected'
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'provider_unavailable'
  | 'unexpected_response'
  | 'capability_unavailable'
  | 'misconfigured';

export interface FinancialProviderCredential {
  id: FinancialProviderId;
  apiKey: string;
  enabled: boolean;
  priority: number;
  status: FinancialConnectionStatus;
  detectedCapabilities: FinancialCapability[];
  lastValidatedAt: string;
}

export type SafeFinancialProviderCredential = Omit<
  FinancialProviderCredential,
  'apiKey'
> & {
  maskedKey: string;
  credentialRevision: number;
};

type FirestoreValue = { stringValue: string } | { integerValue: string };
interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
}
interface Snapshot {
  credentials: FinancialProviderCredential[];
  revision: number;
  exists: boolean;
  updateTime?: string;
  keyId?: string;
}

class CredentialConflictError extends Error {}

export class FinancialCredentialStoreError extends Error {
  status: number;
  constructor(message = 'Financial provider storage is temporarily unavailable', status = 503) {
    super(message);
    this.name = 'FinancialCredentialStoreError';
    this.status = status;
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized
    || normalized.includes('replace')
    || normalized.includes('placeholder')
    || normalized.includes('example')
    || normalized.includes('test-only');
}

function readKeyring(): { activeKeyId: string; keys: Map<string, Buffer> } {
  const activeKeyId = process.env.AI_PROVIDER_VAULT_ACTIVE_KEY_ID ?? '';
  const raw = process.env.AI_PROVIDER_VAULT_KEYS ?? '';
  if (!KEY_ID_PATTERN.test(activeKeyId) || isPlaceholder(raw)) {
    throw new FinancialCredentialStoreError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FinancialCredentialStoreError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FinancialCredentialStoreError();
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_VAULT_KEYS) {
    throw new FinancialCredentialStoreError();
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, value] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof value !== 'string') {
      throw new FinancialCredentialStoreError();
    }
    const normalized = value.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
      throw new FinancialCredentialStoreError();
    }
    const decoded = Buffer.from(normalized, 'base64');
    if (
      decoded.byteLength !== 32
      || decoded.toString('base64').replace(/=+$/, '')
        !== normalized.replace(/=+$/, '')
    ) {
      throw new FinancialCredentialStoreError();
    }
    keys.set(keyId, decoded);
  }
  if (!keys.has(activeKeyId)) throw new FinancialCredentialStoreError();
  return { activeKeyId, keys };
}

function baseUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getFirebaseAdminProjectId())}/databases/(default)/documents`;
}

function documentPath(user: ProviderStoreUser): string {
  return `users/${encodeURIComponent(user.uid)}/financialProviderVault/config`;
}

function documentName(user: ProviderStoreUser): string {
  return `projects/${getFirebaseAdminProjectId()}/databases/(default)/documents/${documentPath(user)}`;
}

function deletionMarkerName(user: ProviderStoreUser): string {
  return `projects/${getFirebaseAdminProjectId()}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}/accountDeletion/state`;
}

function getString(fields: Record<string, FirestoreValue> | undefined, key: string) {
  const value = fields?.[key];
  return value && 'stringValue' in value ? value.stringValue : undefined;
}

function getNumber(fields: Record<string, FirestoreValue> | undefined, key: string) {
  const value = fields?.[key];
  return value && 'integerValue' in value ? Number(value.integerValue) : undefined;
}

function normalizeCredentials(value: unknown): FinancialProviderCredential[] {
  if (!Array.isArray(value) || value.length > SUPPORTED_PROVIDER_IDS.size) {
    throw new FinancialCredentialStoreError();
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new FinancialCredentialStoreError();
    const candidate = entry as Record<string, unknown>;
    const id = candidate.id;
    const capabilities = candidate.detectedCapabilities;
    if (
      typeof id !== 'string'
      || !SUPPORTED_PROVIDER_IDS.has(id)
      || seen.has(id)
      || typeof candidate.apiKey !== 'string'
      || candidate.apiKey.length < 8
      || candidate.apiKey.length > 4096
      || typeof candidate.enabled !== 'boolean'
      || !Number.isInteger(candidate.priority)
      || Number(candidate.priority) < 0
      || Number(candidate.priority) > 100
      || candidate.status !== 'connected'
      || !Array.isArray(capabilities)
      || capabilities.some((capability) => capability !== 'quote' && capability !== 'history')
      || typeof candidate.lastValidatedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.lastValidatedAt))
    ) {
      throw new FinancialCredentialStoreError();
    }
    seen.add(id);
    return {
      id: id as FinancialProviderId,
      apiKey: candidate.apiKey,
      enabled: candidate.enabled,
      priority: Number(candidate.priority),
      status: 'connected',
      detectedCapabilities: [...capabilities] as FinancialCapability[],
      lastValidatedAt: candidate.lastValidatedAt,
    };
  });
}

function safe(
  credential: FinancialProviderCredential,
  revision: number,
): SafeFinancialProviderCredential {
  return {
    id: credential.id,
    enabled: credential.enabled,
    priority: credential.priority,
    status: credential.status,
    detectedCapabilities: [...credential.detectedCapabilities],
    lastValidatedAt: credential.lastValidatedAt,
    maskedKey: credential.apiKey.length <= 8
      ? '••••••••'
      : `${credential.apiKey.slice(0, 3)}••••${credential.apiKey.slice(-4)}`,
    credentialRevision: revision,
  };
}

async function readSnapshot(
  user: ProviderStoreUser,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const keyring = readKeyring();
  let response: Response;
  try {
    response = await firebaseAdminFetch(
      `${baseUrl()}/${documentPath(user)}`,
      signal ? { signal } : undefined,
    );
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      throw new FinancialCredentialStoreError();
    }
    throw error;
  }
  if (response.status === 404) {
    return { credentials: [], revision: 0, exists: false };
  }
  if (!response.ok) throw new FinancialCredentialStoreError();
  const document = await response.json() as FirestoreDocument;
  const fields = document.fields;
  const userId = getString(fields, 'userId');
  const schemaVersion = getNumber(fields, 'schemaVersion');
  const keyId = getString(fields, 'keyId');
  const revision = getNumber(fields, 'revision');
  const ciphertext = getString(fields, 'ciphertext');
  const iv = getString(fields, 'iv');
  const authTag = getString(fields, 'authTag');
  const key = keyId ? keyring.keys.get(keyId) : undefined;
  if (
    userId !== user.uid
    || schemaVersion !== 1
    || !keyId
    || !key
    || !Number.isSafeInteger(revision)
    || Number(revision) < 1
    || !ciphertext
    || !iv
    || !authTag
    || !document.updateTime
  ) {
    throw new FinancialCredentialStoreError();
  }
  try {
    return {
      credentials: normalizeCredentials(decryptFinancialCredentialVault({
        schemaVersion: 1,
        keyId,
        revision: Number(revision),
        ciphertext,
        iv,
        authTag,
      }, key, user.uid)),
      revision: Number(revision),
      exists: true,
      updateTime: document.updateTime,
      keyId,
    };
  } catch (error) {
    if (error instanceof FinancialCredentialCryptoError) {
      throw new FinancialCredentialStoreError();
    }
    throw error;
  }
}

async function writeSnapshot(
  user: ProviderStoreUser,
  credentials: FinancialProviderCredential[],
  snapshot: Snapshot,
  signal?: AbortSignal,
): Promise<number> {
  const keyring = readKeyring();
  const revision = snapshot.revision + 1;
  const encrypted = encryptFinancialCredentialVault(
    normalizeCredentials(credentials),
    keyring.keys.get(keyring.activeKeyId) as Buffer,
    user.uid,
    keyring.activeKeyId,
    revision,
  );
  const fields: Record<string, FirestoreValue> = {
    userId: { stringValue: user.uid },
    schemaVersion: { integerValue: String(encrypted.schemaVersion) },
    keyId: { stringValue: encrypted.keyId },
    revision: { integerValue: String(encrypted.revision) },
    ciphertext: { stringValue: encrypted.ciphertext },
    iv: { stringValue: encrypted.iv },
    authTag: { stringValue: encrypted.authTag },
    updatedAt: { stringValue: new Date().toISOString() },
  };
  const currentDocument = snapshot.exists
    ? snapshot.updateTime ? { updateTime: snapshot.updateTime } : null
    : { exists: false };
  if (!currentDocument) throw new FinancialCredentialStoreError();
  const response = await firebaseAdminFetch(`${baseUrl()}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [
        { update: { name: documentName(user), fields }, currentDocument },
        { verify: deletionMarkerName(user), currentDocument: { exists: false } },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 409 || body.includes('FAILED_PRECONDITION') || body.includes('ABORTED')) {
      throw new CredentialConflictError();
    }
    throw new FinancialCredentialStoreError();
  }
  return revision;
}

async function mutate<T>(
  user: ProviderStoreUser,
  callback: (credentials: FinancialProviderCredential[]) => {
    credentials: FinancialProviderCredential[];
    value: T;
  },
): Promise<{ value: T; revision: number }> {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const snapshot = await readSnapshot(user);
    const mutation = callback(snapshot.credentials.map((credential) => ({
      ...credential,
      detectedCapabilities: [...credential.detectedCapabilities],
    })));
    try {
      const revision = await writeSnapshot(user, mutation.credentials, snapshot);
      return { value: mutation.value, revision };
    } catch (error) {
      if (error instanceof CredentialConflictError) {
        if (attempt < MAX_MUTATION_ATTEMPTS - 1) continue;
        throw new FinancialCredentialStoreError(
          'Financial provider settings changed in another request',
          409,
        );
      }
      throw error;
    }
  }
  throw new FinancialCredentialStoreError();
}

async function readCurrentSnapshot(
  user: ProviderStoreUser,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const snapshot = await readSnapshot(user, signal);
  const activeKeyId = readKeyring().activeKeyId;
  if (!snapshot.exists || snapshot.keyId === activeKeyId) return snapshot;

  try {
    const revision = await writeSnapshot(
      user,
      snapshot.credentials,
      snapshot,
      signal,
    );
    return {
      ...snapshot,
      revision,
      keyId: activeKeyId,
    };
  } catch (error) {
    // A concurrent mutation either already rewrapped the vault or superseded
    // this snapshot. Re-read instead of overwriting that newer revision.
    if (error instanceof CredentialConflictError) return readSnapshot(user, signal);
    throw error;
  }
}

export async function listFinancialCredentials(
  user: ProviderStoreUser,
  signal?: AbortSignal,
): Promise<SafeFinancialProviderCredential[]> {
  const snapshot = await readCurrentSnapshot(user, signal);
  return snapshot.credentials
    .sort((left, right) => left.priority - right.priority)
    .map((credential) => safe(credential, snapshot.revision));
}

export async function listFinancialCredentialsRaw(
  user: ProviderStoreUser,
  signal?: AbortSignal,
): Promise<Array<FinancialProviderCredential & { credentialRevision: number }>> {
  const snapshot = await readCurrentSnapshot(user, signal);
  return snapshot.credentials
    .sort((left, right) => left.priority - right.priority)
    .map((credential) => ({ ...credential, credentialRevision: snapshot.revision }));
}

export async function upsertFinancialCredential(
  user: ProviderStoreUser,
  credential: FinancialProviderCredential,
): Promise<SafeFinancialProviderCredential> {
  const result = await mutate(user, (credentials) => {
    const next = credentials.filter((item) => item.id !== credential.id);
    next.push(credential);
    return { credentials: next, value: credential };
  });
  return safe(result.value, result.revision);
}

export async function deleteFinancialCredential(
  user: ProviderStoreUser,
  providerId: FinancialProviderId,
): Promise<boolean> {
  const result = await mutate(user, (credentials) => ({
    credentials: credentials.filter((credential) => credential.id !== providerId),
    value: credentials.some((credential) => credential.id === providerId),
  }));
  return result.value;
}
