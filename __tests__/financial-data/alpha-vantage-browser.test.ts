import {
  AlphaVantageBrowserError,
  clearAlphaVantageSessionCredential,
  getAlphaVantageCachedSymbols,
  hasAlphaVantageSessionCredential,
  loadAlphaVantageDailySeries,
  reconcileAlphaVantageCredentialOwner,
  setAlphaVantageSessionCredential,
  supportsAlphaVantageBrowserAsset,
  testAlphaVantageCredential,
} from '@/lib/financial-data/providers/alpha-vantage-browser';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dailyPayload(symbol = 'AAPL'): Record<string, unknown> {
  return {
    'Meta Data': { '2. Symbol': symbol },
    'Time Series (Daily)': {
      [dateOffset(-1)]: {
        '1. open': '201.00',
        '2. high': '205.00',
        '3. low': '199.00',
        '4. close': '204.00',
        '5. volume': '123456',
      },
      [dateOffset(-2)]: {
        '1. open': '198.00',
        '2. high': '202.00',
        '3. low': '197.00',
        '4. close': '200.00',
        '5. volume': '120000',
      },
    },
  };
}

function providerResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Alpha Vantage browser BYOK boundary', () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;

  beforeAll(() => {
    const target = new EventTarget();
    Object.assign(target, {
      localStorage: new MemoryStorage(),
      location: new URL('https://investatlas.example/settings'),
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: target,
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    clearAlphaVantageSessionCredential();
    global.fetch = jest.fn(async () => providerResponse(dailyPayload()));
  });

  afterAll(() => {
    clearAlphaVantageSessionCredential();
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('supports only the reviewed USD stock and ETF allowlist', () => {
    expect(supportsAlphaVantageBrowserAsset('AAPL')).toBe(true);
    expect(supportsAlphaVantageBrowserAsset('SPUS')).toBe(true);
    expect(supportsAlphaVantageBrowserAsset('BTC')).toBe(false);
    expect(supportsAlphaVantageBrowserAsset('GOLD')).toBe(false);
    expect(supportsAlphaVantageBrowserAsset('IVSI')).toBe(false);
  });

  it('keeps the key in module memory and sends it only to the fixed provider host', async () => {
    const apiKey = 'personal-secret-key';
    setAlphaVantageSessionCredential('user-a', apiKey);

    const series = await loadAlphaVantageDailySeries('user-a', 'AAPL');

    expect(series).toMatchObject({
      providerId: 'alpha_vantage_browser_byok',
      assetSymbol: 'AAPL',
      listingCurrency: 'USD',
      cacheStatus: 'miss',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = (global.fetch as jest.Mock).mock.calls[0] as [URL, RequestInit];
    const url = new URL(input.toString());
    expect(url.origin).toBe('https://www.alphavantage.co');
    expect(url.pathname).toBe('/query');
    expect(url.searchParams.get('function')).toBe('TIME_SERIES_DAILY');
    expect(url.searchParams.get('symbol')).toBe('AAPL');
    expect(url.searchParams.get('apikey')).toBe(apiKey);
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const persistedEntries = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index)!;
      return [key, window.localStorage.getItem(key)];
    });
    expect(persistedEntries.length).toBeGreaterThan(0);
    expect(JSON.stringify(persistedEntries)).not.toContain(apiKey);
    expect(JSON.stringify(persistedEntries)).not.toContain('apikey=');
    expect([...Array(window.localStorage.length)].map((_, index) =>
      window.localStorage.key(index))).toEqual(expect.arrayContaining([
      expect.stringContaining('investatlas.alpha-vantage.normalized-market.v1.AAPL::user::user-a'),
    ]));
  });

  it('isolates normalized cache and credentials by Firebase UID', async () => {
    setAlphaVantageSessionCredential('user-a', 'key-a');
    await loadAlphaVantageDailySeries('user-a', 'AAPL');

    expect(getAlphaVantageCachedSymbols('user-a')).toContain('AAPL');
    expect(getAlphaVantageCachedSymbols('user-b')).not.toContain('AAPL');
    await expect(loadAlphaVantageDailySeries('user-b', 'AAPL')).rejects.toMatchObject({
      status: 'capability_unavailable',
    });

    reconcileAlphaVantageCredentialOwner('user-b');
    expect(hasAlphaVantageSessionCredential('user-a')).toBe(false);
  });

  it('does not clear a valid session connection when a replacement key is malformed', () => {
    setAlphaVantageSessionCredential('user-a', 'valid-key');

    expect(() => setAlphaVantageSessionCredential('user-a', 'bad\nkey')).toThrow(
      AlphaVantageBrowserError,
    );
    expect(hasAlphaVantageSessionCredential('user-a')).toBe(true);
  });

  it('rejects a mismatched symbol response without caching it', async () => {
    global.fetch = jest.fn(async () => providerResponse(dailyPayload('MSFT')));
    setAlphaVantageSessionCredential('user-mismatch', 'key');

    await expect(loadAlphaVantageDailySeries('user-mismatch', 'AAPL'))
      .rejects.toMatchObject({ status: 'unexpected_response' });
    expect(getAlphaVantageCachedSymbols('user-mismatch')).toEqual([]);
  });

  it('rejects extreme provider prices before they can enter a valuation', async () => {
    const payload = dailyPayload();
    const rows = payload['Time Series (Daily)'] as Record<string, Record<string, string>>;
    Object.values(rows)[0]['4. close'] = '1e308';
    global.fetch = jest.fn(async () => providerResponse(payload));
    setAlphaVantageSessionCredential('user-extreme', 'key');

    await expect(loadAlphaVantageDailySeries('user-extreme', 'AAPL'))
      .rejects.toMatchObject({ status: 'unexpected_response' });
    expect(getAlphaVantageCachedSymbols('user-extreme')).toEqual([]);
  });

  it('maps provider quota errors and never fabricates data', async () => {
    global.fetch = jest.fn(async () => providerResponse({
      Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.',
    }));
    setAlphaVantageSessionCredential('user-quota', 'key');

    await expect(loadAlphaVantageDailySeries('user-quota', 'AAPL'))
      .rejects.toEqual(expect.objectContaining({
        name: 'AlphaVantageBrowserError',
        status: 'quota_exhausted',
      }));
  });

  it('deduplicates same-user same-symbol provider requests', async () => {
    let resolveFetch!: (response: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    setAlphaVantageSessionCredential('user-dedupe', 'key');

    const first = loadAlphaVantageDailySeries('user-dedupe', 'AAPL');
    const second = loadAlphaVantageDailySeries('user-dedupe', 'AAPL');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    resolveFetch(providerResponse(dailyPayload()));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('aborts in-flight work and rejects late writes when the account changes', async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    setAlphaVantageSessionCredential('user-race', 'key');

    const pending = loadAlphaVantageDailySeries('user-race', 'AAPL');
    reconcileAlphaVantageCredentialOwner('other-user');

    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(AlphaVantageBrowserError);
    expect(getAlphaVantageCachedSymbols('user-race')).toEqual([]);
  });

  it('aborts a credential test when its owner changes before connection completes', async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const pending = testAlphaVantageCredential('test-owner', 'key');
    reconcileAlphaVantageCredentialOwner('other-user');

    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(AlphaVantageBrowserError);
    expect(getAlphaVantageCachedSymbols('test-owner')).toEqual([]);
    expect(hasAlphaVantageSessionCredential('test-owner')).toBe(false);
  });
});
