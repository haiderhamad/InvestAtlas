import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { fetchFinancialData } from '@/lib/financial-data/client';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';

const MAX_SYMBOLS_PER_REQUEST = 25;
const MAX_SYMBOLS_PER_BATCH_RUN = 250;
const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/;

export interface CurrentQuoteBatchResult {
  status: 'complete' | 'partial' | 'unavailable';
  prices: Record<string, CurrentPriceSnapshot>;
  timestamp: string | null;
  failedSymbols: string[];
  refreshPolicy: CurrentQuoteRefreshPolicy;
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

  return priceField.status === 'available'
    && (
      priceField.quality === 'demo'
      || priceField.freshness === 'fresh'
    );
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
  let timestamp: string | null = null;
  let partialPayload = false;
  let refreshPolicy: CurrentQuoteRefreshPolicy = 'unknown';

  for (const batch of chunks(normalized, MAX_SYMBOLS_PER_REQUEST)) {
    try {
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
      if (!response.ok) throw new Error('Current quote batch unavailable');
      const payload = await response.json() as {
        status?: unknown;
        prices?: unknown;
        timestamp?: unknown;
        refreshPolicy?: unknown;
      };
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
  };
}
