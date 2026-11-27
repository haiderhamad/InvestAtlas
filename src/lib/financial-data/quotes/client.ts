import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { fetchFinancialData } from '@/lib/financial-data/client';
import type { CurrentPriceSnapshot, CurrentQuoteIssue } from '@/lib/financial-data/quotes/current-quote-service';

const MAX_SYMBOLS_PER_REQUEST = 25;
const MAX_SYMBOLS_PER_BATCH_RUN = 250;
const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/;

export interface CurrentQuoteBatchResult {
  status: 'complete' | 'partial' | 'unavailable';
  prices: Record<string, CurrentPriceSnapshot>;
  timestamp: string | null;
  failedSymbols: string[];
  refreshPolicy: CurrentQuoteRefreshPolicy;
  issues?: Record<string, CurrentQuoteIssue['code']>;
  /** Earliest time to retry after an HTTP rate limit, in Unix milliseconds. */
  retryAt?: number;
}

export type CurrentQuoteRefreshPolicy =
  | 'poll_when_visible'
  | 'manual_only'
  | 'unknown';

export type CurrentQuoteRequestOutcome =
  | { status: 'current'; value: CurrentQuoteBatchResult }
  | { status: 'current_error'; error: unknown }
  | { status: 'stale' };

export interface CurrentQuoteRequestCoordinator {
  run: (
    key: string,
    request: (signal: AbortSignal) => Promise<CurrentQuoteBatchResult>,
  ) => Promise<CurrentQuoteRequestOutcome>;
  cancel: () => void;
}

/**
 * Keeps quote refreshes latest-input-wins without allowing periodic calls for
 * the same input to create overlapping provider requests.
 */
export function createCurrentQuoteRequestCoordinator(): CurrentQuoteRequestCoordinator {
  let generation = 0;
  let active: {
    key: string;
    generation: number;
    controller: AbortController;
    promise: Promise<CurrentQuoteRequestOutcome>;
  } | null = null;

  const cancel = () => {
    generation += 1;
    active?.controller.abort();
    active = null;
  };

  const run: CurrentQuoteRequestCoordinator['run'] = (key, request) => {
    if (active?.key === key) {
      return active.promise;
    }

    active?.controller.abort();
    generation += 1;
    const requestGeneration = generation;
    const controller = new AbortController();
    const promise = request(controller.signal).then<
      CurrentQuoteRequestOutcome,
      CurrentQuoteRequestOutcome
    >(
      (value) => (
        requestGeneration === generation && !controller.signal.aborted
          ? { status: 'current', value }
          : { status: 'stale' }
      ),
      (error) => (
        requestGeneration === generation && !controller.signal.aborted
          ? { status: 'current_error', error }
          : { status: 'stale' }
      ),
    ).finally(() => {
      if (active?.generation === requestGeneration) {
        active = null;
      }
    });

    active = {
      key,
      generation: requestGeneration,
      controller,
      promise,
    };
    return promise;
  };

  return { run, cancel };
}

export function shouldRefreshCurrentQuotes(
  policy: CurrentQuoteRefreshPolicy,
  visibilityState: DocumentVisibilityState,
): boolean {
  return visibilityState === 'visible' && policy !== 'manual_only';
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizeSymbols(symbols: ReadonlyArray<string>): string[] {
  const normalized = [
    ...new Set(symbols.map((symbol) => symbol.trim().toUpperCase())),
  ].filter(Boolean);
  if (
    normalized.length > MAX_SYMBOLS_PER_BATCH_RUN
    || normalized.some((symbol) => !SYMBOL_PATTERN.test(symbol))
  ) {
    throw new Error('Invalid current-quote symbol list');
  }
  return normalized;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isDisplayableCurrentQuote(value: unknown): value is CurrentPriceSnapshot {
  if (!value || typeof value !== 'object') return false;

  const snapshot = value as Partial<CurrentPriceSnapshot>;
  if (!Number.isFinite(snapshot.price) || Number(snapshot.price) <= 0) return false;

  const priceField = snapshot.fields?.price;
  if (!priceField) {
    // Transitional compatibility for test fixtures and locally persisted v1.1 rows.
    return true;
  }

  if (priceField.status !== 'available') return false;
  if (priceField.quality === 'demo') return true;
  if (priceField.freshness !== 'fresh') return false;
  const deadline = currentQuoteFreshUntil(snapshot);
  return deadline === null || deadline > Date.now();
}

/** A response without a proven deadline can be displayed once, but cannot survive a failed refresh. */
export function currentQuoteFreshUntil(snapshot: Partial<CurrentPriceSnapshot>): number | null {
  const field = snapshot.fields?.price;
  if (field?.status !== 'available') return null;
  if (field.quality === 'demo') return Number.POSITIVE_INFINITY;
  const deadline = snapshot.freshUntil;
  return field.freshness === 'fresh'
    && typeof deadline === 'number' && Number.isSafeInteger(deadline) && deadline > 0 && deadline <= 8.64e15
    ? deadline
    : null;
}

function quoteIssueCode(value: unknown): value is CurrentQuoteIssue['code'] {
  return value === 'provider_unavailable' || value === 'fx_unavailable' || value === 'rate_limited';
}

function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  const isDelay = /^\d+$/.test(value);
  const deadline = isDelay ? now + Number(value) * 1_000 : Date.parse(value);
  if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > 8.64e15) return undefined;
  if (!isDelay && new Date(deadline).toUTCString() !== value) return undefined;
  return deadline;
}

