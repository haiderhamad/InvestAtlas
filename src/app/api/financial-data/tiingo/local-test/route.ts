import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { ApiPayloadError, isPlainObject, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { fetchTiingoDailyPrices, TiingoProviderError } from '@/lib/financial-data/providers/tiingo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_BODY_BYTES = 2 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const LOCAL_TEST_RATE_LIMIT = { bucket: 'tiingo-local-test', limit: 5, windowMs: 60_000 } as const;
const LOCAL_TEST_IP_RATE_LIMIT = { bucket: 'tiingo-local-test-ip', limit: 10, windowMs: 60_000 } as const;
const ERROR_MESSAGES = {
  invalid_key: 'Tiingo rejected this token. Check the token and try again.',
  quota_exhausted: 'The Tiingo account quota is exhausted.',
  rate_limited: 'Tiingo request limit reached. Try again later.',
  provider_unavailable: 'Tiingo is temporarily unavailable. Try again later.',
  unexpected_response: 'Tiingo returned data that could not be safely validated.',
  capability_unavailable: 'Tiingo does not support the requested test data.',
  misconfigured: 'The local Tiingo test request is invalid.',
} as const;

function isLocalRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL) return false;
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    const hostname = requestUrl.hostname.toLowerCase();
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    return isLoopback && Boolean(origin) && new URL(origin!).origin === origin && origin === requestUrl.origin;
  } catch {
    return false;
  }
}

function statusForProviderError(status: TiingoProviderError['status']): number {
  if (status === 'invalid_key' || status === 'capability_unavailable' || status === 'misconfigured') return 422;
  if (status === 'rate_limited' || status === 'quota_exhausted') return 429;
  if (status === 'unexpected_response') return 502;
  return 503;
}

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    if (!isLocalRequest(request)) {
      return privateJson({ error: 'This endpoint is available only in the local development server.' }, { status: 404 });
    }

    // Enforce a UID budget with a synthetic request so callers cannot evade it
    // by changing forwarded-IP headers, then apply a separate source-IP cap.
    const userLimited = enforceRateLimit(new Request(request.url), LOCAL_TEST_RATE_LIMIT, user.uid);
    const ipLimited = userLimited ? null : enforceRateLimit(request, LOCAL_TEST_IP_RATE_LIMIT, 'local');
    const limited = userLimited ?? ipLimited;
    if (limited) {
      return privateJson(await limited.json(), { status: limited.status, headers: limited.headers });
    }

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: 'Send the Tiingo token as a JSON request body.' }, { status: 400 });
    }

    const body = await readBoundedJson(request, MAX_BODY_BYTES);
    if (!isPlainObject(body) || Object.keys(body).length !== 1 || typeof body.apiKey !== 'string' || !TOKEN_PATTERN.test(body.apiKey)) {
      return privateJson({ error: 'Enter a valid Tiingo token to test the local connection.' }, { status: 400 });
    }

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 10);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const data = await fetchTiingoDailyPrices({
      apiKey: body.apiKey,
      healthKey: `local-test:${user.uid}`,
      symbol: 'AAPL',
      startDate,
      endDate,
      signal: request.signal,
    });

    return privateJson({ status: 'connected', symbol: 'AAPL', startDate, endDate, data });
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: 'Authentication required.' }, { status: error.status });
    }
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    if (error instanceof TiingoProviderError) {
      const message = ERROR_MESSAGES[error.status as keyof typeof ERROR_MESSAGES]
        ?? ERROR_MESSAGES.unexpected_response;
      return privateJson({ error: message, code: error.status }, { status: statusForProviderError(error.status) });
    }
    return privateJson({ error: 'The local Tiingo connection test failed safely.' }, { status: 502 });
  }
}
