import {
  createCurrentQuoteRequestCoordinator,
  fetchCurrentQuoteBatches,
  shouldRefreshCurrentQuotes,
  type CurrentQuoteBatchResult,
} from '@/lib/financial-data/quotes/client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function quoteResult(symbol: string): CurrentQuoteBatchResult {
  return {
    status: 'complete',
    prices: { [symbol]: { price: 100 } as CurrentQuoteBatchResult['prices'][string] },
    timestamp: '2026-08-14T12:00:00.000Z',
    failedSymbols: [],
    refreshPolicy: 'poll_when_visible',
  };
}

function symbols(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `ASSET${index + 1}`);
}

describe('current quote client batching', () => {
  it('chunks more than 25 unique assets without dropping values', async () => {
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://investatlas.example');
      const requested = url.searchParams.get('symbols')?.split(',') ?? [];
      return Response.json({
        status: 'complete',
        prices: Object.fromEntries(
          requested.map((symbol, index) => [symbol, { price: index + 1 }]),
        ),
        timestamp: '2026-07-31T12:00:00.000Z',
      });
    });

    const result = await fetchCurrentQuoteBatches(
      symbols(52),
      'eur',
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(([input]) =>
        new URL(String(input), 'https://investatlas.example')
          .searchParams.get('symbols')
          ?.split(',').length
      ),
    ).toEqual([25, 25, 2]);
    expect(Object.keys(result.prices)).toHaveLength(52);
    expect(result.status).toBe('complete');
  });

  it('deduplicates and canonicalizes symbols before requesting them', async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL) => Response.json({
      status: 'complete',
      prices: { BTC: { price: 100 }, ETH: { price: 200 } },
      timestamp: '2026-07-31T12:00:00.000Z',
    }));

    await fetchCurrentQuoteBatches(
      [' btc ', 'BTC', 'eth'],
      'usd',
      fetcher,
    );

    const url = new URL(String(fetcher.mock.calls[0][0]), 'https://investatlas.example');
    expect(url.searchParams.get('symbols')).toBe('BTC,ETH');
    expect(url.searchParams.get('currency')).toBe('usd');
  });

  it('keeps successful batches and reports a partial result when one batch fails', async () => {
    let call = 0;
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      call += 1;
      if (call === 2) {
        return Response.json({ error: 'temporary' }, { status: 502 });
      }
      const url = new URL(String(input), 'https://investatlas.example');
      const requested = url.searchParams.get('symbols')?.split(',') ?? [];
      return Response.json({
        status: 'complete',
        prices: Object.fromEntries(requested.map((symbol) => [symbol, { price: 1 }])),
        timestamp: '2026-07-31T12:00:00.000Z',
      });
    });

    const result = await fetchCurrentQuoteBatches(
      symbols(30),
      'eur',
      fetcher,
    );

    expect(Object.keys(result.prices)).toHaveLength(25);
    expect(result.status).toBe('partial');
    expect(result.failedSymbols).toEqual(symbols(30).slice(25));
  });

  it('does not expose a stale sourced price to watchlists or other client consumers', async () => {
    const fetcher = jest.fn(async () => Response.json({
      status: 'complete',
      prices: {
        AAPL: {
          price: 100,
          fields: {
            price: {
              status: 'available',
              freshness: 'stale',
              value: { amount: 100, currency: 'EUR' },
            },
          },
        },
      },
      timestamp: '2026-07-31T12:00:00.000Z',
    }));

    const result = await fetchCurrentQuoteBatches(['AAPL'], 'eur', fetcher);

    expect(result.prices).toEqual({});
    expect(result.failedSymbols).toEqual(['AAPL']);
    expect(result.status).toBe('unavailable');
  });

  it('propagates a manual-only route policy to polling consumers', async () => {
    const fetcher = jest.fn(async () => Response.json({
      status: 'unavailable',
      prices: {},
      timestamp: '2026-07-31T12:00:00.000Z',
      refreshPolicy: 'manual_only',
    }));

    const result = await fetchCurrentQuoteBatches(['AAPL'], 'eur', fetcher);

    expect(result.refreshPolicy).toBe('manual_only');
    expect(shouldRefreshCurrentQuotes(result.refreshPolicy, 'visible')).toBe(false);
  });

  it('allows retry only while the page is visible and the route is refreshable or unknown', () => {
    expect(shouldRefreshCurrentQuotes('poll_when_visible', 'visible')).toBe(true);
    expect(shouldRefreshCurrentQuotes('unknown', 'visible')).toBe(true);
    expect(shouldRefreshCurrentQuotes('poll_when_visible', 'hidden')).toBe(false);
    expect(shouldRefreshCurrentQuotes('manual_only', 'visible')).toBe(false);
  });

  it('aborts and ignores stale completion when newer quote inputs start', async () => {
    const coordinator = createCurrentQuoteRequestCoordinator();
    const first = deferred<CurrentQuoteBatchResult>();
    const second = deferred<CurrentQuoteBatchResult>();
    let firstSignal: AbortSignal | undefined;
    const applied: string[] = [];

    const firstRun = coordinator.run('eur:A', (signal) => {
      firstSignal = signal;
      return first.promise;
    }).then((outcome) => {
      if (outcome.status === 'current') applied.push('A');
      return outcome;
    });
    const secondRequest = jest.fn(() => second.promise);
    const secondRun = coordinator.run('eur:B', secondRequest).then((outcome) => {
      if (outcome.status === 'current') applied.push('B');
      return outcome;
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(secondRequest).toHaveBeenCalledTimes(1);

    second.resolve(quoteResult('B'));
    await expect(secondRun).resolves.toEqual(expect.objectContaining({ status: 'current' }));
    first.resolve(quoteResult('A'));
    await expect(firstRun).resolves.toEqual({ status: 'stale' });
    expect(applied).toEqual(['B']);
  });

  it('turns a rejected superseded request into a stale outcome', async () => {
    const coordinator = createCurrentQuoteRequestCoordinator();
    const first = deferred<CurrentQuoteBatchResult>();
    const second = deferred<CurrentQuoteBatchResult>();
    const firstRun = coordinator.run('eur:A', () => first.promise);
    const secondRun = coordinator.run('eur:B', () => second.promise);

    first.reject(new Error('old provider failure'));
    await expect(firstRun).resolves.toEqual({ status: 'stale' });
    second.resolve(quoteResult('B'));
    await expect(secondRun).resolves.toEqual(expect.objectContaining({ status: 'current' }));
  });

  it('invalidates an old request when the latest state needs only its local fallback', async () => {
    const coordinator = createCurrentQuoteRequestCoordinator();
    const pending = deferred<CurrentQuoteBatchResult>();
    let signal: AbortSignal | undefined;
    const oldRun = coordinator.run('eur:A', (requestSignal) => {
      signal = requestSignal;
      return pending.promise;
    });

    coordinator.cancel();
    expect(signal?.aborted).toBe(true);

    pending.resolve(quoteResult('A'));
    await expect(oldRun).resolves.toEqual({ status: 'stale' });
  });

  it('deduplicates overlapping periodic requests for the same quote inputs', async () => {
    const coordinator = createCurrentQuoteRequestCoordinator();
    const pending = deferred<CurrentQuoteBatchResult>();
    const request = jest.fn(() => pending.promise);

    const firstRun = coordinator.run('eur:A', request);
    const overlappingRun = coordinator.run('eur:A', request);

    expect(overlappingRun).toBe(firstRun);
    expect(request).toHaveBeenCalledTimes(1);

    pending.resolve(quoteResult('A'));
    await expect(firstRun).resolves.toEqual(expect.objectContaining({ status: 'current' }));
  });
});
