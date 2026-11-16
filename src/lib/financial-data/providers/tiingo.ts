import { readBoundedResponseJson } from '@/lib/api/bounded-response';
import type { FinancialConnectionStatus } from './credential-store';

const TIINGO_ORIGIN = 'https://api.tiingo.com';
const REQUEST_TIMEOUT_MS = 6_000;
// Five years of Tiingo's full EOD JSON response is commonly above 256 KiB.
// One MiB safely covers the accepted 2,500-row ceiling while preserving a
// strict provider-response bound before normalization drops unused fields.
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRACKED_HEALTH_KEYS = 5_000;
const MAX_FINANCIAL_VALUE = Number.MAX_SAFE_INTEGER;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

export interface TiingoDailyPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TiingoTestResult {
  status: FinancialConnectionStatus;
  capabilities: Array<'quote' | 'history'>;
  checkedAt: string;
}

interface ProviderHealth {
  blockedUntil: number;
  failures: number;
}

declare global {
  var __investAtlasTiingoUserHealth: Map<string, ProviderHealth> | undefined;
}

const providerHealth = globalThis.__investAtlasTiingoUserHealth
  ?? (globalThis.__investAtlasTiingoUserHealth = new Map());

function pruneProviderHealth(now: number): void {
  for (const [key, health] of providerHealth) {
    if (health.blockedUntil <= now && health.failures === 0) {
      providerHealth.delete(key);
    }
  }
  while (providerHealth.size >= MAX_TRACKED_HEALTH_KEYS) {
    const oldestKey = providerHealth.keys().next().value as string | undefined;
    if (!oldestKey) break;
    providerHealth.delete(oldestKey);
  }
}

export class TiingoProviderError extends Error {
  status: FinancialConnectionStatus;
  constructor(status: FinancialConnectionStatus) {
    super('Tiingo provider request failed');
    this.name = 'TiingoProviderError';
    this.status = status;
  }
}

function classifyStatus(status: number): FinancialConnectionStatus {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402) return 'quota_exhausted';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'unexpected_response';
}

function safeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new TiingoProviderError('capability_unavailable');
  }
  return normalized;
}

// AbortSignal.any/timeout are missing on some older iOS Safari versions.
// Use baseline AbortController so the 6s deadline and caller cancellation work
// across browser versions, including while consuming a bounded response body.
function scopedRequestSignal(caller?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (caller?.aborted) abort();
  else caller?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(deadline);
      caller?.removeEventListener('abort', abort);
    },
  };
}

