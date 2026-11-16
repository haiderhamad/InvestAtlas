import {
  buildConsolidatedHistory,
  validateOHLCData,
} from '@/lib/data/historical-engine';
import { getHistoricalProviders } from '@/lib/data/historical-providers';
import { fetchProvider } from '@/lib/data/provider-fetch';

jest.mock('@/lib/data/historical-providers', () => ({
  getHistoricalProviders: jest.fn(),
}));

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedProviders = jest.mocked(getHistoricalProviders);
const mockedFetchProvider = jest.mocked(fetchProvider);

describe('historical close-only data trust', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects inconsistent provider OHLC without mutating sourced values', () => {
    const sourcedRow = {
      date: '2026-07-27',
      open: 105,
      high: 100,
      low: 90,
      close: 95,
      volume: 1_000,
    };
    const original = { ...sourcedRow };

    const result = validateOHLCData([sourcedRow]);

    expect(result.valid).toEqual([]);
    expect(result.warnings).toEqual([
      'Skipped inconsistent OHLC row for date: 2026-07-27',
    ]);
    expect(sourcedRow).toEqual(original);
  });

  it('rejects non-finite, non-positive, and malformed close-only rows', () => {
    const result = validateOHLCData([
      {
        date: '2026-07-27',
        open: Number.POSITIVE_INFINITY,
        high: Number.POSITIVE_INFINITY,
        low: 90,
        close: 95,
        volume: 1_000,
      },
      {
        date: '2026-07-28',
        open: 0,
        high: 100,
        low: 90,
        close: 95,
        volume: 1_000,
      },
      {
        date: '2026-07-29',
        open: 99,
        high: 100,
        low: 99,
        close: 100,
        volume: 1_000,
        quality: 'close_only',
      },
      {
        date: '2026-02-30',
        open: 95,
        high: 100,
        low: 90,
        close: 95,
        volume: 1_000,
      },
    ]);

    expect(result.valid).toEqual([]);
    expect(result.warnings).toHaveLength(4);
  });

  it('marks CoinGecko market snapshots as partial rather than validated OHLC', async () => {
    const firstTimestamp = Date.parse('2026-07-27T00:00:00.000Z');
    const secondTimestamp = Date.parse('2026-07-28T00:00:00.000Z');
    mockedProviders.mockResolvedValue([
      {
        id: 'coingecko_public',
        name: 'CoinGecko Keyless Public API',
        type: 'api',
        role: 'fallback',
        dataShape: 'close_only',
        quoteCurrencies: ['eur', 'usd'],
        isActive: true,
        priority: 1,
        requiresKey: false,
      },
    ]);
    mockedFetchProvider.mockResolvedValue(
      Response.json({
        prices: [
          [firstTimestamp, 100],
          [secondTimestamp, 101],
        ],
        total_volumes: [
          [secondTimestamp, 2_000],
          [firstTimestamp, 1_000],
        ],
      }),
    );

    const result = await buildConsolidatedHistory('BTC', 'eur', '1d', true);

    expect(result.prices).toEqual([
      expect.objectContaining({
        date: '2026-07-27',
        close: 100,
        volume: 1_000,
        quality: 'close_only',
      }),
      expect.objectContaining({
        date: '2026-07-28',
        close: 101,
        volume: 2_000,
        quality: 'close_only',
      }),
    ]);
    expect(result.provenance).toEqual([
      expect.objectContaining({
        providerId: 'coingecko_public',
        status: 'partial',
      }),
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Close-only market snapshots'),
      ]),
    );
  });

  it('does not call dense intraday points a complete four-year history', async () => {
    mockedProviders.mockResolvedValue([
      {
        id: 'binance_public',
        name: 'Binance Public API',
        type: 'api',
        role: 'primary',
        dataShape: 'ohlcv',
        quoteCurrencies: ['eur'],
        isActive: true,
        priority: 1,
        requiresKey: false,
      },
    ]);

    mockedFetchProvider.mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );
    const latest = Date.parse('2026-07-28T12:00:00.000Z');
    for (let batch = 0; batch < 5; batch += 1) {
      const rows = Array.from({ length: 300 }, (_, index) => {
        const offset = batch * 300 + index;
        return [
          latest - offset * 60_000,
          '100',
          '101',
          '99',
          '100',
          '10',
        ];
      });
      mockedFetchProvider.mockResolvedValueOnce(Response.json(rows));
    }

    const result = await buildConsolidatedHistory(
      'BTC',
      'eur',
      '1m',
      true,
    );

    expect(result.prices).toHaveLength(1_500);
    expect(result.isComplete).toBe(false);
    expect(result.provenance).toEqual([
      expect.objectContaining({ status: 'structurally_valid' }),
    ]);
  });

  it('does not relabel Binance USDT history as USD', async () => {
    mockedProviders.mockResolvedValue([
      {
        id: 'binance_public',
        name: 'Binance Public API',
        type: 'api',
        role: 'primary',
        dataShape: 'ohlcv',
        quoteCurrencies: ['eur'],
        isActive: true,
        priority: 1,
        requiresKey: false,
      },
    ]);

    const result = await buildConsolidatedHistory(
      'BTC',
      'usd',
      '1d',
      true,
    );

    expect(result.prices).toEqual([]);
    expect(result.provenance).toEqual([]);
    expect(mockedFetchProvider).not.toHaveBeenCalled();
  });
});
