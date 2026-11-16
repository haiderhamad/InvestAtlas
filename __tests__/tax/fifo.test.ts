/**
 * German Tax Rules (FIFO) Tests
 */

import { 
  calculateHoldingDays, isTaxFreeByHoldingPeriod, getTaxYear,
  buildTaxLots, processDisposals, calculateTaxYearSummaries,
  DEFAULT_TAX_SETTINGS
} from '../../src/lib/tax/german-rules';
import type { Transaction } from '../../src/lib/tax/legacy-types';

describe('calculateHoldingDays', () => {
  test('calculates correct holding period', () => {
    expect(calculateHoldingDays('2023-01-01T00:00:00Z', '2024-01-01T00:00:00Z')).toBe(365);
    expect(calculateHoldingDays('2023-01-01T00:00:00Z', '2023-07-01T00:00:00Z')).toBe(181);
  });

  test('exactly 365 days = tax-free', () => {
    expect(isTaxFreeByHoldingPeriod(365)).toBe(true);
    expect(isTaxFreeByHoldingPeriod(364)).toBe(false);
    expect(isTaxFreeByHoldingPeriod(366)).toBe(true);
  });
});

describe('getTaxYear', () => {
  test('returns correct year', () => {
    expect(getTaxYear('2024-06-15T10:00:00Z')).toBe(2024);
    expect(getTaxYear('2023-12-31T23:59:59Z')).toBe(2023);
  });
});

describe('FIFO Lot Management', () => {
  const baseTx: Omit<Transaction, 'id' | 'timestamp' | 'amount' | 'price' | 'total' | 'type' | 'tax_type'> = {
    user_id: 'user-1',
    raw_transaction_id: null,
    exchange: 'bitvavo',
    base_asset: 'BTC',
    quote_asset: 'EUR',
    fee_amount: 0,
    fee_asset: 'EUR',
    lot_assigned: false,
    notes: null,
    created_at: '2024-01-01T00:00:00Z',
  };

  test('builds tax lots from acquisitions', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-15T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.5, price: 20000, total: 10000 },
      { ...baseTx, id: 'tx2', timestamp: '2023-06-15T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.3, price: 25000, total: 7500 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    expect(lots).toHaveLength(2);
    expect(lots[0].original_amount).toBe(0.5);
    expect(lots[0].cost_basis_per_unit).toBe(20000);
    expect(lots[1].original_amount).toBe(0.3);
  });

  test('FIFO: consumes oldest lot first', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-15T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.5, price: 20000, total: 10000 },
      { ...baseTx, id: 'tx2', timestamp: '2023-06-15T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.3, price: 25000, total: 7500 },
      { ...baseTx, id: 'tx3', timestamp: '2024-03-15T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 0.4, price: 60000, total: 24000 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    const { updatedLots, disposals } = processDisposals(txs, lots, DEFAULT_TAX_SETTINGS);

    // Should consume from first (oldest) lot
    expect(disposals).toHaveLength(1);
    expect(updatedLots[0].remaining_amount).toBeCloseTo(0.1); // 0.5 - 0.4
    expect(updatedLots[1].remaining_amount).toBe(0.3); // untouched
    expect(disposals[0].realized_gain).toBeCloseTo((60000 - 20000) * 0.4); // gain
  });

  test('FIFO: spans multiple lots', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.2, price: 20000, total: 4000 },
      { ...baseTx, id: 'tx2', timestamp: '2023-06-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 0.3, price: 25000, total: 7500 },
      { ...baseTx, id: 'tx3', timestamp: '2024-06-01T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 0.4, price: 60000, total: 24000 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    const { updatedLots, disposals } = processDisposals(txs, lots, DEFAULT_TAX_SETTINGS);

    // First lot fully consumed (0.2), second lot partially (0.2 of 0.3)
    expect(disposals).toHaveLength(2);
    expect(updatedLots[0].remaining_amount).toBe(0);
    expect(updatedLots[0].is_fully_disposed).toBe(true);
    expect(updatedLots[1].remaining_amount).toBeCloseTo(0.1);
  });

  test('holding period >= 365 days = tax-free', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 1, price: 20000, total: 20000 },
      { ...baseTx, id: 'tx2', timestamp: '2024-01-02T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 1, price: 60000, total: 60000 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    const { disposals } = processDisposals(txs, lots, DEFAULT_TAX_SETTINGS);

    expect(disposals[0].is_tax_free).toBe(true);
    expect(disposals[0].holding_days).toBeGreaterThanOrEqual(365);
  });

  test('holding period < 365 days = taxable', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2024-01-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 1, price: 20000, total: 20000 },
      { ...baseTx, id: 'tx2', timestamp: '2024-06-01T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 1, price: 60000, total: 60000 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    const { disposals } = processDisposals(txs, lots, DEFAULT_TAX_SETTINGS);

    expect(disposals[0].is_tax_free).toBe(false);
    expect(disposals[0].holding_days).toBeLessThan(365);
  });

  test('calculates tax year summaries', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 1, price: 20000, total: 20000 },
      { ...baseTx, id: 'tx2', timestamp: '2024-06-01T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 0.5, price: 60000, total: 30000 },
      { ...baseTx, id: 'tx3', timestamp: '2024-09-01T10:00:00Z', type: 'sell', tax_type: 'disposal', amount: 0.3, price: 50000, total: 15000 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    const { disposals } = processDisposals(txs, lots, DEFAULT_TAX_SETTINGS);
    const summaries = calculateTaxYearSummaries(disposals, DEFAULT_TAX_SETTINGS);

    expect(summaries).toHaveLength(1); // all disposals in 2024
    expect(summaries[0].year).toBe(2024);
    expect(summaries[0].disposalCount).toBe(2);
  });

  test('fees are added to cost basis on buy', () => {
    const txs: Transaction[] = [
      { ...baseTx, id: 'tx1', timestamp: '2023-01-01T10:00:00Z', type: 'buy', tax_type: 'acquisition', amount: 1, price: 20000, total: 20000, fee_amount: 50 },
    ];

    const lots = buildTaxLots(txs, DEFAULT_TAX_SETTINGS);
    // cost_basis_per_unit should be (20000 * 1 + 50) / 1 = 20050
    expect(lots[0].cost_basis_per_unit).toBeCloseTo(20050);
  });
});
