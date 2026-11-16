import { buildDividendInsights } from '@/lib/dividends/dividend-insights';
import type { AppTransaction } from '@/lib/transactions/manual-store';

function dividend(overrides: Partial<AppTransaction> = {}): AppTransaction {
  return {
    id: overrides.id ?? 'dividend',
    date: overrides.date ?? '2026-05-09T00:00:00Z',
    venue: overrides.venue ?? 'manual-entry',
    type: 'dividend',
    asset: overrides.asset ?? 'AAPL',
    assetClass: overrides.assetClass ?? 'stock',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 1,
    price: overrides.price ?? 10,
    total: overrides.total ?? 10,
    fee: overrides.fee ?? 0,
    taxType: 'dividend_income',
    source: overrides.source ?? 'manual',
  };
}

describe('buildDividendInsights', () => {
  it('keeps a known zero dividend distinct from missing FX data', () => {
    const result = buildDividendInsights([dividend({ total: 0 })], []);

    expect(result.calculationStatus).toBe('calculated');
    expect(result.allTimeTotal).toBe(0);
    expect(result.missingFxQuotes).toEqual([]);
  });

  it('does not aggregate non-EUR dividends without reliable FX data', () => {
    const result = buildDividendInsights(
      [dividend({ quote: 'USD', total: 10 })],
      [],
    );

    expect(result).toMatchObject({
      calculationStatus: 'insufficient_fx_data',
      missingFxQuotes: ['USD'],
      allTimeTotal: 0,
      assets: [],
    });
  });

  it('calculates trailing twelve months from the actual 365-day window', () => {
    const oldDividends = Array.from({ length: 12 }, (_, index) =>
      dividend({
        id: `old-${index}`,
        date: `2020-${String(index + 1).padStart(2, '0')}-15T00:00:00Z`,
        total: 10,
      }),
    );

    const result = buildDividendInsights(
      oldDividends,
      [],
      { asOf: '2026-07-01T00:00:00Z' },
    );

    expect(result.allTimeTotal).toBe(120);
    expect(result.trailing12Months).toBe(0);
    expect(result.averageMonthlyTrailing).toBe(0);
    expect(result.monthlyTotals).toEqual([]);
    expect(result.assets[0]?.trailing12Months).toBe(0);
  });

  it('aggregates yield-on-cost across every depot holding the asset', () => {
    const result = buildDividendInsights(
      [
        dividend({
          id: 'recent-dividend',
          date: '2026-06-01T00:00:00Z',
          total: 100,
        }),
      ],
      [
        {
          symbol: 'AAPL',
          name: 'Apple',
          assetClass: 'stock',
          amount: 10,
          avgCost: 100,
          costBasisAvailable: true,
          venue: 'broker-a',
        },
        {
          symbol: 'AAPL',
          name: 'Apple',
          assetClass: 'stock',
          amount: 5,
          avgCost: 200,
          costBasisAvailable: true,
          venue: 'broker-b',
        },
      ],
      { asOf: '2026-07-01T00:00:00Z' },
    );

    expect(result.assets[0]).toEqual(
      expect.objectContaining({
        symbol: 'AAPL',
        trailing12Months: 100,
        yieldOnCostPct: 5,
      }),
    );
  });

  it('does not report a partial yield when one depot has unknown cost basis', () => {
    const result = buildDividendInsights(
      [
        dividend({
          date: '2026-06-01T00:00:00Z',
          total: 100,
        }),
      ],
      [
        {
          symbol: 'AAPL',
          name: 'Apple',
          assetClass: 'stock',
          amount: 10,
          avgCost: 100,
          costBasisAvailable: true,
          venue: 'broker-a',
        },
        {
          symbol: 'AAPL',
          name: 'Apple',
          assetClass: 'stock',
          amount: 5,
          avgCost: 0,
          costBasisAvailable: false,
          venue: 'broker-b',
        },
      ],
      { asOf: '2026-07-01T00:00:00Z' },
    );

    expect(result.assets[0]?.yieldOnCostPct).toBeNull();
  });

  it('formats chart month labels with the requested product locale', () => {
    const date = '2026-06-15T00:00:00Z';
    const result = buildDividendInsights(
      [dividend({ date })],
      [],
      { asOf: '2026-07-01T00:00:00Z', locale: 'ar-SA' },
    );

    expect(result.monthlyTotals.find((item) => item.month === '2026-06')?.shortLabel).toBe(
      new Intl.DateTimeFormat('ar-SA', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }).format(new Date('2026-06-01T00:00:00Z')),
    );
  });
});
