import {
  FirebaseAdminUnavailableError,
  firebaseAdminFetch,
  getFirebaseAdminProjectId,
} from '@/lib/firebase/admin-rest';
import { hasRecentAuthentication } from '@/lib/auth/recent-auth';

const FIREBASE_REQUEST_TIMEOUT_MS = 8_000;
const MAX_FIREBASE_TOKEN_LENGTH = 16 * 1024;
const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DELETE_BATCH_SIZE = 500;
const MAX_COLLECTION_DELETE_ROUNDS = 20;
const MAX_SUBCOLLECTION_DOCUMENTS = 5_000;
const TOP_LEVEL_USER_COLLECTIONS = [
  'transactions',
  'manual-accounts',
  'asset-risks',
] as const;
const USER_SUBCOLLECTIONS = [
  'aiProviderVault',
  'aiProviders',
  'financialProviderVault',
] as const;

interface FirebaseTokenClaims {
  aud?: unknown;
  auth_time?: unknown;
  exp?: unknown;
  iat?: unknown;
  iss?: unknown;
  sub?: unknown;
  user_id?: unknown;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: unknown;
  }>;
}

interface FirestoreDocument {
  name?: unknown;
}

interface FirestoreRunQueryResult {
  document?: FirestoreDocument;
}

interface FirestoreListResponse {
  documents?: FirestoreDocument[];
  nextPageToken?: unknown;
}

export interface RecentFirebaseAccount {
  uid: string;
  token: string;
}

export class FirebaseAccountAuthError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'FirebaseAccountAuthError';
  }
}

export class FirebaseAccountRecentAuthError extends Error {
  constructor() {
    super('Recent authentication required');
    this.name = 'FirebaseAccountRecentAuthError';
  }
}

export class FirebaseAccountDeletionUnavailableError extends Error {
  constructor() {
    super('Account deletion is temporarily unavailable');
    this.name = 'FirebaseAccountDeletionUnavailableError';
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized
    || normalized.includes('your-')
    || normalized.includes('replace')
    || normalized.includes('example')
    || normalized.includes('placeholder')
  );
}

function requireFirebaseApiKey(): string {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey || isPlaceholder(apiKey)) {
    throw new FirebaseAccountDeletionUnavailableError();
  }
  return apiKey;
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new FirebaseAccountAuthError();
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (
    token.length < 20
    || token.length > MAX_FIREBASE_TOKEN_LENGTH
    || /[\r\n]/.test(token)
  ) {
    throw new FirebaseAccountAuthError();
  }
  return token;
}

function decodeTokenClaims(token: string): FirebaseTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1].length > MAX_FIREBASE_TOKEN_LENGTH) {
    throw new FirebaseAccountAuthError();
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FirebaseAccountAuthError();
    }
    return parsed as FirebaseTokenClaims;
  } catch (error) {
    if (error instanceof FirebaseAccountAuthError) throw error;
    throw new FirebaseAccountAuthError();
  }
}

function validateTokenClaims(
  claims: FirebaseTokenClaims,
  uid: string,
  projectId: string,
  now: number,
): number {
  const nowSeconds = Math.floor(now / 1_000);
  if (
    claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || claims.sub !== uid
    || (
      claims.user_id !== undefined
      && claims.user_id !== uid
    )
    || !Number.isInteger(claims.auth_time)
    || Number(claims.auth_time) <= 0
    || !Number.isInteger(claims.iat)
    || Number(claims.iat) > nowSeconds + 60
    || !Number.isInteger(claims.exp)
    || Number(claims.exp) <= nowSeconds
  ) {
    throw new FirebaseAccountAuthError();
  }

  return Number(claims.auth_time);
}

async function lookupFirebaseUser(token: string): Promise<string> {
  const apiKey = requireFirebaseApiKey();
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
    throw new FirebaseAccountDeletionUnavailableError();
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new FirebaseAccountDeletionUnavailableError();
    }
    throw new FirebaseAccountAuthError();
  }

  let payload: FirebaseLookupResponse;
  try {
    payload = await response.json() as FirebaseLookupResponse;
  } catch {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const uid = payload.users?.[0]?.localId;
  if (typeof uid !== 'string' || !FIREBASE_UID_PATTERN.test(uid)) {
    throw new FirebaseAccountAuthError();
  }
  return uid;
}

