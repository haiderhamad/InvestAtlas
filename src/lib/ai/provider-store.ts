/**
 * Server-owned, per-user AI-provider vault.
 *
 * Firebase ID tokens authenticate the caller. Firestore access uses a
 * server-only service account, so browser Security Rules can deny every vault
 * read and write. Vault mutations use Firestore update-time preconditions to
 * prevent lost updates under concurrent requests.
 */

import {
  FirebaseAdminUnavailableError,
  firebaseAdminFetch,
  getFirebaseAdminProjectId,
} from '@/lib/firebase/admin-rest';
import type { ProviderConfig, ProviderType } from './provider-registry';
import { generateProviderId, maskApiKey } from './provider-registry';
import {
  ProviderVaultCryptoError,
  decryptProviderVault,
  decryptProviderVaultV2,
  encryptProviderVaultV2,
  type EncryptedProviderVault,
  type EncryptedProviderVaultV2,
} from './provider-vault-crypto';

const MAX_PROVIDERS = 10;
const FIREBASE_REQUEST_TIMEOUT_MS = 8_000;
const MAX_FIREBASE_TOKEN_LENGTH = 16 * 1024;
const MAX_MUTATION_ATTEMPTS = 3;
const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PROVIDER_TYPES = new Set<ProviderType>([
  'gemini',
  'groq',
  'openrouter',
  'openai',
  'openai-compatible',
]);

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string };

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
}

interface VaultKeyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

interface ProviderVaultSnapshot {
  providers: ProviderConfig[];
  revision: number;
  exists: boolean;
  updateTime?: string;
  needsRewrap: boolean;
}

interface VaultMutationResult<T> {
  providers: ProviderConfig[];
  result: T;
  write: boolean;
}

class ProviderStoreConflictError extends Error {
  status = 409;

  constructor() {
    super('AI provider settings changed in another request');
    this.name = 'ProviderStoreConflictError';
  }
}

export class ProviderStoreAuthError extends Error {
  status = 401;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'ProviderStoreAuthError';
  }
}

export class ProviderStoreUnavailableError extends ProviderStoreAuthError {
  status = 503;

  constructor() {
    super('AI provider storage is temporarily unavailable');
    this.name = 'ProviderStoreUnavailableError';
  }
}

export interface ProviderStoreUser {
  uid: string;
  token: string;
}

export type SafeProviderConfig = Omit<ProviderConfig, 'apiKey' | 'baseUrl'> & {
  maskedKey: string;
};

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized
    || normalized.includes('generate-')
    || normalized.includes('replace')
    || normalized.includes('placeholder')
    || normalized.includes('example')
    || normalized.includes('test-only')
  );
}

function requireFirebaseServerEnv(name: string): string {
  const value = process.env[name];
  if (!value || isPlaceholder(value)) {
    throw new ProviderStoreUnavailableError();
  }
  return value;
}

function decodeVaultKey(value: unknown): Buffer {
  if (typeof value !== 'string' || isPlaceholder(value)) {
    throw new ProviderStoreUnavailableError();
  }

  const normalized = value.trim();
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(normalized)) {
    throw new ProviderStoreUnavailableError();
  }

  const decoded = Buffer.from(normalized, 'base64');
  const canonicalInput = normalized.replace(/=+$/, '');
  const canonicalDecoded = decoded.toString('base64').replace(/=+$/, '');
  if (decoded.byteLength !== 32 || canonicalInput !== canonicalDecoded) {
    throw new ProviderStoreUnavailableError();
  }
  return decoded;
}

function readVaultKeyring(): VaultKeyring {
  const activeKeyId = requireFirebaseServerEnv(
    'AI_PROVIDER_VAULT_ACTIVE_KEY_ID',
  );
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new ProviderStoreUnavailableError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      requireFirebaseServerEnv('AI_PROVIDER_VAULT_KEYS'),
    );
  } catch {
    throw new ProviderStoreUnavailableError();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderStoreUnavailableError();
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 4) {
    throw new ProviderStoreUnavailableError();
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encodedKey] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new ProviderStoreUnavailableError();
    }
    keys.set(keyId, decodeVaultKey(encodedKey));
  }

  if (!keys.has(activeKeyId)) {
    throw new ProviderStoreUnavailableError();
  }

  return { activeKeyId, keys };
}

