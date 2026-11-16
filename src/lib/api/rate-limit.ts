export interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_CLIENTS = 5_000;

declare global {
  // Reuse the limiter across warm invocations and development reloads within
  // one runtime instance. A Vercel WAF rule remains the distributed follow-up.
  var __investAtlasRateLimits: Map<string, RateLimitEntry> | undefined;
}

const rateLimits =
  globalThis.__investAtlasRateLimits ??
  (globalThis.__investAtlasRateLimits = new Map<string, RateLimitEntry>());

function getClientAddress(request: Request): string {
  // Vercel overwrites these headers with the public client IP. The
  // x-vercel-specific header remains authoritative when another proxy sits in
  // front of the deployment.
  const forwarded =
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';

  return forwarded.split(',')[0].trim().slice(0, 128) || 'unknown';
}

function pruneExpiredEntries(now: number): void {
  if (rateLimits.size < MAX_TRACKED_CLIENTS) return;

  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) {
      rateLimits.delete(key);
    }
  }

  // Stay memory-bounded even under a high-cardinality distributed attack.
  while (rateLimits.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = rateLimits.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateLimits.delete(oldestKey);
  }
}

export function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  identity = 'public',
): Response | null {
  const now = Date.now();
  pruneExpiredEntries(now);

  const boundedIdentity = identity.trim().slice(0, 128) || 'public';
  const key = JSON.stringify([
    policy.bucket,
    boundedIdentity,
    getClientAddress(request),
  ]);
  const current = rateLimits.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + policy.windowMs }
      : current;

  entry.count += 1;
  rateLimits.set(key, entry);

  if (entry.count <= policy.limit) {
    return null;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((entry.resetAt - now) / 1000),
  );

  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(policy.limit),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}

export const PUBLIC_SEARCH_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'public-search',
  limit: 20,
  windowMs: 60_000,
};

export const PUBLIC_CURRENT_PRICE_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'public-current-price',
  limit: 60,
  windowMs: 60_000,
};

export const PUBLIC_HISTORY_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'public-history',
  limit: 30,
  windowMs: 60_000,
};

export const PUBLIC_COMPUTE_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'public-compute',
  limit: 15,
  windowMs: 60_000,
};

export const AUTHENTICATED_AI_READ_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-ai-read',
  limit: 60,
  windowMs: 60_000,
};

export const AUTHENTICATED_AI_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-ai-mutation',
  limit: 20,
  windowMs: 60_000,
};

export const AUTHENTICATED_AI_COMPUTE_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-ai-compute',
  limit: 10,
  windowMs: 60_000,
};

export const AUTHENTICATED_FINANCIAL_READ_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-financial-read',
  limit: 60,
  windowMs: 60_000,
};

export const AUTHENTICATED_FINANCIAL_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-financial-mutation',
  limit: 12,
  windowMs: 60_000,
};

export const AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-financial-compute',
  limit: 30,
  windowMs: 60_000,
};

export const AUTHENTICATED_IMPORT_RATE_LIMIT: RateLimitPolicy = {
  bucket: 'authenticated-document-import',
  limit: 3,
  windowMs: 10 * 60_000,
};
