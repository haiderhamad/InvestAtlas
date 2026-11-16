import { GET } from '@/app/api/prices/history/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedHistory = jest.mocked(buildConsolidatedHistory);
const SAFE_VERCEL_RESPONSE_BYTES = 4 * 1024 * 1024;

describe('history API response budget', () => {
  it('keeps a ten-year FX-converted series below the Vercel response limit', async () => {
    const start = Date.parse('2016-08-01T00:00:00.000Z');
    const prices = Array.from({ length: 3_650 }, (_, index) => {
      const date = new Date(start + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        open: 80 + index / 100,
        high: 81 + index / 100,
        low: 79 + index / 100,
        close: 80.5 + index / 100,
        volume: 1_000_000 + index,
        quality: 'ohlc' as const,
        providerId: 'yahoo_finance',
        providerName: 'Yahoo Finance',
        sourceCurrency: 'USD' as const,
        currency: 'EUR' as const,
        retrievedAt: '2026-08-01T12:00:00.000Z',
        fx: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          rate: 0.92,
          asOf: date,
          freshness: 'fresh' as const,
          retrievedAt: '2026-08-01T12:00:00.000Z',
          method: 'inverse of ECB EUR/USD reference rate',
        },
      };
    });

    mockedHistory.mockResolvedValueOnce({
      symbol: 'AAPL',
      prices,
      provenance: [{
        startDate: prices[0].date,
        endDate: prices.at(-1)!.date,
        providerId: 'yahoo_finance',
        providerName: 'Yahoo Finance',
        role: 'fallback',
        dataPoints: prices.length,
        status: 'structurally_valid',
        retrievedAt: '2026-08-01T12:00:00.000Z',
      }],
      isComplete: true,
      freshness: 'fresh',
      latestObservationAt: prices.at(-1)!.date,
      warnings: [],
    });

    const response = await GET(new Request(
      'http://localhost/api/prices/history?symbol=AAPL&currency=eur',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.93' } },
    ));
    const serialized = await response.text();

    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(
      SAFE_VERCEL_RESPONSE_BYTES,
    );
  });
});
