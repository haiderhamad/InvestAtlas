import { fetchTiingoDailyPrices } from '@/lib/financial-data/providers/tiingo';

const caller = {
  apiKey: 'SYNTHETIC_TEST_ONLY',
  healthKey: 'compatibility-fixture-user',
  symbol: 'AAPL',
  startDate: '2026-10-20',
  endDate: '2026-10-26',
};
const price = [{
  date: '2026-10-23T00:00:00.000Z',
  open: 100, high: 105, low: 99, close: 104, volume: 1000,
}];

describe('Tiingo browser abort compatibility', () => {
  const originalFetch = global.fetch;
  const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  beforeEach(() => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
  });
  afterEach(() => {
    if (any) Object.defineProperty(AbortSignal, 'any', any);
    else Reflect.deleteProperty(AbortSignal, 'any');
    if (timeout) Object.defineProperty(AbortSignal, 'timeout', timeout);
    else Reflect.deleteProperty(AbortSignal, 'timeout');
    global.fetch = originalFetch;
  });

  it('reads EOD data on browsers without AbortSignal.any and AbortSignal.timeout', async () => {
    global.fetch = jest.fn(async () => Response.json(price));
    const controller = new AbortController();
    await expect(fetchTiingoDailyPrices({ ...caller, signal: controller.signal }))
      .resolves.toMatchObject(price);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the six-second network deadline without modern AbortSignal helpers', async () => {
    jest.useFakeTimers();
    try {
      let providerSignal: AbortSignal | undefined;
      global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        providerSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener('abort', () => {
            reject(new DOMException('Timeout', 'AbortError'));
          }, { once: true });
        });
      });
      const pending = fetchTiingoDailyPrices({
        ...caller, healthKey: 'compatibility-timeout-fixture-user',
      });
      const rejected = expect(pending).rejects.toMatchObject({ status: 'provider_unavailable' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(6_000);
      expect(providerSignal?.aborted).toBe(true);
      await rejected;
    } finally {
      jest.useRealTimers();
    }
  });

  it('propagates caller cancellation without modern AbortSignal helpers', async () => {
    let forwarded: AbortSignal | undefined;
    global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      forwarded = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        forwarded?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    });
    const controller = new AbortController();
    const pending = fetchTiingoDailyPrices({
      ...caller, healthKey: 'compatibility-aborted-fixture-user', signal: controller.signal,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(forwarded?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ status: 'provider_unavailable' });
  });
});
