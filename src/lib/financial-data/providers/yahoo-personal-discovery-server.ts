import { ApiPayloadError, isPlainObject, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import { normalizePersonalListingIdentity, type PersonalListingIdentity } from '@/lib/config/personal-instrument';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { isAuthorizedLocalYahooRequest } from '@/lib/runtime/local-yahoo-request';
import { parseYahooPersonalChart, YahooPersonalUpstreamError, type YahooPersonalDailySeries } from './yahoo-personal-server';

export interface YahooPersonalListingCandidate {
  symbol: string;
  name: string;
  assetClass: 'stock' | 'etf';
  exchange: string;
}

export interface YahooPersonalListingResolution {
  instrument: PersonalListingIdentity;
  series?: YahooPersonalDailySeries;
}

const ORIGIN = 'https://query1.finance.yahoo.com';
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const US_EXCHANGES = ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'PNK'];
const SUFFIX_EXCHANGES: Readonly<Record<string, string>> = {
  DE: 'GER', AS: 'AMS', L: 'LSE', PA: 'PAR', MI: 'MIL', BR: 'BRU', LS: 'LIS', IR: 'ISE',
};
const MINUTE = { bucket: 'personal-yahoo-discovery-minute', limit: 6, windowMs: 60_000 } as const;
const HOUR = { bucket: 'personal-yahoo-discovery-hour', limit: 30, windowMs: 60 * 60_000 } as const;

function searchQuery(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 80 && !CONTROL.test(value)
    && value.trim().length >= 2 ? value.trim() : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 && !CONTROL.test(value) && value.trim()
    ? value.trim() : null;
}

function retryAfterSeconds(response: Response): number {
  const value = response.headers.get('retry-after');
  const seconds = value && /^\d+$/.test(value)
    ? Number(value) : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : 0;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 90;
}

