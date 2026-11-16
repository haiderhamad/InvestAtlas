import {
  buildPortfolioMonitorSeries,
  deriveGoldSilverRatio,
} from '@/lib/portfolio/ux-insights';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

function tx(overrides: Partial<InvestmentTransaction>): InvestmentTransaction {
  return {
    id: overrides.id ?? 'tx',
    date: overrides.date ?? '2026-05-09T00:00:00Z',
    venue: overrides.venue ?? 'investment-cash',
    settlementVenue: overrides.settlementVenue,
    type: overrides.type ?? 'deposit',
    asset: overrides.asset ?? 'EUR',
    assetClass: overrides.assetClass ?? 'cash',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 1000,
    price: overrides.price ?? 1,
    total: overrides.total ?? overrides.amount ?? 1000,
    fee: overrides.fee ?? 0,
    taxType: overrides.taxType ?? 'cash_in',
    source: overrides.source ?? 'manual',
    metalFineness: overrides.metalFineness,
  };
}

describe('buildPortfolioMonitorSeries', () => {
  test('excludes operational investment cash from chart history while keeping bought assets', () => {
    const series = buildPortfolioMonitorSeries(
      [
        tx({ id: 'cash-deposit', amount: 10000, total: 10000 }),
        tx({
          id: 'buy-stock',
          date: '2026-05-10T00:00:00Z',
          venue: 'trade-republic',
          settlementVenue: 'investment-cash',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          amount: 10,
          price: 248.2,
          total: 2482,
          fee: 1,
          taxType: 'acquisition',
        }),
      ],
      [],
      {
        monthKey: '2026-05',
        invested: 2483,
        marketValue: 2482,
        sleeves: { stock: 2482 },
      },
      { AAPL: [{ date: '2026-05-10', close: 248.2 }] },
      { excludedCashVenues: ['investment-cash'] },
    );

    expect(series.find((point) => point.date === '2026-05-09')).toEqual(
      expect.objectContaining({ invested: 0, marketValue: 0 }),
    );
    expect(series.find((point) => point.date === '2026-05-10')).toEqual(
      expect.objectContaining({ invested: 2483, marketValue: 2482 }),
    );
  });

  test('does not build a EUR monitor from transactions with missing FX data', () => {
    const series = buildPortfolioMonitorSeries([
      tx({
        id: 'usd-deposit',
        quote: 'USD',
        asset: 'USD',
        amount: 1000,
        total: 1000,
      }),
    ], []);

    expect(series).toEqual([]);
  });

  test('returns no valuation history when a required asset history is missing', () => {
    const series = buildPortfolioMonitorSeries(
      [
        tx({
          id: 'buy-stock',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          amount: 1,
          price: 100,
          total: 100,
          taxType: 'acquisition',
        }),
      ],
      [],
      undefined,
      {},
    );

    expect(series).toEqual([]);
  });

  test('does not use acquisition cost for the missing side of partial history', () => {
    const series = buildPortfolioMonitorSeries(
      [
        tx({
          id: 'buy-aapl',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          amount: 1,
          price: 100,
          total: 100,
          taxType: 'acquisition',
        }),
        tx({
          id: 'buy-msft',
          type: 'buy',
          asset: 'MSFT',
          assetClass: 'stock',
          amount: 1,
          price: 200,
          total: 200,
          taxType: 'acquisition',
        }),
      ],
      [],
      undefined,
      {
        AAPL: [{ date: '2026-05-09', close: 150 }],
      },
    );

    expect(series).toEqual([]);
  });

  test('does not surface a supplied demo growth series as portfolio history', () => {
    const series = buildPortfolioMonitorSeries(
      [],
      [
        {
          date: '2026-05',
          total: 50_000,
          crypto: 10_000,
          stocks: 30_000,
          etfs: 5_000,
          metals: 5_000,
        },
      ],
    );

    expect(series).toEqual([]);
  });

  test('formats chart dates in the selected product language', () => {
    const day = new Date().toISOString().slice(0, 10);
    const snapshot = {
      invested: 100,
      marketValue: 100,
      sleeves: { stock: 100 },
    };
    const expectedDate = new Date(`${day}T00:00:00.000Z`);

    const english = buildPortfolioMonitorSeries(
      [],
      [],
      snapshot,
      undefined,
      { language: 'en' },
    );
    const arabic = buildPortfolioMonitorSeries(
      [],
      [],
      snapshot,
      undefined,
      { language: 'ar' },
    );

    expect(english.find((point) => point.date === day)?.shortDate).toBe(
      new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
      }).format(expectedDate),
    );
    expect(arabic.find((point) => point.date === day)?.shortDate).toBe(
      new Intl.DateTimeFormat('ar-SA', {
        day: 'numeric',
        month: 'short',
      }).format(expectedDate),
    );
  });

  test('caps a fixed snapshot timeline at its declared as-of day', () => {
    const series = buildPortfolioMonitorSeries(
      [],
      [],
      {
        asOfDay: '2026-08-01',
        invested: 100,
        marketValue: 110,
        sleeves: { stock: 110 },
      },
    );

    expect(series.at(-1)).toEqual(expect.objectContaining({
      date: '2026-08-01',
      invested: 100,
      marketValue: 110,
    }));
    expect(series.some((point) => point.date > '2026-08-01')).toBe(false);
  });

  test('values historical metal holdings by fine-metal-equivalent grams', () => {
    const day = new Date().toISOString().slice(0, 10);
    const series = buildPortfolioMonitorSeries(
      [
        tx({
          id: 'metal-cash',
          date: `${day}T00:00:00.000Z`,
          amount: 500,
          total: 500,
        }),
        tx({
          id: 'gold-750',
          date: `${day}T01:00:00.000Z`,
          venue: 'bullion-vault',
          type: 'buy',
          asset: 'GOLD',
          assetClass: 'metal',
          amount: 10,
          price: 50,
          total: 500,
          taxType: 'acquisition',
          metalFineness: 750,
        }),
      ],
      [],
      undefined,
      {
        GOLD: [{ date: day, close: TROY_OUNCE_GRAMS * 100 }],
      },
    );

    expect(series.find((point) => point.date === day)).toEqual(
      expect.objectContaining({
        invested: 500,
        marketValue: 750,
        metals: 750,
      }),
    );
  });

  test('omits historical metal valuation when legacy fineness is unknown', () => {
    const day = new Date().toISOString().slice(0, 10);
    const series = buildPortfolioMonitorSeries(
      [
        tx({
          id: 'metal-cash',
          date: `${day}T00:00:00.000Z`,
          amount: 500,
          total: 500,
        }),
        tx({
          id: 'gold-unknown',
          date: `${day}T01:00:00.000Z`,
          venue: 'bullion-vault',
          type: 'buy',
          asset: 'GOLD',
          assetClass: 'metal',
          amount: 10,
          price: 50,
          total: 500,
          taxType: 'acquisition',
        }),
      ],
      [],
      undefined,
      {
        GOLD: [{ date: day, close: TROY_OUNCE_GRAMS * 100 }],
      },
    );

    expect(series).toEqual([]);
  });
});

