import {
  clearPublicCryptoSpotCache,
  fetchPublicCryptoSpot,
  normalizePublicCryptoSpot,
} from '@/lib/financial-data/providers/public-crypto-spot';

describe('free keyless BTC/ETH spot trust boundary', () => {
  const originalFetch = global.fetch;
  const now = Date.parse('2026-10-27T12:00:00.000Z');
  const sample = (symbol: 'BTC' | 'ETH') => ({
    symbol, currency: 'USD', price: symbol === 'BTC' ? 100_000 : 4_000,
    updatedAt: new Date(now - 50_000).toISOString(),
  });
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    clearPublicCryptoSpotCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    clearPublicCryptoSpotCache();
  });

  it('validates exact crypto/USD unit, source currency, timestamp and positive finite values', () => {
    expect(normalizePublicCryptoSpot('BTC', sample('BTC'), now)).toMatchObject({
      symbol: 'BTC', priceUsdPerCoin: 100_000,
    });
    for (const change of [
      { symbol: 'XAU' }, { symbol: 'ETH' }, { currency: 'EUR' }, { price: -1 },
      { price: null }, { price: Infinity }, { price: NaN }, { price: 1e12 },
      { updatedAt: '2026-10-25T00:00:00Z' },
      { updatedAt: 'unknown' }, { updatedAt: new Date(now + 3_600_000).toISOString() },
    ]) {
      expect(normalizePublicCryptoSpot('BTC', { ...sample('BTC'), ...change }, now)).toBeNull();
    }
    expect(normalizePublicCryptoSpot('ETH', sample('ETH'), now)?.symbol).toBe('ETH');
  });

  it('only calls exact allowlisted hosts with no personal credentials and caches per asset for 30s', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const symbol = String(url).endsWith('/BTC') ? 'BTC' : 'ETH';
      return new Response(JSON.stringify(sample(symbol)), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    expect((await fetchPublicCryptoSpot('BTC'))?.priceUsdPerCoin).toBe(100_000);
    expect((await fetchPublicCryptoSpot('ETH'))?.priceUsdPerCoin).toBe(4_000);
    expect((await fetchPublicCryptoSpot('BTC'))?.priceUsdPerCoin).toBe(100_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.gold-api.com/price/BTC');
    expect(url).not.toContain('?');
    expect(init).toMatchObject({
      method: 'GET', credentials: 'omit', mode: 'cors', redirect: 'error',
      referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    jest.setSystemTime(now + 31_000);
    await fetchPublicCryptoSpot('BTC');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('fails closed for stale, malformed, HTML, oversized and unauthorized endpoints', async () => {
    expect(await fetchPublicCryptoSpot('DOGE' as 'BTC')).toBeNull();
    global.fetch = jest.fn(async () => new Response('<html/>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }));
    expect(await fetchPublicCryptoSpot('BTC')).toBeNull();
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...sample('BTC'), price: '90000' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await fetchPublicCryptoSpot('BTC')).toBeNull();
    global.fetch = jest.fn(async () => new Response('x'.repeat(8500), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await fetchPublicCryptoSpot('BTC')).toBeNull();
    global.fetch = jest.fn(async () => new Response(JSON.stringify(sample('BTC')), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await fetchPublicCryptoSpot('BTC')).toBeNull();
  });

  it('does not issue a provider request if the owner aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn();
    await expect(fetchPublicCryptoSpot('BTC', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