async function readYahooJson(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new YahooPersonalUpstreamError(response.status, retryAfterSeconds(response));
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) {
    await response.body?.cancel();
    throw new Error('Yahoo discovery unavailable');
  }
  if (Number(response.headers.get('content-length') ?? 0) > maximum) {
    await response.body.cancel();
    throw new Error('Yahoo discovery response too large');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new Error('Yahoo discovery response too large');
      body += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function fetchYahooJson(path: string, parameters: Record<string, string>, maximum: number, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = new URL(path, ORIGIN);
  url.search = new URLSearchParams(parameters).toString();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    return await readYahooJson(response, maximum, controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** Search is deliberately not a verified listing or currency decision. */
export async function fetchYahooPersonalListingCandidates(query: string, signal?: AbortSignal): Promise<YahooPersonalListingCandidate[]> {
  const normalized = searchQuery(query);
  if (!normalized) throw new Error('Invalid Yahoo search query');
  const payload = await fetchYahooJson('/v1/finance/search', {
    q: normalized, quotesCount: '8', newsCount: '0',
  }, 64 * 1024, signal);
  if (!isPlainObject(payload) || !Array.isArray(payload.quotes) || payload.quotes.length > 64) {
    throw new Error('Invalid Yahoo discovery response');
  }
  const candidates: YahooPersonalListingCandidate[] = [];
  const symbols = new Set<string>();
  for (const row of payload.quotes) {
    if (!isPlainObject(row) || typeof row.symbol !== 'string' || !SYMBOL.test(row.symbol)
      || (row.quoteType !== 'EQUITY' && row.quoteType !== 'ETF')
      || typeof row.exchange !== 'string' || !/^[A-Z0-9][A-Z0-9 ._-]{0,63}$/.test(row.exchange)
      || symbols.has(row.symbol)) continue;
    candidates.push({
      symbol: row.symbol, name: text(row.longname) ?? text(row.shortname) ?? row.symbol,
      assetClass: row.quoteType === 'ETF' ? 'etf' : 'stock', exchange: row.exchange,
    });
    symbols.add(row.symbol);
    if (candidates.length === 8) break;
  }
  return candidates;
}

export async function resolveYahooPersonalListingIdentity(symbol: string, signal?: AbortSignal): Promise<YahooPersonalListingResolution> {
  if (!SYMBOL.test(symbol)) throw new Error('Invalid Yahoo listing symbol');
  const payload = await fetchYahooJson('/v8/finance/chart/' + encodeURIComponent(symbol), {
    interval: '1d', range: '3mo',
  }, 160 * 1024, signal);
  const chart = isPlainObject(payload) && isPlainObject(payload.chart) ? payload.chart : null;
  const row = chart && Array.isArray(chart.result) && chart.result.length === 1
    && isPlainObject(chart.result[0]) ? chart.result[0] : null;
  const meta = row && isPlainObject(row.meta) ? row.meta : null;
  if (!chart || chart.error != null || !meta || meta.symbol !== symbol
    || (meta.currency !== 'USD' && meta.currency !== 'EUR')
    || (meta.instrumentType !== 'EQUITY' && meta.instrumentType !== 'ETF')
    || typeof meta.exchangeName !== 'string') throw new Error('Yahoo listing identity mismatch');
  const suffix = symbol.includes('.') ? symbol.slice(symbol.lastIndexOf('.') + 1) : null;
  if (suffix ? SUFFIX_EXCHANGES[suffix] !== meta.exchangeName : !US_EXCHANGES.includes(meta.exchangeName)) {
    throw new Error('Yahoo listing exchange mismatch');
  }
  const now = Date.now();
  const instrument = normalizePersonalListingIdentity({
    version: 1, symbol, providerSymbol: symbol,
    name: text(meta.longName) ?? text(meta.shortName) ?? symbol,
    assetClass: meta.instrumentType === 'ETF' ? 'etf' : 'stock',
    nativeCurrency: meta.currency.toLowerCase(), exchange: meta.exchangeName,
    source: 'yahoo_chart', resolvedAt: new Date(now).toISOString(),
  });
  if (!instrument) throw new Error('Yahoo listing conflicts with the configured instrument');

  // Identity validation above is mandatory. Thin or stale OHLC may only omit
  // this optional convenience series; it cannot create a quote or weaken identity.
  try {
    const series = parseYahooPersonalChart(symbol, payload, now, { listing: instrument });
    return { instrument, series };
  } catch (error) {
    // The catalog has narrower venue constraints than the general discovery
    // allowlist. Its identity rejection must never become an identity-only success.
    if (error instanceof Error && error.message.includes('mismatch')) throw error;
    return { instrument };
  }
}

function privateSameOrigin(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const site = request.headers.get('sec-fetch-site');
    if (!origin || !host || !['https:', 'http:'].includes(url.protocol)
      || url.host !== host || origin !== url.origin
      || (site !== null && site !== 'same-origin')) return false;
    return url.protocol === 'https:' || (!process.env.VERCEL
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

export async function handleYahooPersonalDiscoveryRequest(request: Request, scope: 'local' | 'private', operation: 'search' | 'resolve'): Promise<Response> {
  if (scope === 'local' ? !isAuthorizedLocalYahooRequest(request)
    : INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud' || !privateSameOrigin(request)) {
    return privateJson({ error: 'yahoo_discovery_access_denied' }, { status: 403 });
  }
  try {
    const owner = scope === 'local' ? 'local-personal' : (await requireFirebaseUser(request)).uid;
    if (scope === 'private' && (!process.env.INVESTATLAS_PRIVATE_OWNER_UID
      || owner !== process.env.INVESTATLAS_PRIVATE_OWNER_UID)) {
      return privateJson({ error: 'yahoo_owner_required' }, { status: 403 });
    }
    const limited = enforceRateLimit(new Request(request.url), MINUTE, owner)
      ?? enforceRateLimit(new Request(request.url), HOUR, owner);
    if (limited) return privateJson({ code: 'rate_limited', error: 'yahoo_rate_limited' }, {
      status: 429, headers: { 'Retry-After': limited.headers.get('retry-after') ?? '90' },
    });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: 'yahoo_json_required' }, { status: 400 });
    }
    const body = await readBoundedJson(request, 512);
    if (!isPlainObject(body) || Object.keys(body).length !== 1
      || (operation === 'search' ? !searchQuery(body.query)
        : typeof body.symbol !== 'string' || !SYMBOL.test(body.symbol))) {
      return privateJson({ error: 'yahoo_invalid_discovery_request' }, { status: 400 });
    }
    return operation === 'search'
      ? privateJson({ candidates: await fetchYahooPersonalListingCandidates(body.query as string, request.signal) })
      : privateJson(await resolveYahooPersonalListingIdentity(body.symbol as string, request.signal));
  } catch (error) {
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: 'yahoo_valid_owner_session_required' }, { status: error.status });
    }
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: 'yahoo_invalid_discovery_request' }, { status: error.status });
    }
    if (error instanceof YahooPersonalUpstreamError) {
      const denied = error.status === 401 || error.status === 403;
      const limited = error.status === 429;
      return privateJson({
        code: denied ? 'provider_access_denied' : limited ? 'rate_limited' : 'provider_unavailable',
        error: limited ? 'yahoo_rate_limited' : 'yahoo_discovery_unavailable',
      }, { status: limited ? 429 : 503, headers: { 'Retry-After': String(error.retryAfterSeconds) } });
    }
    return privateJson({ code: 'provider_unavailable', error: 'yahoo_discovery_unavailable' }, { status: 503 });
  }
}
