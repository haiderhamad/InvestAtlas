import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import {
  ApiPayloadError,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_FINANCIAL_MUTATION_RATE_LIMIT,
  AUTHENTICATED_FINANCIAL_READ_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';
import {
  FinancialCredentialStoreError,
  deleteFinancialCredential,
  listFinancialCredentials,
  upsertFinancialCredential,
} from '@/lib/financial-data/providers/credential-store';
import { testTiingoCredential } from '@/lib/financial-data/providers/tiingo';
import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const MAX_BODY_BYTES = 8 * 1024;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT = {
  bucket: 'financial-auth-verification',
  limit: 60,
  windowMs: 60_000,
} as const;

function enforceAuthVerificationRateLimit(request: Request) {
  return enforceRateLimit(request, FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT);
}

function handleError(error: unknown) {
  if (error instanceof ApiPayloadError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof ProviderStoreAuthError) {
    return privateJson({ error: 'Authentication required' }, { status: error.status });
  }
  if (error instanceof FinancialCredentialStoreError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  return privateJson({ error: 'Financial provider request failed' }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const authLimited = enforceAuthVerificationRateLimit(request);
    if (authLimited) return authLimited;
    const user = await requireFirebaseUser(request);
    const limited = enforceRateLimit(
      request,
      AUTHENTICATED_FINANCIAL_READ_RATE_LIMIT,
      user.uid,
    );
    if (limited) return limited;
    return privateJson({ providers: await listFinancialCredentials(user, request.signal) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const authLimited = enforceAuthVerificationRateLimit(request);
    if (authLimited) return authLimited;
    const user = await requireFirebaseUser(request);
    const limited = enforceRateLimit(
      request,
      AUTHENTICATED_FINANCIAL_MUTATION_RATE_LIMIT,
      user.uid,
    );
    if (limited) return limited;
    if (!isFinancialDataProviderActive('tiingo_byok')) {
      return privateJson(
        { error: 'Financial provider is disabled in this deployment' },
        { status: 403 },
      );
    }
    const body = await readBoundedJson(request, MAX_BODY_BYTES);
    if (
      !isPlainObject(body)
      || body.providerId !== 'tiingo'
      || typeof body.apiKey !== 'string'
      || !API_KEY_PATTERN.test(body.apiKey)
      || body.confirmedPersonalUse !== true
    ) {
      return privateJson({ error: 'Invalid provider configuration' }, { status: 400 });
    }

    const tested = await testTiingoCredential(
      body.apiKey,
      `${user.uid}:tiingo:pending`,
      request.signal,
    );
    if (tested.status !== 'connected') {
      return privateJson({
        status: tested.status,
        capabilities: tested.capabilities,
        checkedAt: tested.checkedAt,
      }, { status: 422 });
    }

    const provider = await upsertFinancialCredential(user, {
      id: 'tiingo',
      apiKey: body.apiKey,
      enabled: true,
      priority: 0,
      status: 'connected',
      detectedCapabilities: tested.capabilities,
      lastValidatedAt: tested.checkedAt,
    });
    return privateJson({ provider }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const authLimited = enforceAuthVerificationRateLimit(request);
    if (authLimited) return authLimited;
    const user = await requireFirebaseUser(request);
    const limited = enforceRateLimit(
      request,
      AUTHENTICATED_FINANCIAL_MUTATION_RATE_LIMIT,
      user.uid,
    );
    if (limited) return limited;
    const id = new URL(request.url).searchParams.get('id');
    if (id !== 'tiingo') {
      return privateJson({ error: 'Unsupported provider' }, { status: 400 });
    }
    const removed = await deleteFinancialCredential(user, id);
    return privateJson({ ok: true, removed });
  } catch (error) {
    return handleError(error);
  }
}