export async function fetchCurrentQuoteBatches(
  symbols: ReadonlyArray<string>,
  currency: QuoteCurrency = 'eur',
  fetcher: Fetcher = fetchFinancialData,
  signal?: AbortSignal,
): Promise<CurrentQuoteBatchResult> {
  const normalized = normalizeSymbols(symbols);
  if (normalized.length === 0) {
    return {
      status: 'complete',
      prices: {},
      timestamp: null,
      failedSymbols: [],
      refreshPolicy: 'manual_only',
    };
  }

  const prices: Record<string, CurrentPriceSnapshot> = {};
  const failedSymbols: string[] = [];
  const issues: NonNullable<CurrentQuoteBatchResult['issues']> = {};
  let timestamp: string | null = null;
  let partialPayload = false;
  let refreshPolicy: CurrentQuoteRefreshPolicy = 'unknown';
  let retryAt: number | undefined;
  let rateLimited = false;

  for (const batch of chunks(normalized, MAX_SYMBOLS_PER_REQUEST)) {
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (rateLimited) {
        failedSymbols.push(...batch);
        for (const symbol of batch) issues[symbol] = 'rate_limited';
        continue;
      }
      const parameters = new URLSearchParams({
        symbols: batch.join(','),
        currency,
      });
      const response = await fetcher(
        `/api/prices/current?${parameters.toString()}`,
        {
          headers: { Accept: 'application/json' },
          signal,
        },
      );
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (response.status === 429) {
        rateLimited = true;
        retryAt = parseRetryAfter(response.headers.get('Retry-After'), Date.now());
        failedSymbols.push(...batch);
        for (const symbol of batch) issues[symbol] = 'rate_limited';
        continue;
      }
      if (!response.ok) throw new Error('Current quote batch unavailable');
      const payload = await response.json() as {
        status?: unknown;
        prices?: unknown;
        issues?: unknown;
        timestamp?: unknown;
        refreshPolicy?: unknown;
      };
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!payload.prices || typeof payload.prices !== 'object') {
        throw new Error('Invalid current quote response');
      }
      const batchPrices = payload.prices as Record<string, unknown>;
      for (const symbol of batch) {
        const candidate = batchPrices[symbol];
        if (isDisplayableCurrentQuote(candidate)) {
          prices[symbol] = candidate;
        } else {
          failedSymbols.push(symbol);
        }
      }
      if (Array.isArray(payload.issues)) {
        for (const issue of payload.issues) {
          const symbol = issue?.symbol;
          const code = issue?.code;
          if (typeof symbol !== 'string' || !batch.includes(symbol) || prices[symbol] || !quoteIssueCode(code)) continue;
          if (!issues[symbol] || code === 'rate_limited') issues[symbol] = code;
        }
      }
      if (payload.status === 'partial' || payload.status === 'unavailable') {
        partialPayload = true;
      }
      if (typeof payload.timestamp === 'string') timestamp = payload.timestamp;
      if (
        payload.refreshPolicy === 'poll_when_visible'
        || payload.refreshPolicy === 'manual_only'
      ) {
        refreshPolicy = payload.refreshPolicy;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failedSymbols.push(...batch);
    }
  }

  const available = Object.keys(prices).length;
  return {
    status: available === 0
      ? 'unavailable'
      : failedSymbols.length > 0 || partialPayload || available < normalized.length
        ? 'partial'
        : 'complete',
    prices,
    timestamp,
    failedSymbols,
    refreshPolicy,
    ...(Object.keys(issues).length > 0 && { issues }),
    ...(retryAt !== undefined && { retryAt }),
  };
}