function readLegacyEncryptionSecret(): string {
  return requireFirebaseServerEnv('ENCRYPTION_KEY');
}

function firestoreBaseUrl(): string {
  const projectId = getFirebaseAdminProjectId();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function vaultDocumentPath(user: ProviderStoreUser): string {
  return `users/${encodeURIComponent(user.uid)}/aiProviderVault/config`;
}

function vaultDocumentName(user: ProviderStoreUser): string {
  return `projects/${getFirebaseAdminProjectId()}/databases/(default)/documents/${vaultDocumentPath(user)}`;
}

function accountDeletionMarkerName(user: ProviderStoreUser): string {
  return `projects/${getFirebaseAdminProjectId()}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}/accountDeletion/state`;
}

function getBearerToken(request: Request): string | null {
  const header =
    request.headers.get('authorization')
    || request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return isValidFirebaseToken(token) ? token : null;
}

function isValidFirebaseToken(token: string): boolean {
  return (
    token.length >= 20
    && token.length <= MAX_FIREBASE_TOKEN_LENGTH
    && !/[\r\n]/u.test(token)
  );
}

export function getOptionalFirebaseAuthToken(request: Request): string | null {
  return getBearerToken(request);
}

async function verifyFirebaseToken(token: string): Promise<string> {
  const apiKey = requireFirebaseServerEnv('NEXT_PUBLIC_FIREBASE_API_KEY');
  let response: Response;

  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(FIREBASE_REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch {
    throw new ProviderStoreUnavailableError();
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new ProviderStoreUnavailableError();
    }
    throw new ProviderStoreAuthError(
      'Invalid or expired Firebase session',
    );
  }

  try {
    const data = await response.json();
    const uid = data.users?.[0]?.localId;
    if (
      typeof uid !== 'string'
      || !FIREBASE_UID_PATTERN.test(uid)
    ) {
      throw new ProviderStoreAuthError('Invalid Firebase session');
    }
    return uid;
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) throw error;
    throw new ProviderStoreAuthError('Invalid Firebase session');
  }
}

export async function requireFirebaseUser(
  request: Request,
): Promise<ProviderStoreUser> {
  const token = getBearerToken(request);
  if (!token) {
    throw new ProviderStoreAuthError();
  }

  const uid = await verifyFirebaseToken(token);
  return { uid, token };
}

export async function getFirebaseUserFromToken(
  token: string,
): Promise<ProviderStoreUser> {
  if (!isValidFirebaseToken(token)) {
    throw new ProviderStoreAuthError();
  }
  const uid = await verifyFirebaseToken(token);
  return { uid, token };
}

function getString(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
): string | undefined {
  const value = fields?.[key];
  return value && 'stringValue' in value
    ? value.stringValue
    : undefined;
}

function getNumber(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
): number | undefined {
  const value = fields?.[key];
  return value && 'integerValue' in value
    ? Number(value.integerValue)
    : undefined;
}

function optionalString(
  value: unknown,
  maxLength: number,
): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    ? value
    : undefined;
}

