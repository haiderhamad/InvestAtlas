import {
  clearCoinPaprikaSpotCache, fetchPublicCoinPaprikaSpot, parseCoinPaprikaSpot,
  supportsPublicCoinPaprikaAsset,
} from '@/lib/financial-data/providers/public-coinpaprika-spot';

const catalogIds: Record<string, string> = {
  BTC: 'btc-bitcoin', ETH: 'eth-ethereum', SOL: 'sol-solana', XRP: 'xrp-xrp',
  ADA: 'ada-cardano', DOT: 'dot-polkadot', LINK: 'link-chainlink', AVAX: 'avax-avalanche',
  MATIC: 'matic-polygon', ATOM: 'atom-cosmos', NEAR: 'near-near-protocol', SUI: 'sui-sui',
  INJ: 'inj-injective-protocol', RENDER: 'rndr-render-token', FET: 'fetch-ai', TAO: 'tao-bittensor',
  ARB: 'arb-arbitrum', OP: 'op-optimism', TIA: 'tia-celestia', SEI: 'sei-sei', APT: 'apt-aptos',
  ICP: 'icp-internet-computer', FIL: 'fil-filecoin', LTC: 'ltc-litecoin', IMX: 'imx-immutable-x',
  XLM: 'xlm-stellar', HBAR: 'hbar-hedera-hashgraph',
};
const parseSpot = parseCoinPaprikaSpot;
const fetchSpot = fetchPublicCoinPaprikaSpot;

