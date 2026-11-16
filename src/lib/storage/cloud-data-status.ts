'use client';

export const CLOUD_DATA_SCOPES = [
  'transactions',
  'accounts',
  'asset_risks',
] as const;

export type CloudDataScope = (typeof CLOUD_DATA_SCOPES)[number];
export type CloudDataState = 'local' | 'pending' | 'ready' | 'unavailable';

export interface CloudScopeStatus {
  state: CloudDataState;
  errorCode?: string;
}

export interface CloudDataStatus {
  authenticated: boolean;
  scopes: Record<CloudDataScope, CloudScopeStatus>;
  pendingScopes: CloudDataScope[];
  unavailableScopes: CloudDataScope[];
  blockedScopes: CloudDataScope[];
}

export class CloudDataNotReadyError extends Error {
  code = 'cloud/data-not-ready';

  constructor(public readonly scope: CloudDataScope) {
    super(`Cloud ${scope} is not ready.`);
    this.name = 'CloudDataNotReadyError';
  }
}

export const CLOUD_DATA_STATUS_EVENT = 'investatlas:cloud-data-status';

let activeUserId: string | null = null;
let authenticated = false;
let scopeStatuses = createStatuses('local');

function createStatuses(state: CloudDataState): Record<CloudDataScope, CloudScopeStatus> {
  return Object.fromEntries(
    CLOUD_DATA_SCOPES.map((scope) => [scope, { state }]),
  ) as Record<CloudDataScope, CloudScopeStatus>;
}

function emitStatus(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<CloudDataStatus>(CLOUD_DATA_STATUS_EVENT, {
      detail: getCloudDataStatus(),
    }),
  );
}

function isActiveCloudUser(userId: string): boolean {
  return authenticated && activeUserId === userId;
}

/**
 * Starts a fresh cloud-read boundary whenever Firebase changes identity.
 * Previous-user caches must be discarded before any listener for the next UID
 * can publish data.
 */
export function setCloudDataWorkspace(userId: string | null): void {
  if (authenticated === Boolean(userId) && activeUserId === userId) {
    return;
  }

  activeUserId = userId;
  authenticated = Boolean(userId);
  scopeStatuses = createStatuses(userId ? 'pending' : 'local');
  emitStatus();
}

export function markCloudDataPending(scope: CloudDataScope, userId: string): void {
  if (!isActiveCloudUser(userId)) return;
  scopeStatuses = {
    ...scopeStatuses,
    [scope]: { state: 'pending' },
  };
  emitStatus();
}

export function markCloudDataReady(scope: CloudDataScope, userId: string): void {
  if (!isActiveCloudUser(userId)) return;
  scopeStatuses = {
    ...scopeStatuses,
    [scope]: { state: 'ready' },
  };
  emitStatus();
}

export function reportCloudDataUnavailable(
  scope: CloudDataScope,
  userId: string,
  error: unknown,
): void {
  if (!isActiveCloudUser(userId)) return;

  const errorCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'unknown';

  scopeStatuses = {
    ...scopeStatuses,
    [scope]: { state: 'unavailable', errorCode },
  };

  // Keep the diagnostic useful without forwarding document contents or
  // turning an expected permission failure into a Next.js error overlay.
  console.warn(`[InvestAtlas] Cloud ${scope} unavailable (${errorCode}).`);
  emitStatus();
}

export function getCloudDataStatus(): CloudDataStatus {
  const pendingScopes = CLOUD_DATA_SCOPES.filter(
    (scope) => scopeStatuses[scope].state === 'pending',
  );
  const unavailableScopes = CLOUD_DATA_SCOPES.filter(
    (scope) => scopeStatuses[scope].state === 'unavailable',
  );

  return {
    authenticated,
    scopes: structuredClone(scopeStatuses),
    pendingScopes,
    unavailableScopes,
    blockedScopes: [...pendingScopes, ...unavailableScopes],
  };
}

export function assertCloudDataReady(scope: CloudDataScope): void {
  if (!authenticated) return;
  if (scopeStatuses[scope].state !== 'ready') {
    throw new CloudDataNotReadyError(scope);
  }
}
