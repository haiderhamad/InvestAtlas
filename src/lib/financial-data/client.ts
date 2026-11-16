'use client';

import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import { handleDemoFinancialRequest } from '@/lib/demo/financial-api';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';

const FINANCIAL_API_PATHS = [
  '/api/assets/',
  '/api/financial-data/',
  '/api/prices/',
] as const;

function isFinancialApiRequest(input: RequestInfo | URL): boolean {
  // Relative strings must remain local. Normalize dot segments and encoded
  // traversal before checking the route allowlist, just like URL/Request inputs.
  if (typeof input === 'string' && (!input.startsWith('/') || input.startsWith('//'))) return false;
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    return url.origin === window.location.origin
      && FINANCIAL_API_PATHS.some((path) => url.pathname.startsWith(path));
  } catch {
    return false;
  }
}

function assertWorkspaceStillActive(
  userId: string | null,
  signal?: AbortSignal | null,
  anonymousMode?: ReturnType<typeof readAnonymousWorkspaceMode> | null,
): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // An old response is invalid both after a Firebase UID switch and after an
  // anonymous Local Workspace / isolated Demo Snapshot mode transition.
  if (
    getActiveBrowserWorkspaceUserId() !== userId
    || (userId === null && anonymousMode != null && readAnonymousWorkspaceMode() !== anonymousMode)
  ) {
    throw new Error('Financial-data workspace changed during request');
  }
}

/**
 * Adds the current Firebase identity only to InvestAtlas financial API routes.
 * A personal Tiingo credential remains in tab memory; dedicated authenticated
 * same-origin BYOK POST routes process it transiently without persistence.
 */
export async function fetchFinancialData(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!isFinancialApiRequest(input)) {
    throw new Error('Untrusted financial-data request');
  }

  const requestSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const requestInit = requestSignal && init.signal === undefined
    ? { ...init, signal: requestSignal }
    : init;
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('Accept', 'application/json');
  if (requestSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const identity = await getFirebaseApiIdentity();
  const workspaceUserId = getActiveBrowserWorkspaceUserId();

  // Authentication and browser workspace must agree before a credential may
  // leave the browser. This also closes the short login/logout transition in
  // which a stale Firebase user and a different active workspace could mix.
  if (workspaceUserId === undefined) {
    throw new Error('Financial-data workspace is not ready');
  }
  if (
    (workspaceUserId === null) !== (identity === null)
    || (identity !== null && identity.userId !== workspaceUserId)
  ) {
    throw new Error('Financial-data authentication state is inconsistent');
  }
  if (identity) headers.set('Authorization', `Bearer ${identity.token}`);
  else headers.delete('Authorization');
  const anonymousMode = workspaceUserId === null ? readAnonymousWorkspaceMode() : null;
  assertWorkspaceStillActive(workspaceUserId, requestSignal, anonymousMode);

  if (
    workspaceUserId === null
    && anonymousMode === 'demo_snapshot'
  ) {
    const demoResponse = handleDemoFinancialRequest(input);
    if (demoResponse) return demoResponse;

    // The Demo Snapshot is deliberately provider-independent. Unsupported
    // financial routes must not silently fall through to live public APIs.
    return new Response(JSON.stringify({
      status: 'unavailable',
      reason: 'unsupported_demo_route',
      dataMode: 'demo_snapshot',
      synthetic: true,
      realtime: false,
    }), {
      status: 422,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'X-InvestAtlas-Data-Mode': 'demo_snapshot',
      },
    });
  }

  // Local Personal shares no Firebase identity and is deliberately isolated
  // from the anonymous Demo Snapshot. A tab-only personal key may nevertheless
  // supply supported market data through the localhost-only BYOK bridge.
  const localPersonalOwner = workspaceUserId === null
    && anonymousMode === 'local_workspace'
    && INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    ? LOCAL_PERSONAL_PROVIDER_OWNER_ID : null;
  if (workspaceUserId !== null || localPersonalOwner !== null) {
    const personalResponse = await handlePersonalBrowserMarketRequest(
      input,
      requestInit,
      workspaceUserId ?? localPersonalOwner!,
    );
    assertWorkspaceStillActive(workspaceUserId, requestSignal, anonymousMode);
    if (personalResponse) return personalResponse;
  }

  assertWorkspaceStillActive(workspaceUserId, requestSignal, anonymousMode);
  const response = await fetch(input, {
    ...requestInit,
    headers,
  });
  assertWorkspaceStillActive(workspaceUserId, requestSignal, anonymousMode);
  return response;
}