function normalizeProviders(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value) || value.length > MAX_PROVIDERS) {
    throw new ProviderStoreUnavailableError();
  }

  return value.map((entry): ProviderConfig => {
    if (!entry || typeof entry !== 'object') {
      throw new ProviderStoreUnavailableError();
    }

    const candidate = entry as Record<string, unknown>;
    const type = candidate.type;
    if (
      typeof candidate.id !== 'string'
      || !PROVIDER_ID_PATTERN.test(candidate.id)
      || typeof candidate.name !== 'string'
      || candidate.name.length < 1
      || candidate.name.length > 80
      || typeof type !== 'string'
      || !PROVIDER_TYPES.has(type as ProviderType)
      || typeof candidate.apiKey !== 'string'
      || candidate.apiKey.length < 1
      || candidate.apiKey.length > 4_096
      || typeof candidate.enabled !== 'boolean'
      || !Number.isInteger(candidate.priority)
      || Number(candidate.priority) < 0
      || Number(candidate.priority) > 100
    ) {
      throw new ProviderStoreUnavailableError();
    }

    const lastTestStatus = optionalString(candidate.lastTestStatus, 32);
    const validLastTestStatus =
      lastTestStatus === 'ok'
      || lastTestStatus === 'error'
      || lastTestStatus === 'rate_limit'
      || lastTestStatus === 'unreachable'
        ? lastTestStatus
        : undefined;
    const detectedModels = Array.isArray(candidate.detectedModels)
      ? candidate.detectedModels
          .filter(
            (model): model is string =>
              typeof model === 'string'
              && model.length > 0
              && model.length <= 160,
          )
          .slice(0, 100)
      : undefined;

    return {
      id: candidate.id,
      name: candidate.name,
      type: type as ProviderType,
      apiKey: candidate.apiKey,
      model: optionalString(candidate.model, 160),
      orgId: optionalString(candidate.orgId, 160),
      enabled: candidate.enabled,
      priority: Number(candidate.priority),
      notes: optionalString(candidate.notes, 1_000),
      lastTestAt: optionalString(candidate.lastTestAt, 64),
      lastTestStatus: validLastTestStatus,
      lastTestMessage: optionalString(candidate.lastTestMessage, 500),
      detectedModels,
    };
  });
}

function toSafeProvider(provider: ProviderConfig): SafeProviderConfig {
  const { apiKey, baseUrl: _legacyBaseUrl, ...safeProvider } = provider;
  void _legacyBaseUrl;
  return {
    ...safeProvider,
    maskedKey: maskApiKey(apiKey),
  };
}

function encryptedVaultToFirestoreFields(
  encrypted: EncryptedProviderVaultV2,
  user: ProviderStoreUser,
): Record<string, FirestoreValue> {
  return {
    userId: { stringValue: user.uid },
    schemaVersion: {
      integerValue: String(encrypted.schemaVersion),
    },
    keyId: { stringValue: encrypted.keyId },
    revision: { integerValue: String(encrypted.revision) },
    ciphertext: { stringValue: encrypted.ciphertext },
    iv: { stringValue: encrypted.iv },
    authTag: { stringValue: encrypted.authTag },
    updatedAt: { stringValue: new Date().toISOString() },
  };
}

function isConflictResponse(status: number, body: string): boolean {
  return (
    status === 409
    || body.includes('FAILED_PRECONDITION')
    || body.includes('ABORTED')
  );
}

