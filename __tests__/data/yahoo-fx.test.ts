import { fetchProvider } from '@/lib/data/provider-fetch';
import { fetchYahooHistoricalBars } from '@/lib/prices/yahoo';
import { createSingleEntryZip } from '../test-utils/zip';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);

function yahooChartResponse(input: {
  currency: string;
  timestamps: number[];
  closes: Array<number | null>;
}) {
  return new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: { currency: input.currency },
            timestamp: input.timestamps,
            indicators: {
              quote: [
                {
                  open: input.closes,
                  high: input.closes,
                  low: input.closes,
                  close: input.closes,
                  volume: input.closes.map(() => 10),
                },
              ],
            },
          },
        ],
        error: null,
      },
    }),
  );
}

function ecbFxResponse(rows: Array<{ date: string; usdPerEur: number }>) {
  return new Response([
    'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE',
    ...rows.map(({ date, usdPerEur }) =>
      `EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,${date},${usdPerEur}`
    ),
  ].join('\n'));
}

function ecbFxHistoryResponse(
  rows: Array<{ date: string; usdPerEur: number }>,
) {
  const withCurrentArchiveObservation = rows.some(
    ({ date }) => date === '2026-07-31',
  )
    ? rows
    : [...rows, { date: '2026-07-31', usdPerEur: 1.15 }];
  const csv = [
    'Date,USD,JPY,',
    ...withCurrentArchiveObservation.map(({ date, usdPerEur }) =>
      `${date},${usdPerEur},160.0,`
    ),
  ].join('\n');
  return new Response(createSingleEntryZip(csv), {
    headers: { 'Content-Type': 'application/zip' },
  });
}

