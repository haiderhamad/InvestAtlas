import {
  MAX_PROVIDER_RESPONSE_BYTES,
  ProviderRequestValidationError,
  ProviderResponseTooLargeError,
  ProviderCooldownError,
  fetchProvider,
  getProviderHealthSnapshot,
} from '@/lib/data/provider-fetch';

describe('fetchProvider', () => {
  test('attaches a bounded abort signal to trusted provider requests', async () => {
    const response = new Response('{}', { status: 200 });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response);

    try {
      const result = await fetchProvider(
        'https://api.coingecko.com/api/v3/ping',
      );
      await expect(result.json()).resolves.toEqual({});
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/ping',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fetchSpy.mock.calls[0][1]?.redirect).toBe('error');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('allows the official ECB host used for the bounded history ZIP', async () => {
    const response = new Response('Date,USD\n2026-07-31,1.15');
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response);

    try {
      const result = await fetchProvider(
        'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.csv',
      );
      await expect(result.text()).resolves.toContain('Date,USD');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('rejects non-allowlisted destinations before making a request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    try {
      await expect(
        fetchProvider('http://127.0.0.1/internal'),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      await expect(
        fetchProvider('https://api.coingecko.com@example.test/data'),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      await expect(
        fetchProvider(
          'https://www.ecb.europa.eu.attacker.test/stats/eurofxref/eurofxref-hist.zip',
        ),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      await expect(
        fetchProvider(
          'https://api.binance.com/api/v3/ping',
          {},
          Number.POSITIVE_INFINITY,
        ),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('enforces the provider activation catalog at the network boundary', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    try {
      await expect(
        fetchProvider('https://api.coinbase.com/v2/prices/BTC-USD/spot'),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      await expect(
        fetchProvider('https://api.kraken.com/0/public/OHLC?pair=BTCEUR'),
      ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('blocks local-only providers before network access on Vercel Preview and Production', async () => {
    const originalEnvironment = process.env.VERCEL_ENV;
    const fetchSpy = jest.spyOn(global, 'fetch');

    try {
      for (const environment of ['preview', 'production']) {
        process.env.VERCEL_ENV = environment;
        await expect(
          fetchProvider('https://query1.finance.yahoo.com/v8/finance/chart/AAPL'),
        ).rejects.toBeInstanceOf(ProviderRequestValidationError);
        await expect(
          fetchProvider('https://api.binance.com/api/v3/ticker/price?symbol=BTCEUR'),
        ).rejects.toBeInstanceOf(ProviderRequestValidationError);
        await expect(
          fetchProvider('https://api-pub.bitfinex.com/v2/ticker/tBTCUSD'),
        ).rejects.toBeInstanceOf(ProviderRequestValidationError);
        await expect(
          fetchProvider('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur'),
        ).rejects.toBeInstanceOf(ProviderRequestValidationError);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (originalEnvironment === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = originalEnvironment;
      }
      fetchSpy.mockRestore();
    }
  });

  test('does not degrade provider health when the parent request is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    try {
      await expect(
        fetchProvider(
          'https://api.coingecko.com/api/v3/ping',
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(
        getProviderHealthSnapshot().find(
          (provider) => provider.host === 'api.binance.com',
        ),
      ).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('rejects a declared provider body above the hard size limit', async () => {
    const response = new Response('{}', {
      headers: {
        'Content-Length': String(MAX_PROVIDER_RESPONSE_BYTES + 1),
      },
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response);

    try {
      await expect(
        fetchProvider('https://api.coingecko.com/api/v3/ping'),
      ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('stops a chunked provider body that exceeds the hard size limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES),
        );
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(body),
    );

    try {
      const result = await fetchProvider(
        'https://api.coingecko.com/api/v3/ping',
      );
      await expect(result.arrayBuffer()).rejects.toBeInstanceOf(
        ProviderResponseTooLargeError,
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('honors a bounded upstream 429 cooldown before issuing another request', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { 'Retry-After': '10' },
      }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    try {
      const first = await fetchProvider(
        'https://data-api.ecb.europa.eu/service/data/EXR',
      );
      expect(first.status).toBe(429);
      await expect(
        fetchProvider('https://data-api.ecb.europa.eu/service/data/EXR'),
      ).rejects.toBeInstanceOf(ProviderCooldownError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getProviderHealthSnapshot()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          host: 'data-api.ecb.europa.eu',
          status: 'cooldown',
          retryAt: '2026-07-31T12:00:10.000Z',
        }),
      ]));

      jest.setSystemTime(new Date('2026-07-31T12:00:11.000Z'));
      const recovered = await fetchProvider(
        'https://data-api.ecb.europa.eu/service/data/EXR',
      );
      expect(recovered.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      fetchSpy.mockRestore();
    }
  });
});