describe('deriveGoldSilverRatio', () => {
  test('requires both positive metal observations', () => {
    expect(deriveGoldSilverRatio([
      { symbol: 'GOLD', currentPrice: 2_000 },
    ])).toBeNull();
  });

  test('requires a shared observation date', () => {
    expect(deriveGoldSilverRatio([
      { symbol: 'GOLD', currentPrice: 80 },
      { symbol: 'SILVER', currentPrice: 1 },
    ])).toBeNull();
  });

  test.each([
    [50, 'below_60'],
    [65, '60_to_75'],
    [80, '75_to_90'],
    [95, '90_plus'],
  ] as const)('returns a neutral reference band for ratio %s', (ratio, referenceBand) => {
    const insight = deriveGoldSilverRatio([
      { symbol: 'GOLD', currentPrice: ratio, asOf: '2026-08-12' },
      { symbol: 'SILVER', currentPrice: 1, asOf: '2026-08-12' },
    ]);

    expect(insight).toEqual(expect.objectContaining({
      ratio,
      referenceBand,
      asOf: '2026-08-12',
    }));
    expect(JSON.stringify(insight)).not.toMatch(
      /under|overvalu|cheap|fair value|catch-up|potential|buy|sell/iu,
    );
  });

  test('fails closed for unmatched observations', () => {
    expect(deriveGoldSilverRatio([
      { symbol: 'GOLD', currentPrice: 80, asOf: '2026-08-12' },
      { symbol: 'SILVER', currentPrice: 1, asOf: '2026-08-11' },
    ])).toBeNull();
  });
});
