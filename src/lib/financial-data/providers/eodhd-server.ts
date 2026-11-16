import {
  boundEodhdRange, EODHD_MAX_BARS, EODHD_MAX_BYTES, getEodhdTarget,
  validateEodhdKey, validEodhdDate,
  type EodhdDailySeries, type EodhdHistoryRange, type EodhdInstrument, type EodhdMapping,
} from './eodhd-contract';

export { getEodhdTarget, normalizeEodhdInstrument } from './eodhd-contract';
export type { EodhdDailySeries, EodhdHistoryRange, EodhdInstrument } from './eodhd-contract';

const ORIGIN = 'https://eodhd.com';
const DAY = 86_400_000;
const MAX_OWNERS = 256;
const requests = new Map<string, number[]>();
const cooldowns = new Map<string, { status: number; until: number }>();

export class EodhdUpstreamError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number) {
    super('Personal EODHD request unavailable');
    this.name = 'EodhdUpstreamError';
  }
}

function consume(owner: string): void {
  if (!owner || owner.length > 128) throw new Error('Invalid EODHD owner');
  const now = Date.now();
  const blocked = cooldowns.get(owner);
  if (blocked && blocked.until > now) {
    throw new EodhdUpstreamError(blocked.status, Math.max(1, Math.ceil((blocked.until - now) / 1000)));
  }
  const seen = (requests.get(owner) ?? []).filter(stamp => stamp > now - DAY);
  if (seen.length >= 20) throw new EodhdUpstreamError(429, Math.max(1, Math.ceil((seen[0] + DAY - now) / 1000)));
  // Private/local owner scopes are finite; bound retained accounting even for direct callers.
  if (!requests.has(owner) && requests.size >= MAX_OWNERS) {
    for (const [key, stamps] of requests) if (!stamps.some(stamp => stamp > now - DAY)) requests.delete(key);
    if (requests.size >= MAX_OWNERS) throw new EodhdUpstreamError(429, 3600);
  }
  requests.set(owner, [...seen, now]);
}

function retryAfter(response: Response): number {
  const value = response.headers.get('retry-after');
  const parsed = value && /^\d+$/.test(value) ? Number(value)
    : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(604800, Math.ceil(parsed))
    : response.status === 402 || response.status === 403 || response.status === 401 ? 3600 : 90;
}

