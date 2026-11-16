'use client';

import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

export interface BrowserWorkspaceScope {
  userId: string | null;
}

export interface BrowserWorkspaceStorageOptions {
  /** Presentation-only state such as language/theme may be shared with Demo. */
  allowDemo?: boolean;
}

type BrowserWorkspaceIdentity =
  | { resolved: false; userId: null }
  | { resolved: true; userId: string | null };

let activeWorkspace: BrowserWorkspaceIdentity = {
  resolved: false,
  userId: null,
};

export const BROWSER_WORKSPACE_CHANGE_EVENT = 'investatlas:browser-workspace-change';

export function getActiveBrowserWorkspaceUserId(): string | null | undefined {
  return activeWorkspace.resolved ? activeWorkspace.userId : undefined;
}

function normalizeUserId(userId: string | null): string | null {
  if (userId === null) return null;
  const normalized = userId.trim();
  return normalized || null;
}

/**
 * Resolves the browser workspace only after the authentication provider has
 * completed its initial session check. Until then storage access fails closed.
 */
export function resolveBrowserWorkspace(userId: string | null): void {
  activeWorkspace = {
    resolved: true,
    userId: normalizeUserId(userId),
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BROWSER_WORKSPACE_CHANGE_EVENT, {
        detail: { userId: activeWorkspace.userId },
      }),
    );
    // Existing stores already subscribe to the browser storage event. Emit a
    // synthetic notification so observers immediately re-read the newly
    // active namespace on login, logout, or direct account switches.
    window.dispatchEvent(new Event('storage'));
  }
}

export function markBrowserWorkspacePending(): void {
  activeWorkspace = {
    resolved: false,
    userId: null,
  };
}

/**
 * Anonymous Local Workspace data keeps its existing key for compatibility.
 * Authenticated browser-only state is isolated per Firebase UID.
 */
export function getWorkspaceStorageKey(
  baseKey: string,
  scope?: BrowserWorkspaceScope,
): string | null {
  const userId = scope
    ? normalizeUserId(scope.userId)
    : activeWorkspace.resolved
      ? activeWorkspace.userId
      : undefined;

  if (userId === undefined) {
    return null;
  }

  return userId === null
    ? baseKey
    : `${baseKey}::user::${encodeURIComponent(userId)}`;
}

export function readWorkspaceStorageItem(
  baseKey: string,
  scope?: BrowserWorkspaceScope,
  options: BrowserWorkspaceStorageOptions = {},
): string | null {
  if (typeof window === 'undefined') return null;
  if (
    scope === undefined
    && activeWorkspace.resolved
    && activeWorkspace.userId === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot'
    && options.allowDemo !== true
  ) {
    return null;
  }
  const key = getWorkspaceStorageKey(baseKey, scope);
  return key ? window.localStorage.getItem(key) : null;
}

export function writeWorkspaceStorageItem(
  baseKey: string,
  value: string,
  scope?: BrowserWorkspaceScope,
  options: BrowserWorkspaceStorageOptions = {},
): boolean {
  if (typeof window === 'undefined') return false;
  if (
    scope === undefined
    && activeWorkspace.resolved
    && activeWorkspace.userId === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot'
    && options.allowDemo !== true
  ) {
    return false;
  }
  const key = getWorkspaceStorageKey(baseKey, scope);
  if (!key) return false;
  window.localStorage.setItem(key, value);
  return true;
}

export function removeWorkspaceStorageItem(
  baseKey: string,
  scope?: BrowserWorkspaceScope,
  options: BrowserWorkspaceStorageOptions = {},
): boolean {
  if (typeof window === 'undefined') return false;
  if (
    scope === undefined
    && activeWorkspace.resolved
    && activeWorkspace.userId === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot'
    && options.allowDemo !== true
  ) {
    return false;
  }
  const key = getWorkspaceStorageKey(baseKey, scope);
  if (!key) return false;
  window.localStorage.removeItem(key);
  return true;
}

export function removeWorkspaceStorageItems(
  baseKeys: readonly string[],
  scope?: BrowserWorkspaceScope,
): void {
  baseKeys.forEach((baseKey) => {
    removeWorkspaceStorageItem(baseKey, scope);
  });
}
