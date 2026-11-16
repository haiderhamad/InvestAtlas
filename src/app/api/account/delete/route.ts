import { privateJson } from '@/lib/api/private-response';
import {
  enforceRateLimit,
  type RateLimitPolicy,
} from '@/lib/api/rate-limit';
import {
  FirebaseAccountAuthError,
  FirebaseAccountRecentAuthError,
  beginFirebaseAccountDeletion,
  deleteFirebaseAuthAccount,
  deleteKnownFirebaseCloudData,
  requireRecentFirebaseAccount,
} from '@/lib/firebase/account-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCOUNT_DELETE_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-account-delete',
  limit: 5,
  windowMs: 10 * 60_000,
};

function privateRateLimitResponse(response: Response) {
  return privateJson(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': response.headers.get('Retry-After') ?? '600',
        'X-RateLimit-Limit':
          response.headers.get('X-RateLimit-Limit') ?? '5',
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}

export async function DELETE(request: Request) {
  const rateLimit = enforceRateLimit(
    request,
    ACCOUNT_DELETE_RATE_LIMIT,
    'account-delete',
  );
  if (rateLimit) return privateRateLimitResponse(rateLimit);

  try {
    const account = await requireRecentFirebaseAccount(request);

    // The server-owned marker blocks new browser writes while deletion is in
    // progress. It intentionally remains when a pre-Auth step fails so a
    // reauthenticated retry can safely continue from a partially deleted state.
    await beginFirebaseAccountDeletion(account.uid);
    await deleteKnownFirebaseCloudData(account.uid);

    // Firebase Auth is always the last user-owned system removed. The
    // server-private marker remains as a technical tombstone so an already
    // issued ID token cannot recreate data before it expires.
    await deleteFirebaseAuthAccount(account.token);

    return privateJson({ ok: true });
  } catch (error) {
    if (error instanceof FirebaseAccountRecentAuthError) {
      return privateJson(
        {
          error: 'Recent authentication required',
          code: 'recent-auth-required',
        },
        { status: 401 },
      );
    }
    if (error instanceof FirebaseAccountAuthError) {
      return privateJson(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
    return privateJson(
      { error: 'Account deletion is temporarily unavailable' },
      { status: 503 },
    );
  }
}
