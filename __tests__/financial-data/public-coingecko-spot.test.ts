import { SUPPORTED_COINS } from '@/lib/config/supported-coins';
import {
  COINGECKO_PERSONAL_IDS, clearCoinGeckoSpotCache, fetchPublicCoinGeckoSpot,
  parseCoinGeckoSpot, supportsPublicCoinGeckoAsset,
} from '@/lib/financial-data/providers/public-coingecko-spot';

const now = Date.parse('2026-11-07T12:00:00Z');
const sample = { usd: 72000.25, last_updated_at: Math.floor((now - 45_000) / 1000) };
const previousFetch = global.fetch;
beforeEach(() => { jest.useFakeTimers({ now }); clearCoinGeckoSpotCache(); });
afterEach(() => { jest.advanceTimersByTime(24 * 60 * 60_000); clearCoinGeckoSpotCache(); global.fetch = previousFetch; jest.useRealTimers(); });

test('maps exactly the existing crypto catalog, without substituting POL for MATIC or tokens for metal', () => {
  expect(Object.keys(COINGECKO_PERSONAL_IDS).sort()).toEqual(SUPPORTED_COINS.map(c => c.symbol).sort());
  expect(new Set(Object.values(COINGECKO_PERSONAL_IDS)).size).toBe(27);
  expect(COINGECKO_PERSONAL_IDS.MATIC).toBe('matic-network');
  expect(COINGECKO_PERSONAL_IDS.RENDER).toBe('render-token');
  expect(supportsPublicCoinGeckoAsset('SILVER')).toBe(false);
  expect(supportsPublicCoinGeckoAsset('GOLD')).toBe(false);
  expect(supportsPublicCoinGeckoAsset('POL')).toBe(false);
  expect(supportsPublicCoinGeckoAsset('toString')).toBe(false);
});

test('accepts only the exact ID with positive numeric USD and actual fresh Unix observation time', () => {
  expect(parseCoinGeckoSpot('BTC', { bitcoin: sample }, now)).toMatchObject({
    symbol: 'BTC', providerId: 'coingecko_public', priceUsdPerCoin: 72000.25,
    observedAt: '2026-11-07T11:59:15.000Z',
  });
  for (const data of [
    { ethereum: sample }, { bitcoin: { ...sample, usd: '72000' } },
    { bitcoin: { ...sample, usd: 0 } }, { bitcoin: { ...sample, last_updated_at: undefined } },
    { bitcoin: { ...sample, last_updated_at: now } },
    { bitcoin: { ...sample, last_updated_at: (now + 6 * 60_000) / 1000 } },
  ]) expect(parseCoinGeckoSpot('BTC', data, now)).toBeNull();
  expect(parseCoinGeckoSpot('MATIC', { 'matic-network': { ...sample, last_updated_at: 1770083820 } }, now)).toBeNull();
  expect(parseCoinGeckoSpot('MATIC', { 'polygon-ecosystem-token': sample }, now)).toBeNull();
});

test('loads all requested coins once using a fixed, keyless, credential-free batch and caches missing rows too', async () => {
  global.fetch = jest.fn(async () => Response.json({ bitcoin: sample, solana: { ...sample, usd: 140 } }));
  const results = await Promise.all([fetchPublicCoinGeckoSpot('BTC'), fetchPublicCoinGeckoSpot('SOL')]);
  expect(results.map(r => r?.priceUsdPerCoin)).toEqual([72000.25, 140]);
  expect(await fetchPublicCoinGeckoSpot('BTC')).toEqual(results[0]);
  expect(await fetchPublicCoinGeckoSpot('MATIC')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [input, init] = jest.mocked(global.fetch).mock.calls[0];
  const url = new URL(String(input));
  expect(url.origin + url.pathname).toBe('https://api.coingecko.com/api/v3/simple/price');
  expect(url.searchParams.get('include_last_updated_at')).toBe('true');
  expect(url.searchParams.get('vs_currencies')).toBe('usd');
  expect(url.searchParams.get('ids')?.split(',').sort()).toEqual(Object.values(COINGECKO_PERSONAL_IDS).sort());
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  expect(new Headers(init?.headers).has('authorization')).toBe(false);
});

test('does not send unsupported or already cancelled requests', async () => {
  global.fetch = jest.fn();
  expect(await fetchPublicCoinGeckoSpot('GOLD')).toBeNull();
  const controller = new AbortController(); controller.abort();
  await expect(fetchPublicCoinGeckoSpot('BTC', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('one cancelled subscriber does not cancel another caller or release its data to the cancelled caller', async () => {
  let finish!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const first = fetchPublicCoinGeckoSpot('BTC', controller.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = fetchPublicCoinGeckoSpot('SOL');
  controller.abort();
  finish(Response.json({ bitcoin: sample, solana: { ...sample, usd: 140 } }));
  await rejected;
  expect((await second)?.priceUsdPerCoin).toBe(140);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('provider rate limits are respected across coin fallbacks and cache clears', async () => {
  global.fetch = jest.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  expect(await fetchPublicCoinGeckoSpot('BTC')).toBeNull();
  clearCoinGeckoSpotCache();
  expect(await fetchPublicCoinGeckoSpot('SOL')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(120_001);
  expect(await fetchPublicCoinGeckoSpot('ETH')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('rejects overlarge declared and streamed bodies and stale cached observations', async () => {
  global.fetch = jest.fn(async () => Response.json({ bitcoin: sample }, { headers: { 'Content-Length': String(100_000) } }));
  expect(await fetchPublicCoinGeckoSpot('BTC')).toBeNull();
  clearCoinGeckoSpotCache(); jest.advanceTimersByTime(60_001);
  global.fetch = jest.fn(async () => new Response(' '.repeat(100_000), { headers: { 'Content-Type': 'application/json' } }));
  expect(await fetchPublicCoinGeckoSpot('BTC')).toBeNull();
  clearCoinGeckoSpotCache(); jest.advanceTimersByTime(60_001);
  global.fetch = jest.fn(async () => Response.json({ bitcoin: sample }));
  expect(await fetchPublicCoinGeckoSpot('BTC')).not.toBeNull();
  jest.advanceTimersByTime(31 * 60_000);
  expect(await fetchPublicCoinGeckoSpot('BTC')).toBeNull();
});

test('a backwards clock change cannot turn a cached future observation into a fresh quote', async () => {
  global.fetch = jest.fn(async () => Response.json({ bitcoin: sample }));
  expect(await fetchPublicCoinGeckoSpot('BTC')).not.toBeNull();
  jest.setSystemTime(now - 10 * 60_000);
  expect(await fetchPublicCoinGeckoSpot('BTC')).toBeNull();
});

test('the deadline releases callers even when a failed transport ignores abort', async () => {
  global.fetch = jest.fn(() => new Promise<Response>(() => {}));
  let settled = false;
  const request = fetchPublicCoinGeckoSpot('BTC').then(result => { settled = true; return result; });
  await jest.advanceTimersByTimeAsync(8_001);
  expect(settled).toBe(true);
  expect(await request).toBeNull();
});

test('cancelling the final subscriber does not turn ordinary navigation into a provider cooldown', async () => {
  global.fetch = jest.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const controller = new AbortController();
  const request = fetchPublicCoinGeckoSpot('SOL', controller.signal);
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  global.fetch = jest.fn(async () => Response.json({ solana: { ...sample, usd: 140 } }));
  expect((await fetchPublicCoinGeckoSpot('SOL'))?.priceUsdPerCoin).toBe(140);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
