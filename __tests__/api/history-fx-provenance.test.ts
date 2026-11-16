import { GET } from '@/app/api/prices/history/route';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';

jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedHistory = jest.mocked(buildConsolidatedHistory);

describe('history API FX provenance', () => {
  it('keeps both the native provider and ECB conversion provenance', async () => {
    mockedHistory.mockResolvedValueOnce({
      symbol: 'AAPL',
      prices: [{
        date: '2026-07-31',
        open: 80,
        high: 88,
        low: 76,
        close: 84,
        volume: 1_000,
        quality: 'ohlc',
        providerId: 'yahoo_finance',
        providerName: 'Yahoo Finance',
        sourceCurrency: 'USD',
        currency: 'EUR',
        fx: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          rate: 0.8,
          asOf: '2026-07-31',
          freshness: 'fresh',
          retrievedAt: '2026-07-31T16:00:00.000Z',
          method: 'inverse of ECB EUR/USD reference rate',
        },
      }],
      provenance: [{
        startDate: '2026-07-31',
        endDate: '2026-07-31',
        providerId: 'yahoo_finance',
        providerName: 'Yahoo Finance',
        role: 'fallback',
        dataPoints: 1,
        status: 'structurally_valid',
      }],
      isComplete: false,
      warnings: [],
    });

    const response = await GET(new Request(
      'http://localhost/api/prices/history?symbol=AAPL&currency=eur',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.89' } },
    ));
    const body = await response.json();
    const price = body.prices[0];
    const marketSource = body.sources.find(
      (source: { ref: string }) => source.ref === price.sourceRef,
    );
    const fxSource = body.sources.find(
      (source: { ref: string }) => source.ref === price.conversion.sourceRef,
    );

    expect(body.contractVersion).toBe('history.v2');
    expect(price).toEqual(expect.objectContaining({
      close: 84,
      priceQuality: 'calculated',
      conversion: expect.objectContaining({
        sourceCurrency: 'USD',
        rate: 0.8,
        asOf: '2026-07-31',
      }),
    }));
    expect(marketSource).toEqual(expect.objectContaining({
      kind: 'market',
      providerId: 'yahoo_finance',
    }));
    expect(fxSource).toEqual(expect.objectContaining({
      kind: 'fx',
      providerId: 'ecb_reference_rates',
    }));
  });
});
