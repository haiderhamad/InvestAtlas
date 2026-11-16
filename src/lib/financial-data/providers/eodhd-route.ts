import { ApiPayloadError, isPlainObject, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { isAuthorizedLocalProviderRequest } from '@/lib/runtime/local-provider-request';
import { boundEodhdRange, getEodhdTarget, normalizeEodhdInstrument, validateEodhdKey } from './eodhd-contract';
import { EodhdUpstreamError, fetchEodhdPersonalHistory, verifyEodhdPersonalKey } from './eodhd-server';

const MINUTE_LIMIT = { bucket: 'personal-eodhd-minute', limit: 20, windowMs: 60_000 } as const;

function privateSameOrigin(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const fetchSite = request.headers.get('sec-fetch-site');
    if (!origin || !host || url.host !== host || origin !== url.origin
      || (fetchSite !== null && fetchSite !== 'same-origin')) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && !process.env.VERCEL
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

/** Stateless fixed-host bridge for a user's own local/private installation. */
export async function handleEodhdPersonalRequest(request: Request, scope: 'local' | 'private'): Promise<Response> {
  if (scope === 'local' ? !isAuthorizedLocalProviderRequest(request)
    : INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud' || !privateSameOrigin(request)) {
    return privateJson({ code: 'access_denied', error: 'eodhd_personal_access_denied' }, { status: 403 });
  }
  if (request.method !== 'POST') return privateJson({ error: 'eodhd_post_required' }, { status: 405, headers: { Allow: 'POST' } });
  try {
    const owner = scope === 'local' ? 'local-personal' : (await requireFirebaseUser(request)).uid;
    if (scope === 'private' && (!process.env.INVESTATLAS_PRIVATE_OWNER_UID
      || owner !== process.env.INVESTATLAS_PRIVATE_OWNER_UID)) {
      return privateJson({ code: 'access_denied', error: 'eodhd_owner_required' }, { status: 403 });
    }
    const limited = enforceRateLimit(new Request(request.url), MINUTE_LIMIT, owner);
    if (limited) return privateJson({ code: 'rate_limited', error: 'eodhd_request_limit' }, {
      status: 429, headers: { 'Retry-After': limited.headers.get('retry-after') ?? '60' },
    });
    if (new URL(request.url).search
      || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiPayloadError('Invalid EODHD request', 400);
    }
    const body = await readBoundedJson(request, 8 * 1024);
    if (!isPlainObject(body) || (body.action !== 'connect' && body.action !== 'history')
      || (body.historyYears !== 1 && body.historyYears !== 5)) throw new ApiPayloadError('Invalid EODHD request', 400);
    const keys = body.action === 'connect' ? ['action', 'key', 'historyYears']
      : ['action', 'key', 'historyYears', 'instrument', 'range'];
    if (Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) {
      throw new ApiPayloadError('Invalid EODHD request', 400);
    }
    let key: string;
    let instrument;
    let range;
    try {
      key = validateEodhdKey(body.key);
      if (body.action === 'history') {
        instrument = normalizeEodhdInstrument(body.instrument);
        getEodhdTarget(instrument);
        range = boundEodhdRange(body.range, body.historyYears).requested;
      }
    } catch { throw new ApiPayloadError('Invalid EODHD request', 400); }
    if (body.action === 'connect') return privateJson(await verifyEodhdPersonalKey({ key, owner, historyYears: body.historyYears }, request.signal));
    if (!instrument || !range) throw new ApiPayloadError('Invalid EODHD history request', 400);
    return privateJson(await fetchEodhdPersonalHistory({ key, owner, instrument, range, historyYears: body.historyYears }, request.signal));
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) return privateJson({ error: 'eodhd_valid_owner_session_required' }, { status: error.status });
    if (error instanceof ApiPayloadError) return privateJson({ error: 'eodhd_invalid_request' }, { status: error.status });
    if (error instanceof EodhdUpstreamError) {
      const status = [401, 402, 403, 429].includes(error.status) ? error.status : 503;
      return privateJson({ code: error.status === 429 ? 'rate_limited'
        : [401, 402, 403].includes(error.status) ? 'provider_access_denied' : 'provider_unavailable',
      error: 'eodhd_personal_history_unavailable' }, { status, headers: { 'Retry-After': String(error.retryAfterSeconds) } });
    }
    // Raw provider/network exceptions can contain api_token URLs. Never return or log them.
    return privateJson({ code: 'provider_unavailable', error: 'eodhd_personal_history_unavailable' }, { status: 503 });
  }
}
