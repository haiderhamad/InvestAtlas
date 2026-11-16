import { NextRequest, NextResponse } from 'next/server';
import {
  INVESTATLAS_DEPLOYMENT_MODE,
  isValidPrivateOwnerUid,
} from '@/lib/runtime/deployment-mode';

/**
 * Private Cloud API perimeter (not a replacement for Firebase Security Rules).
 * The owner can use their own Google/Firebase account, but arbitrary signed-in
 * users must not invoke ANY privileged server route on the private instance.
 */
export async function proxy(request: NextRequest) {
  if (INVESTATLAS_DEPLOYMENT_MODE === 'legacy') return NextResponse.next();

  // Operator-hosted public demo must not expose live provider, authentication,
  // BYOK or personal-data endpoints. Its financial sample data is client-side.
  if (INVESTATLAS_DEPLOYMENT_MODE === 'public_demo') return failure(403);

  // Local Personal has no Firebase Auth. It must not silently expose
  // Firebase-owned BYOK vault, import or account-deletion routes.
  if (INVESTATLAS_DEPLOYMENT_MODE === 'local_personal') {
    if (isLocalFirebaseApiPath(request.nextUrl.pathname)
      || (request.nextUrl.pathname.startsWith('/api/prices/')
        && request.headers.has('authorization'))) {
      return failure(403);
    }
    // Keyless public quote/history and ECB FX routes remain usable locally.
    return NextResponse.next();
  }

  // Only /api is intercepted; fail closed if the Private Cloud owner was not
  // specified with the same UID as the deployed restricted Firestore Rules.
  const ownerUid = process.env.INVESTATLAS_PRIVATE_OWNER_UID;
  const projectApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!isValidPrivateOwnerUid(ownerUid) || !projectApiKey
    || !/^AIza[A-Za-z0-9_-]{20,}$/.test(projectApiKey)) {
    return failure(503);
  }

  // Public keyless prices and the official ECB FX reference feed do not use
  // a Firebase identity. Allow only those read-only paths without Bearer;
  // any personal price request still passes the owner verification below.
  if (!isPrivateApiPath(
    request.nextUrl.pathname,
    request.headers.has('authorization'),
  )) {
    return NextResponse.next();
  }

  const rawHeader = request.headers.get('authorization');
  if (!rawHeader || !rawHeader.startsWith('Bearer ')) return failure(401);
  const token = rawHeader.slice(7);
  if (token.length < 20 || token.length > 16 * 1024 || /[\s]/.test(token)) {
    return failure(401);
  }

  try {
    const upstream = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(projectApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      },
    );
    if (!upstream.ok) return failure(upstream.status >= 500 ? 503 : 401);
    const identity: unknown = await upstream.json();
    const uid = (identity as { users?: Array<{ localId?: unknown }> } | null)?.users?.[0]?.localId;
    if (typeof uid !== 'string') return failure(401);
    if (uid !== ownerUid) return failure(403);
    return NextResponse.next();
  } catch {
    return failure(503);
  }
}

function isLocalFirebaseApiPath(pathname: string): boolean {
  return pathname === '/api/ai'
    || ['/api/ai/', '/api/account/', '/api/transactions/',
      '/api/financial-data/providers', '/api/financial-data/tiingo/']
      .some((prefix) => pathname.startsWith(prefix));
}

function isPrivateApiPath(pathname: string, hasAuthorization: boolean): boolean {
  // Official ECB reference endpoints contain no personal data and are
  // expressly called without an auth token even by Cloud workspaces.
  if (pathname === '/api/financial-data/fx'
    || pathname === '/api/financial-data/fx/history') return false;

  // Anonymous pricing is public by contract; personal Bearer pricing must be
  // restricted to the exact configured owner before the route handles it.
  if (pathname.startsWith('/api/prices/')) return hasAuthorization;

  return [
    '/api/account/',
    '/api/ai/',
    '/api/financial-data/',
    '/api/transactions/',
  ].some((prefix) => pathname.startsWith(prefix))
    || pathname === '/api/ai';
}

function failure(status: 401 | 403 | 503) {
  return NextResponse.json({ error: 'Unavailable for this installation' }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const config = {
  matcher: '/api/:path*',
};