describe('fixed public CoinPaprika catalog adapter', () => {
  let now: number;
  let testIndex = 0;
  const sample = (symbol = 'BTC') => ({
    id: catalogIds[symbol], symbol, last_updated: new Date(now - 45_000).toISOString(),
    quotes: { USD: { price: symbol === 'BTC' ? 72000.25 : 12.5 } },
  });
  const previous = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    now = Date.parse('2026-11-07T20:00:00.000Z') + testIndex++ * 24 * 60 * 60_000;
    jest.setSystemTime(now);
    clearCoinPaprikaSpotCache();
  });
  afterEach(() => { clearCoinPaprikaSpotCache(); global.fetch = previous; jest.useRealTimers(); });

  it('validates the exact symbol, USD price and observed freshness', () => {
    expect(parseSpot('BTC', sample(), now)).toMatchObject({
      providerId: 'coinpaprika_public', symbol: 'BTC', priceUsdPerCoin: 72000.25,
    });
    expect(parseSpot('ETH', sample(), now)).toBeNull();
    for (const change of [
      { quotes: { USD: { price: '72000.25' } } }, { quotes: { EUR: { price: 72000 } } },
      { quotes: { USD: { price: -1 } } }, { quotes: { USD: { price: Infinity } } },
      { quotes: { USD: { price: 1e10 } } }, { last_updated: '2020-01-01T00:00:00.000Z' },
      { last_updated: new Date(now + 6 * 60_000).toISOString() }, { last_updated: 'today' },
    ]) expect(parseSpot('BTC', { ...sample(), ...change }, now)).toBeNull();
  });

  it('accepts all 27 exact catalog identities and rejects renamed or unknown symbols', () => {
    const supports = supportsPublicCoinPaprikaAsset;
    for (const symbol of Object.keys(catalogIds)) {
      expect(supports(symbol)).toBe(true);
      expect(parseSpot(symbol, sample(symbol), now)).toMatchObject({ symbol, priceUsdPerCoin: symbol === 'BTC' ? 72000.25 : 12.5 });
    }
    for (const symbol of ['POL', 'RNDR', 'DOGE', 'btc', '__proto__', 'constructor', '']) {
      expect(supports(symbol)).toBe(false);
      expect(parseSpot(symbol, sample('BTC'), now)).toBeNull();
    }
    expect(parseSpot('MATIC', { ...sample('MATIC'), id: 'pol-polygon-ecosystem-token' }, now)).toBeNull();
    expect(parseSpot('MATIC', { ...sample('MATIC'), symbol: 'POL' }, now)).toBeNull();
    expect(parseSpot('RENDER', { ...sample('RENDER'), symbol: 'RNDR' }, now)).toBeNull();
  });

  it('rejects impossible calendar dates rather than silently normalizing them', () => {
    expect(parseSpot('BTC', { ...sample(), last_updated: '2026-02-30T20:00:00.000Z' },
      Date.parse('2026-03-02T20:00:00.000Z'))).toBeNull();
  });

  it('uses one fixed unauthenticated bulk request for concurrent catalog callers', async () => {
    global.fetch = jest.fn(async () => Response.json(Object.keys(catalogIds).map(symbol => sample(symbol))));
    const quotes = await Promise.all(Object.keys(catalogIds).map(symbol => fetchSpot(symbol)));
    expect(quotes).toHaveLength(27);
    expect(quotes.every((quote, index) => quote?.symbol === Object.keys(catalogIds)[index])).toBe(true);
    const first = quotes[0];
    const second = await fetchSpot('BTC');
    expect(first?.providerId).toBe('coinpaprika_public');
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://api.coinpaprika.com/v1/tickers?quotes=USD');
    expect(init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('keeps a compact bulk snapshot for 15 minutes and refreshes it only after expiry', async () => {
    global.fetch = jest.fn(async () => Response.json([sample(), sample('SOL')]));
    expect((await fetchSpot('BTC'))?.priceUsdPerCoin).toBe(72000.25);
    jest.setSystemTime(now + 14 * 60_000);
    expect((await fetchSpot('SOL'))?.symbol).toBe('SOL');
    expect(await fetchSpot('ADA')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.setSystemTime(now + 15 * 60_000 + 1);
    expect((await fetchSpot('BTC'))?.symbol).toBe('BTC');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('never returns an observation older than 30 minutes even while the bulk cache is fresh', async () => {
    global.fetch = jest.fn(async () => Response.json([{ ...sample(), last_updated: new Date(now - 29 * 60_000).toISOString() }]));
    expect(await fetchSpot('BTC')).not.toBeNull();
    jest.setSystemTime(now + 2 * 60_000);
    expect(await fetchSpot('BTC')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('quarantines duplicate exact IDs without suppressing unrelated valid coins', async () => {
    global.fetch = jest.fn(async () => Response.json([
      sample('MATIC'), { ...sample('MATIC'), symbol: 'POL' }, sample('MATIC'),
      sample('RENDER'), { ...sample('RENDER'), quotes: {} }, sample('SOL'),
      { ...sample('MATIC'), id: 'pol-polygon-ecosystem-token', symbol: 'POL' },
    ]));
    expect(await fetchSpot('MATIC')).toBeNull();
    expect(await fetchSpot('RENDER')).toBeNull();
    expect((await fetchSpot('SOL'))?.priceUsdPerCoin).toBe(12.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts a realistic 2.7 MB bulk response while retaining only supported identities', async () => {
    global.fetch = jest.fn(async () => Response.json([
      { id: 'not-a-supported-coin', symbol: 'BTC', extra: 'x'.repeat(2_700_000) }, sample(),
    ]));
    expect((await fetchSpot('BTC'))?.priceUsdPerCoin).toBe(72000.25);
    expect(await fetchSpot('ETH')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized declared body before consuming its stream', async () => {
    const cancel = jest.fn();
    global.fetch = jest.fn(async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json', 'content-length': '4194305' },
    }));
    expect(await fetchSpot('BTC')).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it('bounds streamed bytes when content length is absent and cancels the reader on overflow', async () => {
    const cancel = jest.fn();
    let chunksRead = 0;
    global.fetch = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        if (chunksRead <= 6) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
      }, cancel,
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json' } }));
    expect(await fetchSpot('BTC')).toBeNull();
    expect(chunksRead).toBe(5);
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects unsupported and pre-aborted callers without any network request', async () => {
    global.fetch = jest.fn();
    expect(await fetchSpot('POL')).toBeNull();
    const controller = new AbortController(); controller.abort();
    await expect(fetchSpot('BTC', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('cancels one subscriber promptly without aborting the shared request for another', async () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = jest.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const controller = new AbortController();
    const first = fetchSpot('BTC', controller.signal);
    const second = fetchSpot('SOL');
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(jest.mocked(global.fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    resolveFetch(Response.json([sample(), sample('SOL')]));
    expect((await second)?.symbol).toBe('SOL');
    expect((await fetchSpot('BTC'))?.priceUsdPerCoin).toBe(72000.25);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not release or cache a late result after every subscriber cancels', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    global.fetch = jest.fn(() => new Promise(resolve => { resolvers.push(resolve); }));
    const controller = new AbortController();
    const pending = fetchSpot('BTC', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    const replacement = fetchSpot('BTC');
    resolvers[1](Response.json([{ ...sample(), quotes: { USD: { price: 42 } } }]));
    expect((await replacement)?.priceUsdPerCoin).toBe(42);
    resolvers[0](Response.json([sample()]));
    await Promise.resolve(); await Promise.resolve();
    expect((await fetchSpot('BTC'))?.priceUsdPerCoin).toBe(42);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('clears pending work without releasing or caching a late transport result', async () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = jest.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const pending = fetchSpot('SOL');
    clearCoinPaprikaSpotCache();
    expect(await pending).toBeNull();
    resolveFetch(Response.json([sample('SOL')]));
    await Promise.resolve(); await Promise.resolve();
    global.fetch = jest.fn(async () => Response.json([{ ...sample('SOL'), quotes: { USD: { price: 42 } } }]));
    expect((await fetchSpot('SOL'))?.priceUsdPerCoin).toBe(42);
  });

  it('never caches data from a response stream that aborts', async () => {
    global.fetch = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new DOMException('Aborted', 'AbortError')); },
    }), { headers: { 'content-type': 'application/json' } }));
    expect(await fetchSpot('BTC')).toBeNull();
    clearCoinPaprikaSpotCache();
    jest.setSystemTime(now + 61_000);
    global.fetch = jest.fn(async () => Response.json([sample()]));
    expect((await fetchSpot('BTC'))?.priceUsdPerCoin).toBe(72000.25);
  });

  it('settles a provider timeout even if fetch ignores AbortSignal and discards the late response', async () => {
    let resolveFetch!: (value: Response) => void;
    global.fetch = jest.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const pending = fetchSpot('BTC');
    await jest.advanceTimersByTimeAsync(8_001);
    expect(await pending).toBeNull();
    resolveFetch(Response.json([sample()]));
    await Promise.resolve(); await Promise.resolve();
    expect(await fetchSpot('BTC')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses finite failure cooldowns instead of retrying each fallback caller', async () => {
    global.fetch = jest.fn(() => { throw new Error('network failure'); });
    expect(await fetchSpot('BTC')).toBeNull();
    expect(await fetchSpot('ETH')).toBeNull();
    expect(await fetchSpot('SOL')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.setSystemTime(now + 61_000);
    global.fetch = jest.fn(async () => Response.json([sample('SOL')]));
    expect((await fetchSpot('SOL'))?.symbol).toBe('SOL');
  });

  it.each(['seconds', 'http-date'])(
    'preserves HTTP 429 Retry-After %s across cache teardown', async format => {
      const retryAfter = format === 'seconds' ? '1800' : new Date(now + 1_800_000).toUTCString();
      global.fetch = jest.fn(async () => Response.json({ error: 'quota exhausted' }, {
        status: 429, headers: { 'Retry-After': retryAfter },
      }));
      expect(await fetchSpot('BTC')).toBeNull();
      clearCoinPaprikaSpotCache();
      jest.setSystemTime(now + 16 * 60_000);
      expect(await fetchSpot('ETH')).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const retryAt = now + 1_800_001;
      jest.setSystemTime(retryAt);
      global.fetch = jest.fn(async () => Response.json([{
        ...sample('ETH'), last_updated: new Date(retryAt - 1_000).toISOString(),
      }]));
      expect((await fetchSpot('ETH'))?.symbol).toBe('ETH');
    },
  );

  it('fails closed on non-array JSON, wrong content type and malformed JSON without rapid retries', async () => {
    const responses = [Response.json(sample()), new Response('<html>blocked</html>'),
      new Response('{broken', { headers: { 'content-type': 'application/json' } })];
    global.fetch = jest.fn(async () => responses.shift()!);
    for (let index = 0; index < 3; index++) {
      jest.setSystemTime(now + index * 61_000);
      expect(await fetchSpot('BTC')).toBeNull();
      expect(await fetchSpot('ETH')).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(index + 1);
    }
  });
});
