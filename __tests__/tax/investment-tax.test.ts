import { calculateInvestmentTaxOverview, type InvestmentTransaction } from '@/lib/tax/investment-tax';
import { DEFAULT_TAX_PROFILE_SETTINGS } from '@/lib/tax/tax-profile';

function tx(overrides: Partial<InvestmentTransaction>): InvestmentTransaction {
  return {
    id: overrides.id ?? 'tx',
    date: overrides.date ?? '2026-01-01T00:00:00Z',
    venue: overrides.venue ?? 'manual',
    type: overrides.type ?? 'buy',
    asset: overrides.asset ?? 'BTC',
    assetClass: overrides.assetClass ?? 'crypto',
    quote: overrides.quote ?? 'eur',
    amount: overrides.amount ?? 1,
    price: overrides.price ?? 1000,
    total: overrides.total ?? 1000,
    fee: overrides.fee ?? 0,
    taxType: overrides.taxType ?? 'acquisition',
    source: overrides.source ?? 'manual',
  };
}

describe('calculateInvestmentTaxOverview', () => {
  test('keeps private-sale losses separate from unused Freigrenze room', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({ id: 'buy-btc', date: '2026-01-01T00:00:00Z', total: 1000 }),
      tx({
        id: 'sell-btc',
        date: '2026-06-01T00:00:00Z',
        type: 'sell',
        price: 700,
        total: 700,
        taxType: 'disposal',
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    const year = overview.yearly.find((entry) => entry.year === 2026);

    expect(year?.privateSale.taxableLosses).toBe(300);
    expect(year?.privateSale.lossCarryforwardPotential).toBe(300);
    expect(year?.privateSale.allowanceRemaining).toBe(1000);
    expect(year?.privateSale.taxableBase).toBe(0);
  });

  test('offsets short-term crypto losses before checking the Freigrenze', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({ id: 'buy-btc', asset: 'BTC', date: '2026-01-01T00:00:00Z', total: 1000 }),
      tx({
        id: 'sell-btc',
        asset: 'BTC',
        date: '2026-04-01T00:00:00Z',
        type: 'sell',
        price: 1500,
        total: 1500,
        taxType: 'disposal',
      }),
      tx({ id: 'buy-eth', asset: 'ETH', date: '2026-01-01T00:00:00Z', total: 1000 }),
      tx({
        id: 'sell-eth',
        asset: 'ETH',
        date: '2026-04-01T00:00:00Z',
        type: 'sell',
        price: 800,
        total: 800,
        taxType: 'disposal',
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    const year = overview.yearly.find((entry) => entry.year === 2026);

    expect(year?.privateSale.taxablePositiveGains).toBe(500);
    expect(year?.privateSale.taxableLosses).toBe(200);
    expect(year?.privateSale.lossOffsetApplied).toBe(200);
    expect(year?.privateSale.netBeforeAllowance).toBe(300);
    expect(year?.privateSale.allowanceRemaining).toBe(700);
    expect(year?.privateSale.taxableBase).toBe(0);
  });

  test('taxes the full private-sale net gain once the Freigrenze is exceeded', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({ id: 'buy-btc', date: '2026-01-01T00:00:00Z', total: 1000 }),
      tx({
        id: 'sell-btc',
        date: '2026-04-01T00:00:00Z',
        type: 'sell',
        price: 2200,
        total: 2200,
        taxType: 'disposal',
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    const year = overview.yearly.find((entry) => entry.year === 2026);

    expect(year?.privateSale.netBeforeAllowance).toBe(1200);
    expect(year?.privateSale.allowanceRemaining).toBe(0);
    expect(year?.privateSale.taxableBase).toBe(1200);
  });

  test('does not estimate tax with a fixed USD/EUR rate', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({ id: 'buy-usd', quote: 'USD', total: 1000 }),
      tx({
        id: 'sell-usd',
        quote: 'USD',
        type: 'sell',
        taxType: 'disposal',
        total: 1200,
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    expect(overview).toMatchObject({
      calculationStatus: 'insufficient_fx_data',
      missingFxQuotes: ['USD'],
      lots: [],
      disposals: [],
      yearly: [],
    });
  });

  test('never matches a sale against a purchase that occurs later', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({
        id: 'sell-before-buy',
        date: '2026-01-10T00:00:00Z',
        type: 'sell',
        total: 1200,
        taxType: 'disposal',
      }),
      tx({
        id: 'future-buy',
        date: '2026-02-10T00:00:00Z',
        total: 1000,
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    expect(overview).toMatchObject({
      calculationStatus: 'invalid_ledger',
      lots: [],
      disposals: [],
      openLots: [],
      yearly: [],
    });
  });

  test('fails closed when a sale exceeds the chronologically available lots', () => {
    const overview = calculateInvestmentTaxOverview([
      tx({
        id: 'buy-one',
        date: '2026-01-01T00:00:00Z',
        amount: 1,
        total: 1000,
      }),
      tx({
        id: 'sell-two',
        date: '2026-02-01T00:00:00Z',
        type: 'sell',
        amount: 2,
        price: 600,
        total: 1200,
        taxType: 'disposal',
      }),
    ], DEFAULT_TAX_PROFILE_SETTINGS);

    expect(overview.calculationStatus).toBe('invalid_ledger');
    expect(overview.disposals).toEqual([]);
    expect(overview.yearly).toEqual([]);
  });

  test('assigns disposal years in UTC', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';

    try {
      const overview = calculateInvestmentTaxOverview([
        tx({
          id: 'buy-before-year-end',
          date: '2025-01-01T00:00:00Z',
          total: 1000,
        }),
        tx({
          id: 'sell-at-utc-year-end',
          date: '2025-12-31T12:30:00Z',
          type: 'sell',
          total: 1200,
          taxType: 'disposal',
        }),
      ], DEFAULT_TAX_PROFILE_SETTINGS);

      expect(overview.calculationStatus).toBe('calculated');
      expect(overview.disposals[0]?.year).toBe(2025);
      expect(overview.yearly[0]?.year).toBe(2025);
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });
});