async function requestTiingo(
  path: string,
  apiKey: string,
  healthKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !(path.startsWith('/tiingo/daily/') || path.startsWith('/tiingo/crypto/prices?'))
    || path.includes('://')
    || !API_KEY_PATTERN.test(apiKey)
  ) {
    throw new TiingoProviderError('misconfigured');
  }
  pruneProviderHealth(Date.now());
  const health = providerHealth.get(healthKey);
  if (health && health.blockedUntil > Date.now()) {
    throw new TiingoProviderError('rate_limited');
  }

  const scopedSignal = scopedRequestSignal(signal);
  try {
    let response: Response;
    try {
      response = await fetch(`${TIINGO_ORIGIN}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: scopedSignal.signal,
    });
  } catch {
    // Caller cancellation and the shared request deadline are not provider
    // failures and must not place the user's credential into cooldown.
    if (signal?.aborted) {
      throw new TiingoProviderError('provider_unavailable');
    }
    const latestHealth = providerHealth.get(healthKey);
    const failures = (latestHealth?.failures ?? 0) + 1;
    const now = Date.now();
    providerHealth.set(healthKey, {
      failures,
      blockedUntil: Math.max(
        latestHealth?.blockedUntil ?? 0,
        failures >= 3 ? now + 30_000 : 0,
      ),
    });
    throw new TiingoProviderError('provider_unavailable');
  }

  if (!response.ok) {
    const status = classifyStatus(response.status);
    const latestHealth = providerHealth.get(healthKey);
    providerHealth.set(healthKey, {
      failures: (latestHealth?.failures ?? 0) + 1,
      blockedUntil: Math.max(
        latestHealth?.blockedUntil ?? 0,
        status === 'rate_limited' ? Date.now() + 60_000 : 0,
      ),
    });
    throw new TiingoProviderError(status);
  }
  const latestHealth = providerHealth.get(healthKey);
  providerHealth.set(healthKey, {
    failures: 0,
    // Preserve a concurrent rate-limit response even when another in-flight
    // symbol succeeds moments later.
    blockedUntil: latestHealth?.blockedUntil ?? 0,
  });

  try {
    return await readBoundedResponseJson(response, MAX_RESPONSE_BYTES);
  } catch {
    throw new TiingoProviderError('unexpected_response');
  }
  } finally {
    scopedSignal.dispose();
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function calendarDay(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== day
    || !Number.isFinite(Date.parse(value))
  ) return null;
  return day;
}

function normalizeDailyPrices(
  value: unknown,
  expectedStartDate: string,
  expectedEndDate: string,
): TiingoDailyPrice[] {
  if (!Array.isArray(value) || value.length > 2_500) {
    throw new TiingoProviderError('unexpected_response');
  }
  const rows: TiingoDailyPrice[] = [];
  const seenDays = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new TiingoProviderError('unexpected_response');
    }
    const row = item as Record<string, unknown>;
    const date = typeof row.date === 'string' ? row.date : '';
    const day = calendarDay(row.date);
    const open = finite(row.open);
    const high = finite(row.high);
    const low = finite(row.low);
    const close = finite(row.close);
    const volume = finite(row.volume);
    if (
      !day
      || day < expectedStartDate
      || day > expectedEndDate
      || seenDays.has(day)
      || open === null || open <= 0
      || open > MAX_FINANCIAL_VALUE
      || high === null || high <= 0
      || high > MAX_FINANCIAL_VALUE
      || low === null || low <= 0
      || low > MAX_FINANCIAL_VALUE
      || close === null || close <= 0
      || close > MAX_FINANCIAL_VALUE
      || volume === null || volume < 0
      || volume > MAX_FINANCIAL_VALUE
      || high < Math.max(open, close, low)
      || low > Math.min(open, close, high)
    ) {
      throw new TiingoProviderError('unexpected_response');
    }
    seenDays.add(day);
    rows.push({ date, open, high, low, close, volume });
  }
  if (rows.length === 0) throw new TiingoProviderError('unexpected_response');
  return rows.sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

export async function testTiingoCredential(
  apiKey: string,
  healthKey: string,
  signal?: AbortSignal,
): Promise<TiingoTestResult> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 10);
  try {
    const value = await requestTiingo(
      `/tiingo/daily/AAPL/prices?startDate=${start.toISOString().slice(0, 10)}&endDate=${end.toISOString().slice(0, 10)}&resampleFreq=daily`,
      apiKey,
      healthKey,
      signal,
    );
    normalizeDailyPrices(
      value,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    );
    return {
      status: 'connected',
      capabilities: ['quote', 'history'],
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: error instanceof TiingoProviderError
        ? error.status
        : 'provider_unavailable',
      capabilities: [],
      checkedAt: new Date().toISOString(),
    };
  }
}


/**
 * Tiingo Crypto Prices: completed daily BTC/ETH-USD exchange-aggregated bars.
 * This is separate from equity EOD; no intraday/realtime claims or invented
 * cross-exchange prices. Only explicit user-token, fixed Tiingo host and pairs.
 */
export async function fetchTiingoCryptoDailyPrices(input: {
  apiKey: string;
  healthKey: string;
  symbol: 'BTC' | 'ETH';
  startDate: string;
  endDate: string;
  signal?: AbortSignal;
}): Promise<TiingoDailyPrice[]> {
  if (
    (input.symbol !== 'BTC' && input.symbol !== 'ETH')
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)
    || calendarDay(input.startDate + 'T00:00:00.000Z') !== input.startDate
    || calendarDay(input.endDate + 'T00:00:00.000Z') !== input.endDate
    || input.startDate > input.endDate
  ) throw new TiingoProviderError('misconfigured');

  const pair = input.symbol.toLowerCase() + 'usd';
  const value = await requestTiingo(
    `/tiingo/crypto/prices?tickers=${pair}&startDate=${input.startDate}&endDate=${input.endDate}&resampleFreq=1day`,
    input.apiKey, input.healthKey, input.signal,
  );
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') {
    throw new TiingoProviderError('unexpected_response');
  }
  const result = value[0] as Record<string, unknown>;
  if (result.ticker !== pair || result.baseCurrency !== pair.slice(0, -3)
    || result.quoteCurrency !== 'usd' || !Array.isArray(result.priceData)) {
    throw new TiingoProviderError('unexpected_response');
  }
  return normalizeDailyPrices(result.priceData, input.startDate, input.endDate);
}

export async function fetchTiingoDailyPrices(input: {
  apiKey: string;
  healthKey: string;
  symbol: string;
  startDate: string;
  endDate: string;
  signal?: AbortSignal;
}): Promise<TiingoDailyPrice[]> {
  const symbol = safeSymbol(input.symbol);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)
    || calendarDay(`${input.startDate}T00:00:00.000Z`) !== input.startDate
    || calendarDay(`${input.endDate}T00:00:00.000Z`) !== input.endDate
    || input.startDate > input.endDate
  ) {
    throw new TiingoProviderError('misconfigured');
  }
  const value = await requestTiingo(
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${input.startDate}&endDate=${input.endDate}&resampleFreq=daily`,
    input.apiKey,
    input.healthKey,
    input.signal,
  );
  return normalizeDailyPrices(value, input.startDate, input.endDate);
}
