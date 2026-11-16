import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { ApiPayloadError, isPlainObject, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { supportsPersonalTiingoAsset } from '@/lib/financial-data/providers/tiingo-asset-scope';
import { fetchTiingoDailyPrices, fetchTiingoCryptoDailyPrices, TiingoProviderError } from '@/lib/financial-data/providers/tiingo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Per-user BYOK ingress, never a shared market-data feed. Only Firebase-
// authenticated same-origin requests with a personal token can reach Tiingo.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;
const UID_LIMIT = { bucket: 'tiingo-personal-series-user', limit: 25, windowMs: 60 * 60_000 } as const;
const IP_LIMIT = { bucket: 'tiingo-personal-series-ip', limit: 40, windowMs: 60 * 60_000 } as const;
const PUBLIC_APP_ORIGIN = 'https://invest-atlas-tan.vercel.app';

function verifiedProductionOrigins(): Set<string> {
  const origins = new Set([PUBLIC_APP_ORIGIN]);
  // Vercel-provided hostnames are trusted deployment configuration, never
  // arbitrary x-forwarded-host or an attacker-provided Origin.
  for (const hostname of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!hostname) continue;
    try {
      const url = new URL('https://' + hostname);
      if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash) origins.add(url.origin);
    } catch {
      // Ignore malformed deployment metadata; do not broaden trust.
    }
  }
  const custom = process.env.INVESTATLAS_PUBLIC_APP_ORIGIN;
  if (custom) {
    try {
      const url = new URL(custom);
      if (url.protocol === 'https:' && url.origin === custom) origins.add(custom);
    } catch {
      // Fail closed on misconfiguration.
    }
  }
  return origins;
}

function isTrustedSameOriginRequest(request: Request): boolean {
  try {
    const requestUrl = new URL(request.url);
    const headerOrigin = request.headers.get('origin');
    if (!headerOrigin) return false;
    const origin = new URL(headerOrigin);
    if (origin.origin !== headerOrigin) return false;
    const browserHost = request.headers.get('host') ?? requestUrl.host;
    if (origin.host !== browserHost) return false;

    if (process.env.NODE_ENV === 'development' && !process.env.VERCEL) {
      // Next dev may normalize Request.url from 127.0.0.1 to localhost.
      return requestUrl.protocol === 'http:'
        && origin.protocol === 'http:'
        && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
        && origin.port === requestUrl.port;
    }
    if (process.env.NODE_ENV !== 'production') return false;
    // Hosted BYOK must be explicitly enabled only after configuring the
    // platform-level WAF/abuse controls: this process-local limiter cannot
    // enforce a global Tiingo quota across Vercel function instances.
    if (process.env.INVESTATLAS_TIINGO_HOSTED_ENABLED !== 'true') return false;
    return origin.protocol === 'https:'
      && requestUrl.protocol === 'https:'
      && requestUrl.host === browserHost
      && verifiedProductionOrigins().has(origin.origin);
  } catch {
    return false;
  }
}

function errorStatus(status: TiingoProviderError['status']): number {
  if (status === 'invalid_key' || status === 'capability_unavailable' || status === 'misconfigured') return 422;
  if (status === 'rate_limited' || status === 'quota_exhausted') return 429;
  if (status === 'unexpected_response') return 502;
  return 503;
}

export async function POST(request: Request): Promise<Response> {
  // Fail closed before inspecting personal credentials or contacting the provider.
  if (!isTrustedSameOriginRequest(request)) {
    return privateJson({ error: 'Untrusted request origin.' }, { status: 403 });
  }
  try {
    const user = await requireFirebaseUser(request);
    // Deliberately strip IP here so one Firebase UID cannot evade the local
    // budget by rotating addresses. IP has a separate secondary throttle.
    const limitedUser = enforceRateLimit(new Request(request.url), UID_LIMIT, user.uid);
    const limitedIp = limitedUser ? null : enforceRateLimit(request, IP_LIMIT, 'personal');
    const limited = limitedUser ?? limitedIp;
    if (limited) return privateJson(await limited.json(), { status: limited.status, headers: limited.headers });

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: 'JSON body required.' }, { status: 400 });
    }
    const body = await readBoundedJson(request, 2 * 1024);
    if (!isPlainObject(body)
      || Object.keys(body).length !== 2
      || typeof body.apiKey !== 'string'
      || !TOKEN_PATTERN.test(body.apiKey)
      || typeof body.symbol !== 'string'
      || !SYMBOL_PATTERN.test(body.symbol)
      || !supportsPersonalTiingoAsset(body.symbol)) {
      return privateJson({ error: 'Unsupported symbol or invalid personal token.' }, { status: 400 });
    }

    const isCrypto = body.symbol === 'BTC' || body.symbol === 'ETH';
    const end = new Date();
    // A crypto daily bar for the current UTC day is not yet complete.
    if (isCrypto) end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 155);
    const parameters = {
      apiKey: body.apiKey,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      healthKey: 'personal-series:' + user.uid,
      signal: request.signal,
    };
    const data = isCrypto
      ? await fetchTiingoCryptoDailyPrices({ ...parameters, symbol: body.symbol as 'BTC' | 'ETH' })
      : await fetchTiingoDailyPrices({ ...parameters, symbol: body.symbol });
    return privateJson({ symbol: body.symbol, data: data.slice(-100) });
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: 'Authentication required.' }, { status: error.status });
    }
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: 'Invalid request body.' }, { status: error.status });
    }
    if (error instanceof TiingoProviderError) {
      const code = error.status;
      return privateJson({ code, error: 'Personal market data is unavailable.' }, { status: errorStatus(code) });
    }
    return privateJson({ error: 'Personal market data is unavailable.' }, { status: 503 });
  }
}
