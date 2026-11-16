export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type FirebasePublicConfigInput = {
  [Key in keyof FirebasePublicConfig]: string | undefined;
};

export interface ResolvedFirebasePublicConfig {
  config: FirebasePublicConfig;
  isConfigured: boolean;
}

const SAFE_UNCONFIGURED_FIREBASE_CONFIG: FirebasePublicConfig = {
  apiKey: 'missing-firebase-api-key',
  authDomain: 'missing.firebaseapp.com',
  projectId: 'missing-firebase-project',
  storageBucket: 'missing-firebase-project.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:missing',
};

const PLACEHOLDER_PATTERNS = [
  /^your[-_.]/i,
  /^replace[-_.]?me/i,
  /^change[-_.]?me/i,
  /^generate[-_.]/i,
  /^missing[-_.]/i,
  /^example[-_.]/i,
  /[<>{}]/,
];

function normalize(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  return normalized;
}

function isHostname(value: string): boolean {
  if (value === 'localhost') return true;
  if (value.length > 253 || !value.includes('.')) return false;

  return value.split('.').every(
    (label) =>
      label.length > 0
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isApiKey(value: string): boolean {
  return /^AIza[A-Za-z0-9_-]{20,}$/.test(value);
}

function isProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}

function isSenderId(value: string): boolean {
  return /^\d{6,20}$/.test(value);
}

function isAppId(value: string): boolean {
  return /^1:\d{6,20}:web:[A-Za-z0-9_-]{6,}$/.test(value);
}

/**
 * Firebase's browser SDK accepts malformed-looking strings during
 * initialization and only fails once authentication performs a network call.
 * Resolve configuration up front so a copied `.env.example` behaves like an
 * intentionally unconfigured Local Workspace instead of showing API-key
 * errors. This helper never logs or returns invalid environment values.
 */
export function resolveFirebasePublicConfig(
  input: FirebasePublicConfigInput,
): ResolvedFirebasePublicConfig {
  const apiKey = normalize(input.apiKey);
  const authDomain = normalize(input.authDomain);
  const projectId = normalize(input.projectId);
  const storageBucket = normalize(input.storageBucket);
  const messagingSenderId = normalize(input.messagingSenderId);
  const appId = normalize(input.appId);

  const isConfigured = Boolean(
    apiKey
    && isApiKey(apiKey)
    && authDomain
    && isHostname(authDomain)
    && projectId
    && isProjectId(projectId)
    && storageBucket
    && isHostname(storageBucket)
    && messagingSenderId
    && isSenderId(messagingSenderId)
    && appId
    && isAppId(appId),
  );

  if (
    !isConfigured
    || !apiKey
    || !authDomain
    || !projectId
    || !storageBucket
    || !messagingSenderId
    || !appId
  ) {
    return {
      config: { ...SAFE_UNCONFIGURED_FIREBASE_CONFIG },
      isConfigured: false,
    };
  }

  return {
    config: {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
    },
    isConfigured: true,
  };
}