describe('Yahoo FX conversion safeguards', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    mockedFetchProvider.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not convert an early bar 1:1 when its FX rate is unavailable', async () => {
    const firstDay = Date.parse('2026-01-01T00:00:00Z') / 1000;
    const secondDay = Date.parse('2026-01-02T00:00:00Z') / 1000;

    mockedFetchProvider
      .mockResolvedValueOnce(
        yahooChartResponse({
          currency: 'USD',
          timestamps: [firstDay, secondDay],
          closes: [100, 100],
        }),
      )
      .mockResolvedValueOnce(
        ecbFxHistoryResponse([{ date: '2026-01-02', usdPerEur: 1 / 0.9 }]),
      );

    const result = await fetchYahooHistoricalBars('AAPL', 'eur');

    expect(result.bars).toEqual([
      expect.objectContaining({
        date: '2026-01-02',
        close: 90,
        sourceCurrency: 'USD',
        currency: 'EUR',
        fx: expect.objectContaining({
          providerId: 'ecb_reference_rates',
          asOf: '2026-01-02',
        }),
      }),
    ]);
    expect(result.bars).not.toContainEqual(
      expect.objectContaining({
        date: '2026-01-01',
        close: 100,
      }),
    );
  });

  it('does not reinterpret an unknown Yahoo quote currency as USD', async () => {
    const day = Date.parse('2026-01-01T00:00:00Z') / 1000;
    mockedFetchProvider.mockResolvedValueOnce(
      yahooChartResponse({
        currency: 'GBp',
        timestamps: [day],
        closes: [100],
      }),
    );

    await expect(
      fetchYahooHistoricalBars('UNKNOWN.L', 'eur'),
    ).rejects.toThrow('Unsupported Yahoo source currency');
    expect(mockedFetchProvider).toHaveBeenCalledTimes(1);
  });

  it('rejects a Yahoo history payload when every OHLC row is inconsistent', async () => {
    const day = Date.parse('2026-01-01T00:00:00Z') / 1000;
    mockedFetchProvider.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: { currency: 'EUR' },
                timestamp: [day],
                indicators: {
                  quote: [
                    {
                      open: [105],
                      high: [100],
                      low: [90],
                      close: [95],
                      volume: [10],
                    },
                  ],
                },
              },
            ],
            error: null,
          },
        }),
      ),
    );

    await expect(
      fetchYahooHistoricalBars('AAPL', 'eur'),
    ).rejects.toThrow('Invalid Yahoo historical response');
  });

  it('rejects malformed Yahoo history metadata instead of renewing the cache as empty', async () => {
    const day = Date.parse('2026-01-01T00:00:00Z') / 1000;
    mockedFetchProvider.mockResolvedValueOnce(
      new Response(JSON.stringify({
        chart: {
          result: [{
            meta: { currency: 'EUR' },
            timestamp: [day],
            indicators: {},
          }],
          error: null,
        },
      })),
    );

    await expect(
      fetchYahooHistoricalBars('AAPL', 'eur'),
    ).rejects.toThrow('Invalid Yahoo historical response');
  });

  it('keeps a missing Yahoo volume unavailable instead of reporting zero', async () => {
    const day = Date.parse('2026-01-01T00:00:00Z') / 1000;
    mockedFetchProvider.mockResolvedValueOnce(
      new Response(JSON.stringify({
        chart: {
          result: [{
            meta: { currency: 'EUR' },
            timestamp: [day],
            indicators: {
              quote: [{
                open: [100],
                high: [101],
                low: [99],
                close: [100],
                volume: [null],
              }],
            },
          }],
          error: null,
        },
      })),
    );

    const result = await fetchYahooHistoricalBars('AAPL', 'eur');

    expect(result.bars[0]).toEqual(expect.objectContaining({
      volume: 0,
      volumeAvailable: false,
    }));
  });

  it('does not forward-fill a stale FX rate indefinitely', async () => {
    const firstDay = Date.parse('2026-01-01T00:00:00Z') / 1000;
    const tenthDay = Date.parse('2026-01-10T00:00:00Z') / 1000;

    mockedFetchProvider
      .mockResolvedValueOnce(
        yahooChartResponse({
          currency: 'USD',
          timestamps: [firstDay, tenthDay],
          closes: [100, 100],
        }),
      )
      .mockResolvedValueOnce(
        ecbFxHistoryResponse([{ date: '2026-01-01', usdPerEur: 1 / 0.9 }]),
      );

    const result = await fetchYahooHistoricalBars('AAPL', 'eur');

    expect(result.bars).toEqual([
      expect.objectContaining({
        date: '2026-01-01',
        close: 90,
      }),
    ]);
  });

  it('does not report an empty successful refresh when required FX is unavailable', async () => {
    const day = Date.parse('2026-01-02T00:00:00Z') / 1000;
    mockedFetchProvider
      .mockResolvedValueOnce(
        yahooChartResponse({
          currency: 'USD',
          timestamps: [day],
          closes: [100],
        }),
      )
      .mockRejectedValueOnce(new Error('ECB unavailable'));

    await expect(
      fetchYahooHistoricalBars('AAPL', 'eur'),
    ).rejects.toThrow('Historical FX data is unavailable');
  });

  it('preserves native currency, source symbol and ECB provenance for a current quote', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          chart: {
            result: [{
              meta: {
                currency: 'USD',
                regularMarketPrice: 100,
                chartPreviousClose: 90,
                regularMarketTime: Date.parse('2026-07-31T15:30:00.000Z') / 1000,
                longName: 'Example Corp',
              },
              timestamp: [],
              indicators: { quote: [{ close: [], volume: [] }] },
            }],
            error: null,
          },
        })),
      )
      .mockResolvedValueOnce(
        ecbFxResponse([{ date: '2026-07-31', usdPerEur: 1.25 }]),
      );

    const { fetchYahooCurrentQuote } = await import('@/lib/prices/yahoo');
    const quote = await fetchYahooCurrentQuote(
      ['EXAMPLE', 'EXAMPLE-FALLBACK'],
      'eur',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    expect(quote).toEqual(expect.objectContaining({
      price: 80,
      previousClose: 72,
      currency: 'eur',
      nativeCurrency: 'usd',
      sourceSymbol: 'EXAMPLE',
      asOf: '2026-07-31T15:30:00.000Z',
      fx: expect.objectContaining({
        providerId: 'ecb_reference_rates',
        asOf: '2026-07-31',
        rate: 0.8,
      }),
    }));
  });

  it('rejects a current Yahoo quote whose market timestamp is too old', async () => {
    mockedFetchProvider.mockResolvedValueOnce(
      new Response(JSON.stringify({
        chart: {
          result: [{
            meta: {
              currency: 'EUR',
              regularMarketPrice: 100,
              chartPreviousClose: 99,
              regularMarketTime: Date.parse('2026-07-01T15:30:00.000Z') / 1000,
            },
            timestamp: [],
            indicators: { quote: [{ close: [], volume: [] }] },
          }],
          error: null,
        },
      })),
    );

    const { fetchYahooCurrentQuote } = await import('@/lib/prices/yahoo');
    await expect(
      fetchYahooCurrentQuote(
        'AAPL',
        'eur',
        new Date('2026-07-31T18:00:00.000Z'),
      ),
    ).rejects.toThrow('Yahoo quote timestamp is stale');
  });
});
