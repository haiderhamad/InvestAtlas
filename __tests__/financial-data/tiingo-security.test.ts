import {
  fetchTiingoDailyPrices,
  TiingoProviderError,
} from '@/lib/financial-data/providers/tiingo';

const API_KEY = 'valid_test_tiingo_token_123456';

function price(date: string, close = 100) {
  return {
    date,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1_000,
  };
}

describe('Tiingo BYOK request boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses a fixed HTTPS origin, blocks redirects, and never puts the key in the URL', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      Response.json([price('2026-08-08T00:00:00.000Z')]),
    );

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'owner-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).resolves.toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(
      /^https:\/\/api\.tiingo\.com\/tiingo\/daily\/AAPL\/prices\?/,
    );
    expect(String(url)).not.toContain(API_KEY);
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Token ${API_KEY}`,
    );
  });

  it('rejects path traversal and malformed key material before making a request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'owner-user:tiingo:1',
      symbol: '../AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toBeInstanceOf(TiingoProviderError);
    await expect(fetchTiingoDailyPrices({
      apiKey: 'bad\r\nInjected: value',
      healthKey: 'owner-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toBeInstanceOf(TiingoProviderError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not poison provider health when the caller cancels the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockResolvedValueOnce(Response.json([
        price('2026-08-08T00:00:00.000Z'),
      ]));
    const request = {
      apiKey: API_KEY,
      healthKey: 'cancelled-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(fetchTiingoDailyPrices({
        ...request,
        signal: controller.signal,
      })).rejects.toMatchObject({ status: 'provider_unavailable' });
    }
    await expect(fetchTiingoDailyPrices(request)).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('counts concurrent network failures atomically and applies cooldown', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(
      new TypeError('network unavailable'),
    );
    const request = {
      apiKey: API_KEY,
      healthKey: 'concurrent-failure-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    };

    const failures = await Promise.allSettled(
      Array.from({ length: 4 }, () => fetchTiingoDailyPrices(request)),
    );
    await expect(fetchTiingoDailyPrices(request)).rejects.toMatchObject({
      status: 'rate_limited',
    });

    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not share cooldown state across credential revisions', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json([
        price('2026-08-08T00:00:00.000Z'),
      ]));
    const base = {
      apiKey: API_KEY,
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    };

    await expect(fetchTiingoDailyPrices({
      ...base,
      healthKey: 'revision-user:tiingo:1',
    })).rejects.toMatchObject({ status: 'rate_limited' });
    await expect(fetchTiingoDailyPrices({
      ...base,
      healthKey: 'revision-user:tiingo:2',
    })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed for observations outside the requested range or duplicate days', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json([
        price('2099-01-01T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(Response.json([
        price('2026-08-08T00:00:00.000Z'),
        price('2026-08-08T12:00:00.000Z', 101),
      ]));

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'range-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'duplicate-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a bounded five-year full EOD response above the old 256 KiB limit', async () => {
    const start = new Date('2021-01-01T00:00:00.000Z');
    const fullRows = Array.from({ length: 1_250 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      return {
        ...price(date.toISOString(), 123.456789),
        adjOpen: 120.123456,
        adjHigh: 124.234567,
        adjLow: 119.987654,
        adjClose: 122.345678,
        adjVolume: 123_456_789,
        divCash: 0,
        splitFactor: 1,
      };
    });
    const endDate = fullRows.at(-1)!.date.slice(0, 10);
    expect(Buffer.byteLength(JSON.stringify(fullRows))).toBeGreaterThan(
      256 * 1024,
    );
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json(fullRows));

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'large-history-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2021-01-01',
      endDate,
    })).resolves.toHaveLength(1_250);
  });

  it('still rejects provider responses above the one MiB hard limit', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('[]', {
      headers: { 'Content-Length': String(1024 * 1024 + 1) },
    }));

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'oversized-history-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
  });

  it('rejects chunked provider responses above one MiB without Content-Length', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(`${' '.repeat(1024 * 1024 + 1)}[]`),
    );

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'chunked-oversized-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
  });

  it('rejects malformed rows and more than 2,500 observations', async () => {
    const start = new Date('2019-01-01T00:00:00.000Z');
    const tooMany = Array.from({ length: 2_501 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      return price(date.toISOString());
    });
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json([
        null,
        price('2026-08-08T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(Response.json(tooMany));

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'malformed-row-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'too-many-rows-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2019-01-01',
      endDate: tooMany.at(-1)!.date.slice(0, 10),
    })).rejects.toMatchObject({ status: 'unexpected_response' });
  });

  it('rejects impossible dates and values that cannot be represented safely', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json([
        price('2026-02-30T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(Response.json([{
        ...price('2026-08-08T00:00:00.000Z'),
        high: Number.MAX_VALUE,
      }]));

    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'date-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-02-01',
      endDate: '2026-03-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
    await expect(fetchTiingoDailyPrices({
      apiKey: API_KEY,
      healthKey: 'number-user:tiingo:1',
      symbol: 'AAPL',
      startDate: '2026-08-01',
      endDate: '2026-08-09',
    })).rejects.toMatchObject({ status: 'unexpected_response' });
  });
});
