import {
  clearPublicGoldSpotCache, fetchPublicGoldSpot, normalizePublicGoldSpot,
  fetchPublicMetalSpot, normalizePublicMetalSpot,
} from '@/lib/financial-data/providers/public-gold-spot';

describe('public XAU/USD spot trust boundary', () => {
  const previousFetch = global.fetch;
  let now: number;
  let testIndex = 0;
  const sample = () => ({
    symbol: 'XAU', currency: 'USD', price: 4134.25,
    updatedAt: new Date(now - 60_000).toISOString(),
  });
  beforeEach(() => {
    jest.useFakeTimers();
    now = Date.parse('2026-10-27T12:00:00.000Z') + testIndex++ * 24 * 60 * 60_000;
    jest.setSystemTime(now);
    clearPublicGoldSpotCache();
  });
  afterEach(() => { global.fetch = previousFetch; jest.useRealTimers(); clearPublicGoldSpotCache(); });

  it('accepts only a recent, finite pure gold spot price in USD per troy ounce', () => {
    expect(normalizePublicGoldSpot(sample(), now)).toMatchObject({
      priceUsdPerTroyOunce: 4134.25,
      observedAt: sample().updatedAt,
    });
    for (const change of [
      { symbol: 'GOLD' }, { symbol: 'XAG' }, { currency: 'EUR' },
      { price: -1 }, { price: NaN }, { price: Infinity },
      { price: null }, { price: 99_999_999 },
      { updatedAt: '2026-10-20T10:00:00Z' },
      { updatedAt: new Date(now + 3600_000).toISOString() },
      { updatedAt: 'tomorrow' },
    ]) expect(normalizePublicGoldSpot({ ...sample(), ...change }, now)).toBeNull();
  });

  it('uses only exact public endpoint, omits user cookies, never sends a BYOK key', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify(sample()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const quote = await fetchPublicGoldSpot();
    expect(quote?.priceUsdPerTroyOunce).toBe(4134.25);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.gold-api.com/price/XAU');
    expect(url).not.toContain('key');
    expect(init).toMatchObject({
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer',
    });
    await fetchPublicGoldSpot();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.setSystemTime(now + 31_000);
    await fetchPublicGoldSpot();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed on HTML, malformed or overlong responses without caching', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html>blocked</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await fetchPublicGoldSpot()).toBeNull();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ ...sample(), symbol: 'BTC' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await fetchPublicGoldSpot()).toBeNull();
    global.fetch = jest.fn(async () =>
      new Response('x'.repeat(9000), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await fetchPublicGoldSpot()).toBeNull();
  });

  it('stops aborted calls without provider fallback or saved results', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn();
    await expect(fetchPublicGoldSpot(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('adds exact XAG/USD per-fine-troy-ounce coverage without changing the gold wrapper', async () => {
    global.fetch = jest.fn(async url => Response.json({
      ...sample(), symbol: String(url).endsWith('/XAG') ? 'XAG' : 'XAU', price: 49.25,
    }));
    expect(await fetchPublicMetalSpot('SILVER')).toMatchObject({ symbol: 'SILVER', priceUsdPerTroyOunce: 49.25 });
    expect(await fetchPublicMetalSpot('GOLD')).toMatchObject({ symbol: 'GOLD', priceUsdPerTroyOunce: 49.25 });
    expect((await fetchPublicGoldSpot())?.priceUsdPerTroyOunce).toBe(49.25);
    expect(jest.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://api.gold-api.com/price/XAG', 'https://api.gold-api.com/price/XAU',
    ]);
  });

  it('rejects mismatched metal identity, denomination, unit overrides and source time', () => {
    const silver = { ...sample(), symbol: 'XAG', price: 49.25 };
    expect(normalizePublicMetalSpot('SILVER', silver, now)).toMatchObject({ symbol: 'SILVER', priceUsdPerTroyOunce: 49.25 });
    for (const change of [
      { symbol: 'XAU' }, { symbol: 'SILVER' }, { symbol: 'PAXG' }, { currency: 'EUR' },
      { currency: undefined }, { unit: 'gram' }, { unit: 'kg' }, { price: 0 },
      { updatedAt: new Date(now - 91 * 60_000).toISOString() },
      { updatedAt: new Date(now + 6 * 60_000).toISOString() },
    ]) expect(normalizePublicMetalSpot('SILVER', { ...silver, ...change }, now)).toBeNull();
    expect(normalizePublicMetalSpot('GOLD', silver, now)).toBeNull();
  });

  it('rejects impossible calendar dates rather than silently normalizing them', () => {
    expect(normalizePublicGoldSpot({ ...sample(), updatedAt: '2026-02-30T20:00:00.000Z' },
      Date.parse('2026-03-02T20:00:00.000Z'))).toBeNull();
  });

  it('applies provider cooldowns to both metals and preserves Retry-After across cache teardown', async () => {
    global.fetch = jest.fn(async () => Response.json({ error: 'quota exhausted' }, {
      status: 429, headers: { 'retry-after': '120' },
    }));
    expect(await fetchPublicMetalSpot('SILVER')).toBeNull();
    clearPublicGoldSpotCache();
    jest.setSystemTime(now + 60_000);
    expect(await fetchPublicGoldSpot()).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.setSystemTime(now + 120_001);
    global.fetch = jest.fn(async () => Response.json(sample()));
    expect((await fetchPublicGoldSpot())?.priceUsdPerTroyOunce).toBe(4134.25);
  });

  it('rechecks future source time on a cached quote after the local clock changes', async () => {
    global.fetch = jest.fn(async () => Response.json(sample()));
    expect(await fetchPublicGoldSpot()).not.toBeNull();
    jest.setSystemTime(now - 10 * 60_000);
    expect(await fetchPublicGoldSpot()).toBeNull();
  });

  it('does not release or cache an ignored abort that occurs while reading the response', async () => {
    const controller = new AbortController();
    let resolveBody!: (result: ReadableStreamReadResult<Uint8Array>) => void;
    global.fetch = jest.fn(async () => ({
      ok: true, headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => ({ read: () => new Promise(resolve => { resolveBody = resolve; }), cancel: async () => undefined, releaseLock: () => undefined }) },
      text: async () => { controller.abort(); return JSON.stringify(sample()); },
    }) as unknown as Response);
    const pending = fetchPublicGoldSpot(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await rejected;
    resolveBody?.({ done: false, value: new TextEncoder().encode(JSON.stringify(sample())) });
    global.fetch = jest.fn(async () => Response.json({ ...sample(), price: 42 }));
    expect((await fetchPublicGoldSpot())?.priceUsdPerTroyOunce).toBe(42);
  });

  it('rejects an oversized stream before buffering it completely', async () => {
    let chunksRead = 0;
    const cancel = jest.fn();
    global.fetch = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        if (chunksRead <= 3) controller.enqueue(new Uint8Array(4_096));
        else controller.close();
      }, cancel,
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json' } }));
    expect(await fetchPublicGoldSpot()).toBeNull();
    expect(chunksRead).toBe(3);
    expect(cancel).toHaveBeenCalled();
  });
});
