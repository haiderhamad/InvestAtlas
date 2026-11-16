import {
  buildAccountMonitorSeries,
  listPositiveOpenCashBalances,
} from '@/lib/accounts/account-detail';
import type { DerivedHolding } from '@/lib/transactions/holdings-engine';
import type { AppTransaction } from '@/lib/transactions/manual-store';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function transaction(overrides: Partial<AppTransaction> = {}): AppTransaction {
  return {
    id: overrides.id ?? 'transaction',
    date: overrides.date ?? '2026-05-09T00:00:00Z',
    venue: overrides.venue ?? 'manual-entry',
    settlementVenue: overrides.settlementVenue,
    type: overrides.type ?? 'deposit',
    asset: overrides.asset ?? 'EUR',
    assetClass: overrides.assetClass ?? 'cash',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 1000,
    price: overrides.price ?? 1,
    total: overrides.total ?? 1000,
    fee: overrides.fee ?? 0,
    taxType: overrides.taxType ?? 'cash_in',
    source: overrides.source ?? 'manual',
    metalFineness: overrides.metalFineness,
  };
}

describe('buildAccountMonitorSeries', () => {
  it('does not present foreign-currency cash as a guessed EUR value', () => {
    expect(
      buildAccountMonitorSeries(
        [
          transaction({
            asset: 'USD',
            quote: 'USD',
          }),
        ],
        {},
        {},
      ),
    ).toEqual([]);
  });

  it('does not backfill historical dates with today’s current price', () => {
    const series = buildAccountMonitorSeries(
      [
        transaction({
          date: '2026-05-09T00:00:00Z',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          amount: 1,
          price: 100,
          total: 100,
          taxType: 'acquisition',
        }),
      ],
      {},
      { AAPL: 150 },
    );

    expect(series).toHaveLength(1);
    expect(series[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('omits dates before sourced history begins instead of using a future quote', () => {
    const series = buildAccountMonitorSeries(
      [
        transaction({
          date: '2026-05-09T00:00:00Z',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          amount: 1,
          price: 100,
          total: 100,
          taxType: 'acquisition',
        }),
      ],
      {
        AAPL: [
          { date: '2026-05-10', close: 140 },
          { date: '2026-05-11', close: 145 },
        ],
      },
      {},
    );

    expect(series.some((point) => point.date === '2026-05-09')).toBe(false);
    expect(series.find((point) => point.date === '2026-05-10')?.holdingsValue).toBe(140);
    expect(series.at(-1)?.date).toBe('2026-05-11');
  });

  it('uses fine-metal-equivalent grams and fails closed for unknown fineness', () => {
    const day = new Date().toISOString().slice(0, 10);
    const cash = transaction({
      id: 'metal-cash',
      date: `${day}T00:00:00.000Z`,
      amount: 500,
      total: 500,
    });
    const gold = transaction({
      id: 'gold-750',
      date: `${day}T01:00:00.000Z`,
      type: 'buy',
      asset: 'GOLD',
      assetClass: 'metal',
      amount: 10,
      price: 50,
      total: 500,
      taxType: 'acquisition',
      metalFineness: 750,
    });

    const knownSeries = buildAccountMonitorSeries(
      [cash, gold],
      {},
      { GOLD: TROY_OUNCE_GRAMS * 100 },
    );
    const unknownSeries = buildAccountMonitorSeries(
      [cash, { ...gold, metalFineness: undefined }],
      {},
      { GOLD: TROY_OUNCE_GRAMS * 100 },
    );

    expect(knownSeries.find((point) => point.date === day)).toEqual(
      expect.objectContaining({
        holdingsValue: 750,
        marketValue: 750,
      }),
    );
    expect(unknownSeries).toEqual([]);
  });

  it('detects positive cash by original amount even when EUR valuation is unavailable', () => {
    const holding: DerivedHolding = {
      symbol: 'USD',
      name: 'Cash (USD)',
      assetClass: 'cash',
      amount: 250,
      avgCost: 0,
      costBasisAvailable: false,
      venue: 'cash-account',
    };

    expect(listPositiveOpenCashBalances([holding])).toEqual([
      { symbol: 'USD', amount: 250 },
    ]);
  });

  it('keeps hard-delete confirmation tied to original open cash balances', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/accounts/[venue]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('listPositiveOpenCashBalances(baseHoldings)');
    expect(source).toContain(
      '(openAssetHoldings.length > 0 || hasOpenCash) && !allowHardDeleteWithData',
    );
  });

  it('formats account chart dates with the requested product locale', () => {
    const day = new Date().toISOString().slice(0, 10);
    const series = buildAccountMonitorSeries(
      [transaction({ date: `${day}T00:00:00.000Z` })],
      {},
      {},
      'de-DE',
    );

    expect(series[0]?.shortDate).toBe(
      new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${day}T00:00:00.000Z`)),
    );
  });
});
