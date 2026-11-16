import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';
import {
  FinancialCredentialStoreError,
  listFinancialCredentialsRaw,
} from '@/lib/financial-data/providers/credential-store';
import { testTiingoCredential } from '@/lib/financial-data/providers/tiingo';
import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT = {
  bucket: 'financial-auth-verification',
  limit: 60,
  windowMs: 60_000,
} as const;

export async function POST(request: Request) {
  try {
    const authLimited = enforceRateLimit(
      request,
      FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT,
    );
    if (authLimited) return authLimited;
    const user = await requireFirebaseUser(request);
    const limited = enforceRateLimit(
      request,
      AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT,
      user.uid,
    );
    if (limited) return limited;
    if (!isFinancialDataProviderActive('tiingo_byok')) {
      return privateJson(
        { error: 'Financial provider is disabled in this deployment' },
        { status: 403 },
      );
    }
    const provider = (await listFinancialCredentialsRaw(user, request.signal))
      .find((credential) => credential.id === 'tiingo');
    if (!provider) {
      return privateJson({ status: 'misconfigured', capabilities: [] }, { status: 404 });
    }
    const result = await testTiingoCredential(
      provider.apiKey,
      `${user.uid}:tiingo:${provider.credentialRevision}`,
      request.signal,
    );
    return privateJson(result, {
      status: result.status === 'connected' ? 200 : 422,
    });
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: 'Authentication required' }, { status: error.status });
    }
    if (error instanceof FinancialCredentialStoreError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    return privateJson({ error: 'Financial provider test failed' }, { status: 500 });
  }
}
