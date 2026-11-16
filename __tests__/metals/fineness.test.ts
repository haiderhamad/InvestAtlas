import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseLegacyMetalFineness,
  stripLegacyMetalFinenessNote,
} from '@/lib/metals/metal-purity';
import { buildCurrentHoldingValuations } from '@/lib/portfolio/current-valuation';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import { decodeInvestmentTransaction } from '@/lib/transactions/transaction-schema';

function metalTransaction(
  overrides: Partial<InvestmentTransaction> = {},
): InvestmentTransaction {
  return {
    id: overrides.id ?? 'metal-transaction',
    date: overrides.date ?? '2026-07-27T00:00:00.000Z',
    venue: overrides.venue ?? 'bullion-vault',
    type: overrides.type ?? 'buy',
    asset: overrides.asset ?? 'GOLD',
    assetName: overrides.assetName ?? 'Gold',
    assetClass: 'metal',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 10,
    price: overrides.price ?? 50,
    total: overrides.total ?? 500,
    fee: overrides.fee ?? 0,
    taxType: overrides.taxType ?? 'acquisition',
    source: overrides.source ?? 'manual',
    notes: overrides.notes,
    transferGroupId: overrides.transferGroupId,
    transferredCostBasisEur: overrides.transferredCostBasisEur,
    transferredCostBasisStatus: overrides.transferredCostBasisStatus,
    metalFineness: overrides.metalFineness,
  };
}

describe('structured metal fineness', () => {
  test('accepts only bounded fineness on metal rows', () => {
    expect(
      decodeInvestmentTransaction(
        metalTransaction({ metalFineness: 750 }),
      ).metalFineness,
    ).toBe(750);

    expect(() =>
      decodeInvestmentTransaction(
        metalTransaction({ metalFineness: undefined }),
      ),
    ).toThrow('Metal fineness is required.');
    expect(() =>
      decodeInvestmentTransaction(
        metalTransaction({ metalFineness: 0 }),
      ),
    ).toThrow('Metal fineness is invalid.');
    expect(() =>
      decodeInvestmentTransaction({
        ...metalTransaction({ metalFineness: undefined }),
        asset: 'AAPL',
        assetName: 'Apple',
        assetClass: 'stock',
        metalFineness: 750,
      }),
    ).toThrow('Metal fineness is only valid for metal transactions.');
  });

  test('keeps an unknown legacy row readable without inventing purity', () => {
    const legacy = decodeInvestmentTransaction(
      metalTransaction({
        metalFineness: undefined,
        notes: 'Inherited item; purity document missing',
      }),
      { allowMissingLegacyMetalFineness: true },
    );

    expect(legacy.metalFineness).toBeUndefined();
  });

  test('promotes only the exact former InvestAtlas note format', () => {
    const generatedNote = 'Family allocation | Fineness: 750 — 18 Karat';
    const decoded = decodeInvestmentTransaction(
      metalTransaction({
        metalFineness: undefined,
        notes: generatedNote,
      }),
    );

    expect(decoded.metalFineness).toBe(750);
    expect(parseLegacyMetalFineness(generatedNote, 'GOLD')).toBe(750);
    expect(stripLegacyMetalFinenessNote(generatedNote, 'GOLD')).toBe(
      'Family allocation',
    );
    expect(
      parseLegacyMetalFineness('Seller says Fineness: 750', 'GOLD'),
    ).toBeUndefined();
    const conflictingNote =
      'Fineness: 750 — 18 Karat | Fineness: 999 — 24 Karat';
    expect(parseLegacyMetalFineness(conflictingNote, 'GOLD')).toBeUndefined();
    expect(stripLegacyMetalFinenessNote(conflictingNote, 'GOLD')).toBe(
      conflictingNote,
    );
    expect(
      parseLegacyMetalFineness(
        'Fineness: 750 — 18 Karat | Fineness: approximately 500',
        'GOLD',
      ),
    ).toBeUndefined();
  });

  test('aggregates mixed purity by fine-metal-equivalent grams', () => {
    const holdings = deriveHoldingsFromTransactions([
      metalTransaction({
        id: 'gold-750',
        amount: 10,
        total: 500,
        metalFineness: 750,
      }),
      metalTransaction({
        id: 'gold-999',
        date: '2026-07-27T01:00:00.000Z',
        amount: 10,
        total: 700,
        metalFineness: 999,
      }),
    ]);
    const gold = holdings.find((holding) => holding.symbol === 'GOLD');

    expect(gold).toMatchObject({
      amount: 20,
      fineMetalAmount: 17.49,
      metalFineness: 874.5,
      metalFinenessAvailable: true,
    });
  });

  test('preserves the same fine-metal amount across a structured transfer', () => {
    const holdings = deriveHoldingsFromTransactions([
      metalTransaction({
        id: 'gold-buy',
        amount: 10,
        metalFineness: 750,
      }),
      metalTransaction({
        id: 'gold-transfer-out',
        date: '2026-07-27T01:00:00.000Z',
        type: 'transfer',
        taxType: 'transfer_out',
        amount: 4,
        price: 0,
        total: 0,
        transferGroupId: 'gold-transfer',
        transferredCostBasisEur: 200,
        transferredCostBasisStatus: 'known',
        metalFineness: 750,
      }),
      metalTransaction({
        id: 'gold-transfer-in',
        date: '2026-07-27T01:00:00.000Z',
        venue: 'home-vault',
        type: 'transfer',
        taxType: 'transfer_in',
        amount: 4,
        price: 0,
        total: 0,
        transferGroupId: 'gold-transfer',
        transferredCostBasisEur: 200,
        transferredCostBasisStatus: 'known',
        metalFineness: 750,
      }),
    ]);

    expect(
      holdings.find(
        (holding) =>
          holding.venue === 'bullion-vault'
          && holding.symbol === 'GOLD',
      ),
    ).toMatchObject({
      amount: 6,
      fineMetalAmount: 4.5,
      metalFineness: 750,
    });
    expect(
      holdings.find(
        (holding) =>
          holding.venue === 'home-vault'
          && holding.symbol === 'GOLD',
      ),
    ).toMatchObject({
      amount: 4,
      fineMetalAmount: 3,
      metalFineness: 750,
    });
  });

  test('fails current valuation closed when legacy purity is unknown', () => {
    const [knownGold] = deriveHoldingsFromTransactions([
      metalTransaction({ metalFineness: 750 }),
    ]).filter((holding) => holding.symbol === 'GOLD');
    const [unknownGold] = deriveHoldingsFromTransactions([
      metalTransaction({ metalFineness: undefined }),
    ]).filter((holding) => holding.symbol === 'GOLD');
    const quote = {
      GOLD: {
        price: 3_110.35,
        change24h: 0,
        verified: true,
      },
    };

    const [knownValue] = buildCurrentHoldingValuations([knownGold], quote);
    const [unknownValue] = buildCurrentHoldingValuations([unknownGold], quote);

    expect(knownValue.currentPrice).toBeCloseTo(100);
    expect(knownValue.value).toBeCloseTo(750);
    expect(knownValue.valuationAvailable).toBe(true);
    expect(unknownGold.metalFinenessAvailable).toBe(false);
    expect(unknownValue.value).toBe(0);
    expect(unknownValue.valuationAvailable).toBe(false);
  });

  test('keeps create, edit, and both transfer legs on the structured field', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/layout/global-add-modal.tsx'),
      'utf8',
    );

    expect(source).toContain('metalFineness: submittedMetalFineness');
    expect(source).toContain(
      '? { metalFineness: submittedMetalFineness }',
    );
    expect(source).not.toContain('const metalNote =');
  });
});