export async function requireRecentFirebaseAccount(
  request: Request,
  now = Date.now(),
): Promise<RecentFirebaseAccount> {
  const token = getBearerToken(request);
  const claims = decodeTokenClaims(token);
  const uid = await lookupFirebaseUser(token);

  let projectId: string;
  try {
    projectId = getFirebaseAdminProjectId();
  } catch {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const authTimeSeconds = validateTokenClaims(claims, uid, projectId, now);
  if (
    !hasRecentAuthentication(
      new Date(authTimeSeconds * 1_000).toISOString(),
      now,
    )
  ) {
    throw new FirebaseAccountRecentAuthError();
  }

  return { uid, token };
}

function firestoreDatabaseResourceName(): string {
  let projectId: string;
  try {
    projectId = getFirebaseAdminProjectId();
  } catch {
    throw new FirebaseAccountDeletionUnavailableError();
  }
  return `projects/${projectId}/databases/(default)`;
}

function firestoreDocumentsBaseUrl(): string {
  return `https://firestore.googleapis.com/v1/${firestoreDatabaseResourceName()}/documents`;
}

function accountDeletionMarkerUrl(uid: string): string {
  return `${firestoreDocumentsBaseUrl()}/users/${encodeURIComponent(uid)}/accountDeletion/state`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new FirebaseAccountDeletionUnavailableError();
  }
}

function requireAdminSuccess(response: Response): void {
  if (!response.ok) {
    throw new FirebaseAccountDeletionUnavailableError();
  }
}

async function adminFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await firebaseAdminFetch(url, init);
  } catch (error) {
    if (error instanceof FirebaseAdminUnavailableError) {
      throw new FirebaseAccountDeletionUnavailableError();
    }
    throw new FirebaseAccountDeletionUnavailableError();
  }
}

export async function beginFirebaseAccountDeletion(
  uid: string,
): Promise<void> {
  const response = await adminFetch(accountDeletionMarkerUrl(uid), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        state: { stringValue: 'deleting' },
        startedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  requireAdminSuccess(response);
}

function expectedDocumentPrefix(collectionId: string): string {
  return `${firestoreDatabaseResourceName()}/documents/${collectionId}/`;
}

function extractDocumentNames(
  payload: unknown,
  expectedPrefix: string,
): string[] {
  if (!Array.isArray(payload)) {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const names: string[] = [];
  for (const entry of payload as FirestoreRunQueryResult[]) {
    const name = entry.document?.name;
    if (name === undefined) continue;
    if (
      typeof name !== 'string'
      || !name.startsWith(expectedPrefix)
      || name.length > 2_000
      || name.slice(expectedPrefix.length).length < 1
      || name.slice(expectedPrefix.length).includes('/')
    ) {
      throw new FirebaseAccountDeletionUnavailableError();
    }
    names.push(name);
  }
  return [...new Set(names)];
}

async function queryOwnedDocuments(
  collectionId: string,
  uid: string,
): Promise<string[]> {
  const response = await adminFetch(
    `${firestoreDocumentsBaseUrl()}:runQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'userId' },
              op: 'EQUAL',
              value: { stringValue: uid },
            },
          },
          limit: DELETE_BATCH_SIZE,
        },
      }),
    },
  );
  requireAdminSuccess(response);
  return extractDocumentNames(
    await readJson(response),
    expectedDocumentPrefix(collectionId),
  );
}

async function commitDeletes(documentNames: string[]): Promise<void> {
  if (documentNames.length === 0) return;
  if (documentNames.length > DELETE_BATCH_SIZE) {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const response = await adminFetch(
    `${firestoreDocumentsBaseUrl()}:commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: documentNames.map((name) => ({ delete: name })),
      }),
    },
  );
  requireAdminSuccess(response);
}