async function request(path: string, params: Record<string, string>, key: string, owner: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  consume(owner);
  const url = new URL(path, ORIGIN);
  url.search = new URLSearchParams({ ...params, fmt: 'json', api_token: key }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  try {
    let response: Response;
    try {
      // Provider requires api_token in its upstream query. Keep this server-only,
      // never log the URL/caught fetch error, and never follow redirects.
      response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new EodhdUpstreamError(503, 90);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const seconds = retryAfter(response);
      if ([401, 402, 403, 429].includes(response.status)) {
        cooldowns.set(owner, { status: response.status, until: Date.now() + seconds * 1000 });
      }
      throw new EodhdUpstreamError(response.status, seconds);
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) {
      await response.body?.cancel();
      throw new Error('EODHD JSON response unavailable');
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > EODHD_MAX_BYTES) { await response.body.cancel(); throw new Error('EODHD response exceeds bounded size'); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let count = 0;
    let body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        count += chunk.value.byteLength;
        if (count > EODHD_MAX_BYTES) { await reader.cancel(); throw new Error('EODHD response exceeds bounded size'); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try { return JSON.parse(body); } catch { throw new Error('Invalid EODHD JSON response'); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function resolveEodhdMapping(instrument: EodhdInstrument | string, payload: unknown): EodhdMapping {
  const target = getEodhdTarget(instrument);
  if (!Array.isArray(payload) || payload.length > 20) throw new Error('Invalid EODHD discovery response');
  const split = target.providerSymbol.lastIndexOf('.');
  const code = target.providerSymbol.slice(0, split);
  const exchange = target.providerSymbol.slice(split + 1);
  const candidates = payload.filter(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.Code === code && row.Exchange === exchange;
  });
  if (candidates.length !== 1) throw new Error('EODHD listing metadata mismatch');
  const row = candidates[0] as Record<string, unknown>;
  if (row.Currency !== target.listingCurrency || row.Type !== (target.instrument.assetClass === 'etf' ? 'ETF' : 'Common Stock')
    || typeof row.Name !== 'string' || !row.Name.trim() || row.Name.length > 256) throw new Error('EODHD listing metadata mismatch');
  return target;
}

function price(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e8;
}

export function parseEodhdDaily(
  payload: unknown, mapping: EodhdMapping,
  coverage: { requested: EodhdHistoryRange; checked: EodhdHistoryRange; historyYears: 1 | 5 },
  now = Date.now(),
): EodhdDailySeries {
  if (!Array.isArray(payload) || payload.length > EODHD_MAX_BARS) throw new Error('Invalid EODHD daily count');
  const bars: EodhdDailySeries['bars'] = [];
  const seen = new Set<string>();
  const today = new Date(now).toISOString().slice(0, 10);
  for (const value of payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid EODHD candle');
    const row = value as Record<string, unknown>;
    if (!validEodhdDate(row.date) || seen.has(row.date)
      || row.date < coverage.checked.from || row.date > coverage.checked.to || row.date >= today
      || ![row.open, row.high, row.low, row.close].every(price)
      || (row.high as number) < Math.max(row.open as number, row.close as number)
      || (row.low as number) > Math.min(row.open as number, row.close as number)
      || (row.volume !== null && (!Number.isSafeInteger(row.volume) || (row.volume as number) < 0))
      || (row.adjusted_close !== undefined && !price(row.adjusted_close))) {
      throw new Error('Invalid EODHD daily values or session date');
    }
    seen.add(row.date);
    bars.push({ date: row.date, open: row.open as number, high: row.high as number, low: row.low as number,
      close: row.close as number, volume: row.volume as number | null,
      ...(row.adjusted_close !== undefined ? { adjustedClose: row.adjusted_close as number } : {}) });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  const available = bars.length ? { from: bars[0].date, to: bars[bars.length - 1].date } : null;
  return {
    providerId: 'eodhd_personal_daily', assetSymbol: mapping.instrument.symbol,
    providerSymbol: mapping.providerSymbol, exchange: mapping.exchange,
    listingCurrency: mapping.listingCurrency, retrievedAt: new Date(now).toISOString(),
    latestObservationAt: available?.to ?? null, cacheStatus: 'miss',
    adjustment: 'raw_unadjusted', volumeAdjustment: 'splits', bars,
    coverage: { requested: { ...coverage.requested }, checked: { ...coverage.checked }, available,
      historyYears: coverage.historyYears, limited: coverage.requested.from !== coverage.checked.from
        || coverage.requested.to !== coverage.checked.to },
  };
}

async function discover(instrument: EodhdInstrument | string, key: string, owner: string, signal?: AbortSignal): Promise<EodhdMapping> {
  const target = getEodhdTarget(instrument);
  const split = target.providerSymbol.lastIndexOf('.');
  const payload = await request('/api/search/' + encodeURIComponent(target.providerSymbol.slice(0, split)), {
    exchange: target.providerSymbol.slice(split + 1), type: target.instrument.assetClass, limit: '20',
  }, key, owner, signal);
  return resolveEodhdMapping(instrument, payload);
}

export async function verifyEodhdPersonalKey(
  options: { key: string; owner: string; historyYears: 1 | 5 }, signal?: AbortSignal,
): Promise<{ connected: true; historyYears: 1 | 5 }> {
  const key = validateEodhdKey(options.key);
  if (options.historyYears !== 1 && options.historyYears !== 5) throw new Error('Invalid EODHD entitlement depth');
  await discover('AAPL', key, options.owner, signal);
  return { connected: true, historyYears: options.historyYears };
}

export async function fetchEodhdPersonalHistory(
  options: { key: string; owner: string; instrument: EodhdInstrument | string; range: EodhdHistoryRange; historyYears: 1 | 5 },
  signal?: AbortSignal,
): Promise<EodhdDailySeries> {
  const key = validateEodhdKey(options.key);
  const coverage = boundEodhdRange(options.range, options.historyYears);
  getEodhdTarget(options.instrument);
  const mapping = await discover(options.instrument, key, options.owner, signal);
  const payload = await request('/api/eod/' + encodeURIComponent(mapping.providerSymbol), {
    from: coverage.checked.from, to: coverage.checked.to, period: 'd', order: 'a',
  }, key, options.owner, signal);
  return parseEodhdDaily(payload, mapping, coverage);
}
