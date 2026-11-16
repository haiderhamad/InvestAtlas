import {
  enforceRateLimit,
  type RateLimitPolicy,
} from '@/lib/api/rate-limit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function request(ip: string) {
  return new Request('https://investatlas.example/api/test', {
    headers: { 'x-vercel-forwarded-for': ip },
  });
}

describe('public API rate limiting', () => {
  const policy: RateLimitPolicy = {
    bucket: `test-${Date.now()}`,
    limit: 2,
    windowMs: 60_000,
  };

  it('allows the configured request budget and then returns 429', async () => {
    expect(enforceRateLimit(request('203.0.113.1'), policy)).toBeNull();
    expect(enforceRateLimit(request('203.0.113.1'), policy)).toBeNull();

    const blocked = enforceRateLimit(request('203.0.113.1'), policy);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('Retry-After')).toBe('60');
    await expect(blocked?.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
    });
  });

  it('isolates client addresses and route buckets', () => {
    expect(enforceRateLimit(request('203.0.113.2'), policy)).toBeNull();
    expect(
      enforceRateLimit(request('203.0.113.1'), {
        ...policy,
        bucket: `${policy.bucket}-other`,
      }),
    ).toBeNull();
  });

  it('isolates authenticated budgets by both UID and client address', () => {
    const authenticatedPolicy: RateLimitPolicy = {
      bucket: `authenticated-${Date.now()}-${Math.random()}`,
      limit: 1,
      windowMs: 60_000,
    };

    expect(
      enforceRateLimit(
        request('203.0.113.10'),
        authenticatedPolicy,
        'user-a',
      ),
    ).toBeNull();
    const sameUserAndAddress = enforceRateLimit(
      request('203.0.113.10'),
      authenticatedPolicy,
      'user-a',
    );
    expect(sameUserAndAddress?.status).toBe(429);

    expect(
      enforceRateLimit(
        request('203.0.113.10'),
        authenticatedPolicy,
        'user-b',
      ),
    ).toBeNull();
    expect(
      enforceRateLimit(
        request('203.0.113.11'),
        authenticatedPolicy,
        'user-a',
      ),
    ).toBeNull();
    expect(sameUserAndAddress?.headers.get('Cache-Control')).toContain(
      'no-store',
    );
  });

  it('uses the Vercel client header ahead of a spoofable forwarded header', () => {
    const authoritativePolicy: RateLimitPolicy = {
      bucket: `authoritative-${Date.now()}-${Math.random()}`,
      limit: 1,
      windowMs: 60_000,
    };
    const first = new Request('https://investatlas.example/api/test', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.20',
        'x-forwarded-for': '198.51.100.1',
      },
    });
    const second = new Request('https://investatlas.example/api/test', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.20',
        'x-forwarded-for': '198.51.100.2',
      },
    });

    expect(
      enforceRateLimit(first, authoritativePolicy, 'user-a'),
    ).toBeNull();
    expect(
      enforceRateLimit(second, authoritativePolicy, 'user-a')?.status,
    ).toBe(429);
  });

  it('does not allow UID and IPv6 delimiters to collide', () => {
    const delimiterPolicy: RateLimitPolicy = {
      bucket: `delimiter-${Date.now()}-${Math.random()}`,
      limit: 1,
      windowMs: 60_000,
    };

    expect(
      enforceRateLimit(
        request('db8::1'),
        delimiterPolicy,
        'user:2001',
      ),
    ).toBeNull();
    expect(
      enforceRateLimit(
        request('2001:db8::1'),
        delimiterPolicy,
        'user',
      ),
    ).toBeNull();
  });

  it.each([
    'src/app/api/assets/search/route.ts',
    'src/app/api/financial-data/fx/route.ts',
    'src/app/api/prices/current/route.ts',
    'src/app/api/prices/history/route.ts',
    'src/app/api/prices/historical/route.ts',
    'src/app/api/prices/ath/route.ts',
    'src/app/api/prices/benchmark-history/route.ts',
    'src/app/api/prices/metal-spot/route.ts',
    'src/app/api/backtest/route.ts',
    'src/app/api/coins/check/route.ts',
  ])('guards provider-amplifying or compute-heavy route %s', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    const handlerStart = source.search(/export async function (?:GET|POST)/);
    const handler = source.slice(handlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('enforceRateLimit(');
    expect(handler.indexOf('enforceRateLimit(')).toBeLessThan(
      handler.indexOf('try {'),
    );
  });

  it('keeps public asset search local to the curated universe', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/assets/search/route.ts'),
      'utf8',
    );

    expect(source).not.toContain('query1.finance.yahoo.com');
    expect(source).not.toContain('api.coingecko.com');
    expect(source).not.toContain('fetchProvider(');
  });
});
