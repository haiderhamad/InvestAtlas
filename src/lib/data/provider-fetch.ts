import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
const MIN_PROVIDER_TIMEOUT_MS = 100;
const MAX_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_PROVIDER_COOLDOWN_MS = 60_000;
const MAX_PROVIDER_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_FAILURE_COOLDOWN_MS = 30_000;
const PROVIDER_FAILURE_THRESHOLD = 3;

export const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024;

const PROVIDER_ID_BY_HOST = new Map<string, string>([
  ['api-pub.bitfinex.com', 'bitfinex_public'],
  ['api.binance.com', 'binance_public'],
  ['api.coinbase.com', 'coinbase_public'],
  ['api.coingecko.com', 'coingecko_public'],
  ['api.exchange.coinbase.com', 'coinbase_public'],
  ['api.kraken.com', 'kraken_public'],
  ['data-api.ecb.europa.eu', 'ecb_reference_rates'],
  ['www.ecb.europa.eu', 'ecb_reference_rates'],
  ['query1.finance.yahoo.com', 'yahoo_finance'],
]);

interface ProviderHealthState {
  consecutiveFailures: number;
  blockedUntil: number;
  lastCheckedAt: number;
  lastStatus: number | null;
}

declare global {
  var __investAtlasProviderHealth:
    | Map<string, ProviderHealthState>
    | undefined;
}

const providerHealth =
  globalThis.__investAtlasProviderHealth
  ?? (globalThis.__investAtlasProviderHealth = new Map());

export class ProviderRequestValidationError extends Error {
  constructor() {
    super('Untrusted provider request');
    this.name = 'ProviderRequestValidationError';
  }
}

export class ProviderResponseTooLargeError extends Error {
  constructor() {
    super('Provider response exceeded the allowed size');
    this.name = 'ProviderResponseTooLargeError';
  }
}

export class ProviderCooldownError extends Error {
  readonly retryAt: string;

  constructor(retryAt: string) {
    super('Provider is temporarily cooling down');
    this.name = 'ProviderCooldownError';
    this.retryAt = retryAt;
  }
}

export interface ProviderHealthSnapshot {
  host: string;
  status: 'healthy' | 'degraded' | 'cooldown';
  consecutiveFailures: number;
  lastStatus: number | null;
  lastCheckedAt: string;
  retryAt: string | null;
}

export function getProviderHealthSnapshot(
  now = Date.now(),
): ProviderHealthSnapshot[] {
  return [...providerHealth.entries()]
    .map(([host, state]) => ({
      host,
      status: state.blockedUntil > now
        ? 'cooldown' as const
        : state.consecutiveFailures > 0
          ? 'degraded' as const
          : 'healthy' as const,
      consecutiveFailures: state.consecutiveFailures,
      lastStatus: state.lastStatus,
      lastCheckedAt: new Date(state.lastCheckedAt).toISOString(),
      retryAt: state.blockedUntil > now
        ? new Date(state.blockedUntil).toISOString()
        : null,
    }))
    .sort((left, right) => left.host.localeCompare(right.host));
}

function parseProviderUrl(input: Parameters<typeof fetch>[0]): URL {
  let rawUrl: string;
  if (typeof input === 'string') {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.href;
  } else {
    rawUrl = input.url;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderRequestValidationError();
  }

  if (
    url.protocol !== 'https:'
    || url.username.length > 0
    || url.password.length > 0
    || !PROVIDER_ID_BY_HOST.has(url.hostname)
  ) {
    throw new ProviderRequestValidationError();
  }

  const providerId = PROVIDER_ID_BY_HOST.get(url.hostname);
  if (!providerId || !isFinancialDataProviderActive(providerId)) {
    throw new ProviderRequestValidationError();
  }

  return url;
}

function parseContentLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new ProviderResponseTooLargeError();
  }

  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ProviderResponseTooLargeError();
  }
  return length;
}

function withBoundedBody(response: Response): Response {
  const declaredLength = parseContentLength(response);
  if (
    declaredLength !== null
    && declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new ProviderResponseTooLargeError();
  }
  if (!response.body) return response;

  let receivedBytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        controller.error(new ProviderResponseTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');

  return new Response(response.body.pipeThrough(limiter), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseRetryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (raw && /^\d+$/.test(raw)) {
    const milliseconds = Number(raw) * 1_000;
    if (Number.isFinite(milliseconds)) {
      return Math.min(
        Math.max(milliseconds, 1_000),
        MAX_PROVIDER_COOLDOWN_MS,
      );
    }
  }
  return DEFAULT_PROVIDER_COOLDOWN_MS;
}

function recordProviderResponse(host: string, response: Response): void {
  const now = Date.now();
  const previous = providerHealth.get(host);
  if (response.status === 429) {
    providerHealth.set(host, {
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      blockedUntil: now + parseRetryAfterMs(response),
      lastCheckedAt: now,
      lastStatus: response.status,
    });
    return;
  }
  if (response.status >= 500) {
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    providerHealth.set(host, {
      consecutiveFailures,
      blockedUntil: consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD
        ? now + PROVIDER_FAILURE_COOLDOWN_MS
        : 0,
      lastCheckedAt: now,
      lastStatus: response.status,
    });
    return;
  }
  providerHealth.set(host, {
    consecutiveFailures: 0,
    blockedUntil: 0,
    lastCheckedAt: now,
    lastStatus: response.status,
  });
}

function recordProviderNetworkFailure(host: string): void {
  const now = Date.now();
  const previous = providerHealth.get(host);
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  providerHealth.set(host, {
    consecutiveFailures,
    blockedUntil: consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD
      ? now + PROVIDER_FAILURE_COOLDOWN_MS
      : 0,
    lastCheckedAt: now,
    lastStatus: null,
  });
}

/**
 * Fetches an application-defined provider URL with strict destination, redirect,
 * timeout, and response-size boundaries.
 */
export async function fetchProvider(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const url = parseProviderUrl(input);
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < MIN_PROVIDER_TIMEOUT_MS
    || timeoutMs > MAX_PROVIDER_TIMEOUT_MS
  ) {
    throw new ProviderRequestValidationError();
  }

  const health = providerHealth.get(url.hostname);
  if (health && health.blockedUntil > Date.now()) {
    throw new ProviderCooldownError(
      new Date(health.blockedUntil).toISOString(),
    );
  }

  const parentSignal = init?.signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      signal,
      redirect: 'error',
    });
  } catch (error) {
    if (!parentSignal?.aborted) {
      recordProviderNetworkFailure(url.hostname);
    }
    throw error;
  }
  recordProviderResponse(url.hostname, response);
  return withBoundedBody(response);
}
