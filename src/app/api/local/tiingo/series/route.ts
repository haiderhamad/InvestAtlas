import { isPlainObject, readBoundedJson, ApiPayloadError } from '@/lib/api/json-body';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { privateJson } from '@/lib/api/private-response';
import { isAuthorizedLocalProviderRequest } from '@/lib/runtime/local-provider-request';
import { supportsPersonalTiingoAsset } from '@/lib/financial-data/providers/tiingo-asset-scope';
import {
  fetchTiingoDailyPrices, fetchTiingoCryptoDailyPrices, TiingoProviderError,
} from '@/lib/financial-data/providers/tiingo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;
const LOCAL_LIMIT = { bucket: 'self-hosted-local-tiingo', limit: 25, windowMs: 60 * 60_000 } as const;

function providerHttpStatus(status: TiingoProviderError['status']): number {
  if (status === 'invalid_key' || status === 'capability_unavailable' || status === 'misconfigured') return 422;
  if (status === 'rate_limited' || status === 'quota_exhausted') return 429;
  return status === 'unexpected_response' ? 502 : 503;
}

/** Dedicated localhost-only, stateless BYOK bridge. Never stores keys or URLs. */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedLocalProviderRequest(request)) {
    return privateJson({ error: 'Local provider access denied.' }, { status: 403 });
  }
  const limited = enforceRateLimit(new Request(request.url), LOCAL_LIMIT, 'local-personal');
  if (limited) return privateJson({ error: 'Local provider request limit reached.' }, { status: limited.status });

  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: 'JSON body required.' }, { status: 400 });
    }
    const body = await readBoundedJson(request, 2 * 1024);
    if (!isPlainObject(body) || Object.keys(body).length !== 2
      || typeof body.apiKey !== 'string' || !TOKEN_PATTERN.test(body.apiKey)
      || typeof body.symbol !== 'string' || !SYMBOL_PATTERN.test(body.symbol)
      || !supportsPersonalTiingoAsset(body.symbol)) {
      return privateJson({ error: 'Unsupported symbol or personal token.' }, { status: 400 });
    }
    const isCrypto = body.symbol === 'BTC' || body.symbol === 'ETH';
    const end = new Date();
    if (isCrypto) end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 155);
    const parameters = {
      apiKey: body.apiKey,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      healthKey: 'self-hosted-local-tiingo',
      signal: request.signal,
    };
    const data = isCrypto
      ? await fetchTiingoCryptoDailyPrices({ ...parameters, symbol: body.symbol as 'BTC' | 'ETH' })
      : await fetchTiingoDailyPrices({ ...parameters, symbol: body.symbol });
    return privateJson({ symbol: body.symbol, data: data.slice(-100) });
  } catch (error) {
    if (error instanceof ApiPayloadError) return privateJson({ error: 'Invalid request.' }, { status: error.status });
    if (error instanceof TiingoProviderError) {
      return privateJson({ code: error.status, error: 'Personal market data unavailable.' }, {
        status: providerHttpStatus(error.status),
      });
    }
    return privateJson({ error: 'Personal market data unavailable.' }, { status: 503 });
  }
}