async function deleteOwnedCollection(
  collectionId: string,
  uid: string,
): Promise<void> {
  for (
    let round = 0;
    round < MAX_COLLECTION_DELETE_ROUNDS;
    round += 1
  ) {
    const names = await queryOwnedDocuments(collectionId, uid);
    if (names.length === 0) return;
    await commitDeletes(names);
  }
  throw new FirebaseAccountDeletionUnavailableError();
}

function extractListedDocumentNames(
  payload: unknown,
  expectedPrefix: string,
): { names: string[]; nextPageToken?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const candidate = payload as FirestoreListResponse;
  const documents = candidate.documents ?? [];
  if (!Array.isArray(documents)) {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  const names = documents.map((document) => {
    const name = document.name;
    if (
      typeof name !== 'string'
      || !name.startsWith(expectedPrefix)
      || name.length > 2_000
      || name.slice(expectedPrefix.length).length < 1
      || name.slice(expectedPrefix.length).includes('/')
    ) {
      throw new FirebaseAccountDeletionUnavailableError();
    }
    return name;
  });
  const nextPageToken = candidate.nextPageToken;
  if (
    nextPageToken !== undefined
    && (
      typeof nextPageToken !== 'string'
      || nextPageToken.length < 1
      || nextPageToken.length > 2_000
    )
  ) {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  return {
    names: [...new Set(names)],
    nextPageToken,
  };
}

async function listUserSubcollectionDocuments(
  uid: string,
  collectionId: string,
): Promise<string[]> {
  const baseUrl =
    `${firestoreDocumentsBaseUrl()}/users/${encodeURIComponent(uid)}/${collectionId}`;
  const expectedPrefix =
    `${firestoreDatabaseResourceName()}/documents/users/${uid}/${collectionId}/`;
  const names: string[] = [];
  let pageToken: string | undefined;

  do {
    const searchParams = new URLSearchParams({
      pageSize: String(DELETE_BATCH_SIZE),
      'mask.fieldPaths': 'userId',
    });
    if (pageToken) searchParams.set('pageToken', pageToken);

    const response = await adminFetch(
      `${baseUrl}?${searchParams.toString()}`,
      { method: 'GET' },
    );
    requireAdminSuccess(response);
    const page = extractListedDocumentNames(
      await readJson(response),
      expectedPrefix,
    );
    names.push(...page.names);
    if (names.length > MAX_SUBCOLLECTION_DOCUMENTS) {
      throw new FirebaseAccountDeletionUnavailableError();
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return [...new Set(names)];
}

async function deleteDocumentByUrl(url: string): Promise<void> {
  const response = await adminFetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new FirebaseAccountDeletionUnavailableError();
  }
}

export async function deleteKnownFirebaseCloudData(
  uid: string,
): Promise<void> {
  for (const collectionId of TOP_LEVEL_USER_COLLECTIONS) {
    await deleteOwnedCollection(collectionId, uid);
  }

  await deleteDocumentByUrl(
    `${firestoreDocumentsBaseUrl()}/user_hidden_assets/${encodeURIComponent(uid)}`,
  );

  for (const collectionId of USER_SUBCOLLECTIONS) {
    const names = await listUserSubcollectionDocuments(uid, collectionId);
    for (let index = 0; index < names.length; index += DELETE_BATCH_SIZE) {
      await commitDeletes(names.slice(index, index + DELETE_BATCH_SIZE));
    }
  }
}

function readFirebaseErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return null;
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && message.length <= 200
    ? message.split(' : ', 1)[0]
    : null;
}

export async function deleteFirebaseAuthAccount(
  token: string,
): Promise<void> {
  const apiKey = requireFirebaseApiKey();
  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(FIREBASE_REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch {
    throw new FirebaseAccountDeletionUnavailableError();
  }

  if (response.ok) return;
  const code = readFirebaseErrorCode(await readJson(response));
  if (code === 'USER_NOT_FOUND') return;
  if (code === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') {
    throw new FirebaseAccountRecentAuthError();
  }
  if (response.status >= 500) {
    throw new FirebaseAccountDeletionUnavailableError();
  }
  throw new FirebaseAccountAuthError();
}
