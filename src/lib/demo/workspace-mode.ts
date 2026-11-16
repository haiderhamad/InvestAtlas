'use client';

import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';

export type AnonymousWorkspaceMode = 'demo_snapshot' | 'local_workspace';

export const ANONYMOUS_WORKSPACE_MODE_KEY = 'investatlas.anonymous-workspace-mode';
export const ANONYMOUS_WORKSPACE_MODE_EVENT = 'investatlas:anonymous-workspace-mode-change';

const LEGACY_LOCAL_DATA_KEYS = [
  'investatlas.manual-transactions',
  'investatlas.manual-accounts',
  'investatlas.watchlists',
] as const;

function hasExistingLocalWorkspace(): boolean {
  return LEGACY_LOCAL_DATA_KEYS.some((key) => {
    const value = window.localStorage.getItem(key);
    return value !== null && value !== '' && value !== '[]';
  });
}

/**
 * Existing anonymous workspaces retain their editable local-data behavior.
 * New visitors start in the isolated read-only Demo Snapshot.
 */
export function readAnonymousWorkspaceMode(): AnonymousWorkspaceMode {
  // Public operator demo may never unlock personal browser data, including old local workspaces.
  if (INVESTATLAS_DEPLOYMENT_MODE === 'public_demo') return 'demo_snapshot';
  if (typeof window === 'undefined') return 'demo_snapshot';
  const stored = window.localStorage.getItem(ANONYMOUS_WORKSPACE_MODE_KEY);
  if (stored === 'demo_snapshot' || stored === 'local_workspace') return stored;
  return INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    || hasExistingLocalWorkspace() ? 'local_workspace' : 'demo_snapshot';
}

export function writeAnonymousWorkspaceMode(mode: AnonymousWorkspaceMode): void {
  // Never mutate an existing visitor profile when a public demo requests a personal mode.
  if (INVESTATLAS_DEPLOYMENT_MODE === 'public_demo') return;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, mode);
  window.dispatchEvent(
    new CustomEvent(ANONYMOUS_WORKSPACE_MODE_EVENT, { detail: { mode } }),
  );
  window.dispatchEvent(new Event('storage'));
}
