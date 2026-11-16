import { ApiPayloadError, isPlainObject, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { isAuthorizedLocalYahooRequest } from '@/lib/runtime/local-yahoo-request';
import { fetchYahooPersonalDaily, supportsYahooPersonalAsset, YahooPersonalUpstreamError } from './yahoo-personal-server';
import { normalizePersonalListingIdentity } from '@/lib/config/personal-instrument';
import { normalizePersonalHistoryRange } from '@/lib/financial-data/history/request';

// Fixed-origin manual personal research only. No user-controlled URL or
// credentials are forwarded to Yahoo; server refuses public_demo entirely.
// One deliberate 20-instrument catalog refresh fits, with bounded headroom.
const RATE_PER_MINUTE = { bucket: 'personal-yahoo-chart-minute', limit: 24, windowMs: 60_000 } as const;
const RATE_PER_HOUR = { bucket: 'personal-yahoo-chart-hour', limit: 80, windowMs: 60 * 60_000 } as const;
const YAHOO_API_ERRORS = {
  localDenied: 'local_yahoo_access_denied',
  privateDenied: 'private_yahoo_access_denied',
  ownerRequired: 'yahoo_owner_required',
  rateLimited: 'yahoo_rate_limited',
  invalidJson: 'yahoo_json_required',
  unsupported: 'yahoo_unsupported_instrument',
  authRequired: 'yahoo_valid_owner_session_required',
  invalid: 'yahoo_invalid_request',
  unavailable: 'yahoo_series_unavailable',
} as const;

function privateSameOrigin(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const fetchSite = request.headers.get('sec-fetch-site');
    if (!origin || !host || !['https:', 'http:'].includes(url.protocol)
      || url.host !== host || origin !== url.origin
      || (fetchSite !== null && fetchSite !== 'same-origin')) return false;
    if (url.protocol === 'https:') return true;
    return !process.env.VERCEL
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function handleYahooPersonalRequest(
  request: Request,
  scope: 'local' | 'private',
): Promise<Response> {
  if (scope === 'local') {
    if (!isAuthorizedLocalYahooRequest(request)) {
      return privateJson({ error: YAHOO_API_ERRORS.localDenied }, { status: 403 });
    }
  } else {
    if (INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud'
      || !privateSameOrigin(request)) {
      return privateJson({ error: YAHOO_API_ERRORS.privateDenied }, { status: 403 });
    }
  }

  try {
    const owner = scope === 'local'
      ? 'local-personal'
      : (await requireFirebaseUser(request)).uid;
    if (scope === 'private' && (!process.env.INVESTATLAS_PRIVATE_OWNER_UID
      || owner !== process.env.INVESTATLAS_PRIVATE_OWNER_UID)) {
      return privateJson({ error: YAHOO_API_ERRORS.ownerRequired }, { status: 403 });
    }

    const limited = enforceRateLimit(new Request(request.url), RATE_PER_MINUTE, owner)
      ?? enforceRateLimit(new Request(request.url), RATE_PER_HOUR, owner);
    if (limited) {
      return privateJson({ code: 'rate_limited', error: YAHOO_API_ERRORS.rateLimited }, {
        status: 429, headers: { 'Retry-After': limited.headers.get('retry-after') ?? '90' },
      });
    }

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: YAHOO_API_ERRORS.invalidJson }, { status: 400 });
    }
    const body = await readBoundedJson(request, 2048);
    if (!isPlainObject(body) || Object.keys(body).some(key=>!['symbol','listing','range'].includes(key))
      || typeof body.symbol !== 'string'
      || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(body.symbol)) {
      return privateJson({ error: YAHOO_API_ERRORS.unsupported }, { status: 400 });
    }
    const listing = body.listing === undefined ? undefined : normalizePersonalListingIdentity(body.listing);
    const range = body.range === undefined ? undefined
      : isPlainObject(body.range) && Object.keys(body.range).length===2 && Object.keys(body.range).every(k=>['from','to'].includes(k))
        ? normalizePersonalHistoryRange(body.range) : null;
    if (listing===null || range===null || !supportsYahooPersonalAsset(body.symbol, listing)) {
      return privateJson({error:YAHOO_API_ERRORS.unsupported},{status:400});
    }
    const series = listing || range
      ? await fetchYahooPersonalDaily(body.symbol, request.signal, {listing,range,allowHistoricalTail:!!range})
      : await fetchYahooPersonalDaily(body.symbol, request.signal);
    return privateJson(series);
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: YAHOO_API_ERRORS.authRequired }, { status: error.status });
    }
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: YAHOO_API_ERRORS.invalid }, { status: error.status });
    }
    if (error instanceof YahooPersonalUpstreamError) {
      const blocked = error.status === 401 || error.status === 403;
      const rateLimited = error.status === 429;
      return privateJson({
        code: blocked ? 'provider_access_denied' : rateLimited ? 'rate_limited' : 'provider_unavailable',
        error: rateLimited ? YAHOO_API_ERRORS.rateLimited : YAHOO_API_ERRORS.unavailable,
      }, { status: rateLimited ? 429 : 503, headers: { 'Retry-After': String(error.retryAfterSeconds) } });
    }
    // No automatic retries, cookies, captcha bypasses, or proxy rotation.
    return privateJson({ code: 'provider_unavailable', error: YAHOO_API_ERRORS.unavailable }, { status: 503 });
  }
}
