import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';

/**
 * AI-created portfolio allocations are intentionally unavailable. The previous
 * endpoint converted untrusted provider output directly into personalized-looking
 * allocations. It stays as an authenticated, rate-limited tombstone so old clients
 * fail predictably while a preview-first, evidence-bound contract is designed.
 */
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;

    return privateJson(
      {
        error: 'AI-generated portfolio allocations are currently unavailable.',
      },
      { status: 410 },
    );
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    return privateJson(
      { error: 'AI savings-plan request failed' },
      { status: 502 },
    );
  }
}
