import {
  clearAlphaVantageNormalizedCache,
  clearAlphaVantageSessionCredential,
  getAlphaVantageCachedSymbols,
  loadAlphaVantageDailySeries,
  reconcileAlphaVantageCredentialOwner,
  setAlphaVantageSessionCredential,
} from '@/lib/financial-data/providers/alpha-vantage-browser';

class IsolatedStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string): void { this.entries.delete(key); }
  setItem(key: string, value: string): void { this.entries.set(key, value); }
}

function observationDate(daysBeforeToday: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - daysBeforeToday);
  return value.toISOString().slice(0, 10);
}

function fixturePayload(): Record<string, unknown> {
  const first = { '1. open': '200', '2. high': '205', '3. low': '195', '4. close': '202', '5. volume': '1234' };
  return {
    'Meta Data': { '2. Symbol': 'AAPL' },
    'Time Series (Daily)': {
      [observationDate(2)]: { ...first },
      [observationDate(1)]: { ...first },
    },
  };
}

describe('Alpha Vantage strict raw daily observation validation', () => {
  const originalWindow = globalThis.window;
  const originalFetch = global.fetch;
  beforeAll(() => {
    const fakeWindow = new EventTarget();
    Object.assign(fakeWindow, {
      localStorage: new IsolatedStorage(),
      location: new URL('https://investatlas.example/portfolio'),
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  });
  beforeEach(() => {
    clearAlphaVantageSessionCredential();
    window.localStorage.clear();
  });
  afterAll(() => {
    clearAlphaVantageSessionCredential();
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('does not restore personal cache from a provider request that finishes after cache clearing', async () => {
    let completeRequest!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_url: unknown, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => { completeRequest = resolve; });
    });
    setAlphaVantageSessionCredential('fixture-user', 'SYNTHETIC_TEST_ONLY');

    const pending = loadAlphaVantageDailySeries('fixture-user', 'AAPL');
    const rejection = expect(pending).rejects.toMatchObject({ status: 'provider_unavailable' });
    clearAlphaVantageNormalizedCache('fixture-user');
    expect(getAlphaVantageCachedSymbols('fixture-user')).toEqual([]);
    expect(requestSignal?.aborted).toBe(true);

    // Simulate a provider that disregards abort: late completion must still
    // never recreate data explicitly removed by the workspace owner.
    completeRequest(new Response(JSON.stringify(fixturePayload()), { status: 200 }));
    await rejection;
    expect(getAlphaVantageCachedSymbols('fixture-user')).toEqual([]);

    // Clearing normalized data does not disconnect the session credential.
    // A deliberate new refresh must still be able to fetch a fresh series.
    global.fetch = jest.fn(async () => new Response(JSON.stringify(fixturePayload()), { status: 200 }));
    const refreshed = await loadAlphaVantageDailySeries('fixture-user', 'AAPL');
    expect(refreshed.cacheStatus).toBe('miss');
    expect(getAlphaVantageCachedSymbols('fixture-user')).toContain('AAPL');
  });

  it('rejects an already-aborted caller even when the personal cache is fresh', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(fixturePayload()), { status: 200 }));
    setAlphaVantageSessionCredential('fixture-user', 'SYNTHETIC_TEST_ONLY');
    await loadAlphaVantageDailySeries('fixture-user', 'AAPL');
    expect(getAlphaVantageCachedSymbols('fixture-user')).toContain('AAPL');
    (global.fetch as jest.Mock).mockClear();

    const controller = new AbortController();
    controller.abort();
    await expect(loadAlphaVantageDailySeries('fixture-user', 'AAPL', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never returns a cached fallback for an in-flight request invalidated by account change', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(fixturePayload()), { status: 200 }));
    setAlphaVantageSessionCredential('fixture-user', 'SYNTHETIC_TEST_ONLY');
    await loadAlphaVantageDailySeries('fixture-user', 'AAPL');

    const cacheKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)!).find((key) => key.includes('normalized-market.v1.AAPL'));
    expect(cacheKey).toBeDefined();
    const cached = JSON.parse(window.localStorage.getItem(cacheKey!)!) as Record<string, unknown>;
    cached.retrievedAt = new Date(Date.now() - 3_600_000).toISOString();
    cached.cachedAt = cached.retrievedAt;
    cached.expiresAt = new Date(Date.now() - 1_800_000).toISOString();
    cached.staleUntil = new Date(Date.now() + 86_400_000).toISOString();
    window.localStorage.setItem(cacheKey!, JSON.stringify(cached));

    let finish!: (response: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const pending = loadAlphaVantageDailySeries('fixture-user', 'AAPL', undefined, { allowStale: true });
    const outcome = expect(pending).rejects.toMatchObject({ status: 'provider_unavailable' });
    reconcileAlphaVantageCredentialOwner('other-account');
    finish(new Response(JSON.stringify(fixturePayload()), { status: 200 }));
    await outcome;

    // Stale fallback remains usable after an explicitly renewed connection
    // to the original account when a subsequent provider request fails.
    setAlphaVantageSessionCredential('fixture-user', 'SYNTHETIC_TEST_ONLY');
    global.fetch = jest.fn(async () => { throw new Error('Provider temporarily unreachable'); });
    const fallback = await loadAlphaVantageDailySeries('fixture-user', 'AAPL', undefined, { allowStale: true });
    expect(fallback.cacheStatus).toBe('hit_stale');
  });

  it.each([
    ['boolean low price', '3. low', true],
    ['null volume', '5. volume', null],
    ['hexadecimal volume', '5. volume', '0x10'],
  ])('rejects malformed %s instead of coercing it into a market value', async (_label, field, invalidValue) => {
    const payload = fixturePayload();
    const rows = payload['Time Series (Daily)'] as Record<string, Record<string, unknown>>;
    Object.values(rows)[0][field] = invalidValue;
    global.fetch = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    setAlphaVantageSessionCredential('fixture-user', 'SYNTHETIC_TEST_ONLY');

    await expect(loadAlphaVantageDailySeries('fixture-user', 'AAPL'))
      .rejects.toMatchObject({ status: 'unexpected_response' });
    expect(getAlphaVantageCachedSymbols('fixture-user')).toEqual([]);
  });
});