async function writeProviderVault(
  user: ProviderStoreUser,
  providers: ProviderConfig[],
  snapshot: ProviderVaultSnapshot,
): Promise<void> {
  const keyring = readVaultKeyring();
  const revision = snapshot.revision + 1;
  let encrypted: EncryptedProviderVaultV2;

  try {
    encrypted = encryptProviderVaultV2(
      normalizeProviders(providers),
      keyring.keys.get(keyring.activeKeyId) as Buffer,
      user.uid,
      keyring.activeKeyId,
      revision,
    );
  } catch (error) {
    if (error instanceof ProviderVaultCryptoError) {
      throw new ProviderStoreUnavailableError();
    }
    throw error;
  }

  const currentDocument = snapshot.exists
    ? snapshot.updateTime
      ? { updateTime: snapshot.updateTime }
      : null
    : { exists: false };
  if (!currentDocument) {
    throw new ProviderStoreUnavailableError();
  }

  let response: Response;
  try {
    response = await firebaseAdminFetch(
      `${firestoreBaseUrl()}:commit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              update: {
                name: vaultDocumentName(user),
                fields: encryptedVaultToFirestoreFields(
                  encrypted,
                  user,
                ),
              },
              currentDocument,
            },
            {
              verify: accountDeletionMarkerName(user),
              currentDocument: { exists: false },
            },
          ],
        }),
      },
    );
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      throw new ProviderStoreUnavailableError();
    }
    throw error;
  }

  if (!response.ok) {
    const responseBody = await response.text();
    if (isConflictResponse(response.status, responseBody)) {
      throw new ProviderStoreConflictError();
    }
    throw new ProviderStoreUnavailableError();
  }
}

function providersFromV2Document(
  document: FirestoreDocument,
  user: ProviderStoreUser,
  keyring: VaultKeyring,
): ProviderVaultSnapshot {
  const fields = document.fields;
  const storedUserId = getString(fields, 'userId');
  const schemaVersion = getNumber(fields, 'schemaVersion');
  const keyId = getString(fields, 'keyId');
  const revision = getNumber(fields, 'revision');
  const ciphertext = getString(fields, 'ciphertext');
  const iv = getString(fields, 'iv');
  const authTag = getString(fields, 'authTag');
  const key = keyId ? keyring.keys.get(keyId) : undefined;

  if (
    storedUserId !== user.uid
    || schemaVersion !== 2
    || !keyId
    || !KEY_ID_PATTERN.test(keyId)
    || !Number.isSafeInteger(revision)
    || Number(revision) < 1
    || !ciphertext
    || !iv
    || !authTag
    || !key
    || !document.updateTime
  ) {
    throw new ProviderStoreUnavailableError();
  }

  try {
    const providers = normalizeProviders(
      decryptProviderVaultV2(
        {
          schemaVersion,
          keyId,
          revision: Number(revision),
          ciphertext,
          iv,
          authTag,
        },
        key,
        user.uid,
      ),
    );
    return {
      providers,
      revision: Number(revision),
      exists: true,
      updateTime: document.updateTime,
      needsRewrap: keyId !== keyring.activeKeyId,
    };
  } catch (error) {
    if (error instanceof ProviderVaultCryptoError) {
      throw new ProviderStoreUnavailableError();
    }
    throw error;
  }
}

function providersFromLegacyDocument(
  document: FirestoreDocument,
  user: ProviderStoreUser,
): ProviderVaultSnapshot {
  const fields = document.fields;
  const storedUserId = getString(fields, 'userId');
  const version = getNumber(fields, 'version');
  const ciphertext = getString(fields, 'ciphertext');
  const iv = getString(fields, 'iv');
  const authTag = getString(fields, 'authTag');

  if (
    storedUserId !== user.uid
    || version !== 1
    || !ciphertext
    || !iv
    || !authTag
    || !document.updateTime
  ) {
    throw new ProviderStoreUnavailableError();
  }

  try {
    const legacyVault: EncryptedProviderVault = {
      version,
      ciphertext,
      iv,
      authTag,
    };
    return {
      providers: normalizeProviders(
        decryptProviderVault(
          legacyVault,
          readLegacyEncryptionSecret(),
          user.uid,
        ),
      ),
      revision: 0,
      exists: true,
      updateTime: document.updateTime,
      needsRewrap: true,
    };
  } catch (error) {
    if (
      error instanceof ProviderVaultCryptoError
      || error instanceof ProviderStoreUnavailableError
    ) {
      throw new ProviderStoreUnavailableError();
    }
    throw error;
  }
}

async function readProviderVaultSnapshot(
  user: ProviderStoreUser,
): Promise<ProviderVaultSnapshot> {
  const keyring = readVaultKeyring();
  let response: Response;

  try {
    response = await firebaseAdminFetch(
      `${firestoreBaseUrl()}/${vaultDocumentPath(user)}`,
    );
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      throw new ProviderStoreUnavailableError();
    }
    throw error;
  }

  if (response.status === 404) {
    return {
      providers: [],
      revision: 0,
      exists: false,
      needsRewrap: false,
    };
  }
  if (!response.ok) {
    throw new ProviderStoreUnavailableError();
  }

  let document: FirestoreDocument;
  try {
    document = (await response.json()) as FirestoreDocument;
  } catch {
    throw new ProviderStoreUnavailableError();
  }

  if (getNumber(document.fields, 'schemaVersion') === 2) {
    return providersFromV2Document(document, user, keyring);
  }
  return providersFromLegacyDocument(document, user);
}

async function readProviderDocuments(
  user: ProviderStoreUser,
): Promise<ProviderConfig[]> {
  const snapshot = await readProviderVaultSnapshot(user);
  if (snapshot.needsRewrap) {
    try {
      await writeProviderVault(user, snapshot.providers, snapshot);
    } catch (error) {
      if (!(error instanceof ProviderStoreConflictError)) {
        throw error;
      }
    }
  }
  return [...snapshot.providers].sort(
    (left, right) => left.priority - right.priority,
  );
}

async function mutateProviderVault<T>(
  user: ProviderStoreUser,
  mutate: (
    providers: ProviderConfig[],
  ) => VaultMutationResult<T>,
): Promise<T> {
  for (
    let attempt = 0;
    attempt < MAX_MUTATION_ATTEMPTS;
    attempt += 1
  ) {
    const snapshot = await readProviderVaultSnapshot(user);
    const mutation = mutate(
      snapshot.providers.map((provider) => ({ ...provider })),
    );
    if (!mutation.write) {
      return mutation.result;
    }

    try {
      await writeProviderVault(user, mutation.providers, snapshot);
      return mutation.result;
    } catch (error) {
      if (
        error instanceof ProviderStoreConflictError
        && attempt < MAX_MUTATION_ATTEMPTS - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new ProviderStoreConflictError();
}

export async function getAllProviders(
  user: ProviderStoreUser,
): Promise<SafeProviderConfig[]> {
  const providers = await readProviderDocuments(user);
  return providers.map(toSafeProvider);
}

export async function getAllProvidersRaw(
  user: ProviderStoreUser,
): Promise<ProviderConfig[]> {
  return readProviderDocuments(user);
}

export async function getActiveProviders(
  user: ProviderStoreUser,
): Promise<ProviderConfig[]> {
  const providers = await readProviderDocuments(user);
  return providers
    .filter((provider) => provider.enabled && provider.apiKey)
    .sort((left, right) => left.priority - right.priority);
}

export async function getProvider(
  user: ProviderStoreUser,
  id: string,
): Promise<ProviderConfig | null> {
  const providers = await readProviderDocuments(user);
  return providers.find((provider) => provider.id === id) ?? null;
}

export async function addProvider(
  user: ProviderStoreUser,
  config: Omit<ProviderConfig, 'id'>,
): Promise<ProviderConfig> {
  const providerId = generateProviderId();
  return mutateProviderVault(user, (providers) => {
    if (providers.length >= MAX_PROVIDERS) {
      throw new ProviderStoreUnavailableError();
    }

    const newProvider = normalizeProviders([
      {
        ...config,
        id: providerId,
        priority: config.priority ?? providers.length,
      },
    ])[0];
    return {
      providers: [...providers, newProvider],
      result: newProvider,
      write: true,
    };
  });
}

export async function updateProvider(
  user: ProviderStoreUser,
  id: string,
  updates: Partial<ProviderConfig>,
): Promise<ProviderConfig | null> {
  return mutateProviderVault(user, (providers) => {
    const index = providers.findIndex(
      (provider) => provider.id === id,
    );
    if (index < 0) {
      return { providers, result: null, write: false };
    }

    const current = providers[index];
    const nextUpdates = { ...updates };
    if (
      nextUpdates.apiKey
      && nextUpdates.apiKey.startsWith('●')
    ) {
      delete nextUpdates.apiKey;
    }
    const nextProvider = normalizeProviders([
      {
        ...current,
        ...nextUpdates,
        id,
        apiKey: nextUpdates.apiKey || current.apiKey,
      },
    ])[0];
    const nextProviders = [...providers];
    nextProviders[index] = nextProvider;
    return {
      providers: nextProviders,
      result: nextProvider,
      write: true,
    };
  });
}

export async function deleteProvider(
  user: ProviderStoreUser,
  id: string,
): Promise<boolean> {
  return mutateProviderVault(user, (providers) => {
    const remaining = providers.filter(
      (provider) => provider.id !== id,
    );
    if (remaining.length === providers.length) {
      return { providers, result: false, write: false };
    }

    return {
      providers: remaining.map((provider, index) => ({
        ...provider,
        priority: index,
      })),
      result: true,
      write: true,
    };
  });
}

export async function reorderProviders(
  user: ProviderStoreUser,
  orderedIds: string[],
): Promise<void> {
  await mutateProviderVault(user, (providers) => {
    const map = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    const reordered: ProviderConfig[] = [];

    for (const id of orderedIds) {
      const provider = map.get(id);
      if (provider) {
        reordered.push(provider);
        map.delete(id);
      }
    }
    for (const provider of map.values()) {
      reordered.push(provider);
    }

    return {
      providers: reordered.map((provider, index) => ({
        ...provider,
        priority: index,
      })),
      result: undefined,
      write: true,
    };
  });
}
