import { createSign } from 'node:crypto';

const ADMIN_TOKEN_TIMEOUT_MS = 8_000;
const ADMIN_TOKEN_SKEW_SECONDS = 60;
const ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');

interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedAdminToken {
  accessToken: string;
  expiresAtSeconds: number;
}

let cachedAdminToken: CachedAdminToken | null = null;

export class FirebaseAdminUnavailableError extends Error {
  constructor() {
    super('Server-side Firebase access is unavailable');
    this.name = 'FirebaseAdminUnavailableError';
  }
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
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

function readServiceAccount(): FirebaseServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || isPlaceholder(raw)) {
    throw new FirebaseAdminUnavailableError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FirebaseAdminUnavailableError();
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new FirebaseAdminUnavailableError();
  }

  const candidate = parsed as Record<string, unknown>;
  const projectId = candidate.project_id;
  const clientEmail = candidate.client_email;
  const privateKey = candidate.private_key;
  const configuredProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (
    typeof projectId !== 'string'
    || isPlaceholder(projectId)
    || typeof clientEmail !== 'string'
    || isPlaceholder(clientEmail)
    || !clientEmail.endsWith('.gserviceaccount.com')
    || typeof privateKey !== 'string'
    || !privateKey.includes('-----BEGIN PRIVATE KEY-----')
    || !privateKey.includes('-----END PRIVATE KEY-----')
    || (
      typeof configuredProjectId === 'string'
      && configuredProjectId.length > 0
      && configuredProjectId !== projectId
    )
  ) {
    throw new FirebaseAdminUnavailableError();
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri:
      typeof candidate.token_uri === 'string'
        ? candidate.token_uri
        : undefined,
  };
}

function buildServiceAccountAssertion(
  serviceAccount: FirebaseServiceAccount,
  nowSeconds: number,
): string {
  const tokenUri =
    serviceAccount.token_uri === 'https://oauth2.googleapis.com/token'
      ? serviceAccount.token_uri
      : 'https://oauth2.googleapis.com/token';
  const header = encodeBase64Url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  );
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: ADMIN_SCOPES,
      aud: tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3_600,
    }),
  );
  const unsignedToken = `${header}.${payload}`;

  try {
    const signer = createSign('RSA-SHA256');
    signer.update(unsignedToken);
    signer.end();
    return `${unsignedToken}.${signer.sign(
      serviceAccount.private_key,
      'base64url',
    )}`;
  } catch {
    throw new FirebaseAdminUnavailableError();
  }
}

export function getFirebaseAdminProjectId(): string {
  return readServiceAccount().project_id;
}

export async function getFirebaseAdminAccessToken(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (
    cachedAdminToken
    && cachedAdminToken.expiresAtSeconds - ADMIN_TOKEN_SKEW_SECONDS > nowSeconds
  ) {
    return cachedAdminToken.accessToken;
  }

  const serviceAccount = readServiceAccount();
  const assertion = buildServiceAccountAssertion(serviceAccount, nowSeconds);
  let response: Response;

  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(ADMIN_TOKEN_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new FirebaseAdminUnavailableError();
  }

  if (!response.ok) {
    throw new FirebaseAdminUnavailableError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FirebaseAdminUnavailableError();
  }

  if (!payload || typeof payload !== 'object') {
    throw new FirebaseAdminUnavailableError();
  }

  const accessToken = (payload as Record<string, unknown>).access_token;
  const expiresIn = (payload as Record<string, unknown>).expires_in;
  if (
    typeof accessToken !== 'string'
    || accessToken.length < 20
    || typeof expiresIn !== 'number'
    || !Number.isFinite(expiresIn)
    || expiresIn <= 0
  ) {
    throw new FirebaseAdminUnavailableError();
  }

  cachedAdminToken = {
    accessToken,
    expiresAtSeconds: nowSeconds + Math.min(expiresIn, 3_600),
  };
  return accessToken;
}

export async function firebaseAdminFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await getFirebaseAdminAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Cache-Control', 'no-store');

  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(ADMIN_TOKEN_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new FirebaseAdminUnavailableError();
  }
}

export function resetFirebaseAdminTokenCacheForTests(): void {
  if (process.env.NODE_ENV === 'test') {
    cachedAdminToken = null;
  }
}
