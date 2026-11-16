import {
  hasCompleteTransactionFx,
  normalizeTransactionToEur,
} from '@/lib/fx/quote-rates';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import { calculateInvestmentTaxOverview } from '@/lib/tax/investment-tax';
import { decodeInvestmentTransaction } from '@/lib/transactions/transaction-schema';

function transaction(
  overrides: Partial<InvestmentTransaction> = {},
): InvestmentTransaction {
  return {
    id: 'fx-transaction',
    date: '2026-07-26T12:00:00.000Z',
    venue: 'manual-broker',
    type: 'buy',
    asset: 'NVDA',
    assetClass: 'stock',
    quote: 'USD',
    amount: 2,
    price: 100,
    total: 200,
    fee: 2,
    taxType: 'acquisition',
    source: 'manual',
    ...overrides,
  };
}

describe('explicit historical transaction FX', () => {
  const exactFx = {
    fxRateToEur: 0.91,
    fxRateSource: 'broker_statement' as const,
    fxRateDate: '2026-07-26',
  };

  it('converts a non-EUR value only with complete source and date metadata', () => {
    const withFx = transaction(exactFx);

    expect(hasCompleteTransactionFx(withFx)).toBe(true);
    expect(normalizeTransactionToEur(100, withFx)).toBe(91);
    expect(
      normalizeTransactionToEur(100, transaction()),
    ).toBeNull();
  });

  it('accepts a bounded explicit rate and preserves its provenance', () => {
    expect(
      decodeInvestmentTransaction(transaction(exactFx)),
    ).toEqual(expect.objectContaining(exactFx));
  });

  it.each([
    { fxRateToEur: 0.91 },
    {
      ...exactFx,
      fxRateSource: 'untrusted-source',
    },
    {
      ...exactFx,
      fxRateDate: '2025-01-01',
    },
    {
      ...exactFx,
      fxRateToEur: 0,
    },
  ])('rejects incomplete or untrusted metadata: %p', (invalidFx) => {
    expect(() =>
      decodeInvestmentTransaction(transaction(
        invalidFx as Partial<InvestmentTransaction>,
      )),
    ).toThrow();
  });

  it('rejects unnecessary FX metadata on EUR transactions', () => {
    expect(() =>
      decodeInvestmentTransaction(
        transaction({
          quote: 'EUR',
          ...exactFx,
        }),
      ),
    ).toThrow('EUR transactions must not contain FX metadata');
  });

  it('uses explicit historical FX in tax lots instead of marking USD unavailable', () => {
    const overview = calculateInvestmentTaxOverview([
      transaction({
        id: 'buy',
        ...exactFx,
      }),
      transaction({
        id: 'sell',
        date: '2026-08-01T12:00:00.000Z',
        type: 'sell',
        amount: 1,
        total: 120,
        fee: 1,
        taxType: 'disposal',
        fxRateToEur: 0.92,
        fxRateSource: 'market_provider',
        fxRateDate: '2026-08-01',
      }),
    ]);

    expect(overview.calculationStatus).toBe('calculated');
    expect(overview.missingFxQuotes).toEqual([]);
    expect(overview.disposals).toHaveLength(1);
    expect(overview.disposals[0].costBasisUsed).toBeCloseTo(91.91, 2);
    expect(overview.disposals[0].proceedsUsed).toBeCloseTo(109.48, 2);
  });
});
