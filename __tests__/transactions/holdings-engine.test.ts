import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import {
  InsufficientCashError,
  assertTransactionsHaveRequiredCash,
  getCashBalance,
  getNegativeCashBalances,
  getPositiveCashSources,
  validateBuyCashAvailability,
} from '@/lib/transactions/cash-balances';
import { buildAccountSummaries } from '@/lib/portfolio/account-overview';
import {
  addManualTransaction,
  addManualTransactions,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import { InvalidLedgerError } from '@/lib/transactions/ledger-validation';

jest.mock('@/lib/demo/workspace-mode', () => ({
  readAnonymousWorkspaceMode: () => 'local_workspace',
}));

function tx(overrides: Partial<InvestmentTransaction>): InvestmentTransaction {
  return {
    id: overrides.id ?? 'tx',
    date: overrides.date ?? '2026-01-01T00:00:00Z',
    venue: overrides.venue ?? 'trade-republic',
    settlementVenue: overrides.settlementVenue,
    type: overrides.type ?? 'deposit',
    asset: overrides.asset ?? 'EUR',
    assetClass: overrides.assetClass ?? 'cash',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 1000,
    price: overrides.price ?? 1,
    total: overrides.total ?? overrides.amount ?? 1000,
    fee: overrides.fee ?? 0,
    taxAmount: overrides.taxAmount,
    taxType: overrides.taxType ?? 'cash_in',
    source: overrides.source ?? 'manual',
    transferGroupId: overrides.transferGroupId,
    transferredCostBasisEur: overrides.transferredCostBasisEur,
    transferredCostBasisStatus: overrides.transferredCostBasisStatus,
  };
}

describe('deriveHoldingsFromTransactions', () => {
  test('keeps cash balances separated by account and currency', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({ id: 'tr-deposit', venue: 'trade-republic', amount: 1000, total: 1000 }),
      tx({ id: 'ing-deposit', venue: 'ing-tagesgeld', amount: 5000, total: 5000 }),
      tx({
        id: 'buy-etf',
        venue: 'trade-republic',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 2,
        price: 100,
        total: 200,
        fee: 1,
        taxType: 'acquisition',
      }),
      tx({
        id: 'sell-etf',
        venue: 'trade-republic',
        type: 'sell',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 1,
        price: 120,
        total: 120,
        fee: 1,
        taxType: 'disposal',
      }),
      tx({
        id: 'cash-transfer-out',
        venue: 'trade-republic',
        type: 'transfer',
        asset: 'EUR',
        assetClass: 'cash',
        amount: 300,
        total: 300,
        taxType: 'transfer_out',
      }),
      tx({
        id: 'cash-transfer-in',
        venue: 'ing-tagesgeld',
        type: 'transfer',
        asset: 'EUR',
        assetClass: 'cash',
        amount: 300,
        total: 300,
        taxType: 'transfer_in',
      }),
    ]);

    expect(holdings.find((holding) => holding.venue === 'trade-republic' && holding.symbol === 'EUR')?.amount).toBe(618);
    expect(holdings.find((holding) => holding.venue === 'ing-tagesgeld' && holding.symbol === 'EUR')?.amount).toBe(5300);
    expect(holdings.find((holding) => holding.venue === 'trade-republic' && holding.symbol === 'SPY')?.amount).toBe(1);
  });

  test('settles buys and sells through central investment cash when settlement venue is set', () => {
    const transactions = [
      tx({ id: 'cash-deposit', venue: 'investment-cash', amount: 1000, total: 1000 }),
      tx({
        id: 'buy-etf',
        venue: 'trade-republic',
        settlementVenue: 'investment-cash',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 2,
        price: 100,
        total: 200,
        fee: 1,
        taxType: 'acquisition',
      }),
      tx({
        id: 'sell-etf',
        venue: 'trade-republic',
        settlementVenue: 'investment-cash',
        type: 'sell',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 1,
        price: 120,
        total: 120,
        fee: 1,
        taxType: 'disposal',
      }),
    ];

    const holdings = deriveHoldingsFromTransactions(transactions);

    expect(holdings.find((holding) => holding.venue === 'trade-republic' && holding.symbol === 'SPY')?.amount).toBe(1);
    expect(holdings.find((holding) => holding.venue === 'investment-cash' && holding.symbol === 'EUR')?.amount).toBe(918);
    expect(holdings.find((holding) => holding.venue === 'trade-republic' && holding.symbol === 'EUR')).toBeUndefined();
    expect(validateBuyCashAvailability(transactions.slice(0, 1), transactions[1]).ok).toBe(true);
  });

  test('reports missing cash separately so buys can be blocked before saving', () => {
    const transactions = [
      tx({
        id: 'buy-without-cash',
        venue: 'trade-republic',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 5,
        price: 100,
        total: 500,
        fee: 1,
        taxType: 'acquisition',
      }),
      tx({ id: 'bank-cash', venue: 'ing-tagesgeld', amount: 600, total: 600 }),
    ];

    expect(getCashBalance(transactions, 'trade-republic', 'EUR')).toBe(-501);
    expect(getNegativeCashBalances(transactions)).toEqual([
      expect.objectContaining({ venue: 'trade-republic', symbol: 'EUR', amount: -501 }),
    ]);
    expect(getPositiveCashSources(transactions, 'EUR', 'trade-republic')).toEqual([
      expect.objectContaining({ venue: 'ing-tagesgeld', symbol: 'EUR', amount: 600 }),
    ]);
  });

  test('blocks a buy before saving when the account has no matching cash', () => {
    const buy = tx({
      id: 'blocked-buy',
      venue: 'trade-republic',
      type: 'buy',
      asset: 'SPY',
      assetClass: 'etf',
      amount: 5,
      price: 100,
      total: 500,
      fee: 1,
      taxType: 'acquisition',
    });

    const result = validateBuyCashAvailability([], buy);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        venue: 'trade-republic',
        symbol: 'EUR',
        required: 501,
        available: 0,
        missing: 501,
      }),
    );
    expect(() => assertTransactionsHaveRequiredCash([], [buy])).toThrow(InsufficientCashError);
  });

  test('validates batched cash funding before a buy sequentially', () => {
    const deposit = tx({
      id: 'cash-first',
      venue: 'trade-republic',
      type: 'deposit',
      asset: 'EUR',
      assetClass: 'cash',
      amount: 501,
      total: 501,
      taxType: 'cash_in',
    });
    const buy = tx({
      id: 'buy-after-cash',
      venue: 'trade-republic',
      type: 'buy',
      asset: 'SPY',
      assetClass: 'etf',
      amount: 5,
      price: 100,
      total: 500,
      fee: 1,
      taxType: 'acquisition',
    });

    expect(() => assertTransactionsHaveRequiredCash([], [deposit, buy])).not.toThrow();
    expect(() => assertTransactionsHaveRequiredCash([], [buy, deposit])).toThrow(InsufficientCashError);
  });

  test('does not let a future deposit fund an earlier buy', () => {
    const buy = tx({
      id: 'historical-buy',
      date: '2026-01-01T00:00:00Z',
      type: 'buy',
      asset: 'SPY',
      assetClass: 'etf',
      amount: 5,
      price: 100,
      total: 500,
      fee: 1,
      taxType: 'acquisition',
    });
    const futureDeposit = tx({
      id: 'future-cash',
      date: '2026-02-01T00:00:00Z',
      amount: 501,
      total: 501,
    });

    expect(() =>
      assertTransactionsHaveRequiredCash([], [futureDeposit, buy]),
    ).toThrow(InsufficientCashError);
  });

  test('includes transaction tax in required and settled buy cash', () => {
    const deposit = tx({ id: 'tax-cash', amount: 110, total: 110 });
    const buy = tx({
      id: 'taxed-buy',
      type: 'buy',
      asset: 'SPY',
      assetClass: 'etf',
      amount: 1,
      price: 100,
      total: 100,
      fee: 2,
      taxAmount: 3,
      taxType: 'acquisition',
    });

    expect(validateBuyCashAvailability([deposit], buy)).toEqual(
      expect.objectContaining({ required: 105, available: 110, missing: 0 }),
    );
    expect(
      deriveHoldingsFromTransactions([deposit, buy]).find(
        (holding) => holding.symbol === 'EUR',
      )?.amount,
    ).toBe(5);
  });

  test('manual transaction store rejects unfunded buys before mutation', () => {
    const buy = tx({
      id: 'store-blocked-buy',
      venue: 'trade-republic',
      type: 'buy',
      asset: 'SPY',
      assetClass: 'etf',
      amount: 5,
      price: 100,
      total: 500,
      fee: 1,
      taxType: 'acquisition',
    });
    const deposit = tx({
      id: 'store-cash-first',
      venue: 'trade-republic',
      type: 'deposit',
      asset: 'EUR',
      assetClass: 'cash',
      amount: 501,
      total: 501,
      taxType: 'cash_in',
    });

    expect(() => addManualTransaction(buy)).toThrow(InsufficientCashError);
    expect(() => addManualTransactions([deposit, buy])).not.toThrow();
  });

  test('excludes negative cash from account value and exposes it as a correction', () => {
    const transactions = [
      tx({
        id: 'buy-without-cash',
        venue: 'trade-republic',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 5,
        price: 100,
        total: 500,
        fee: 1,
        taxType: 'acquisition',
      }) as AppTransaction,
    ];
    const holdings = deriveHoldingsFromTransactions(transactions).map((holding) => ({
      symbol: holding.symbol,
      assetClass: holding.assetClass,
      amount: holding.amount,
      avgCost: holding.avgCost,
      value: holding.assetClass === 'cash' ? holding.amount * (holding.avgCost ?? 0) : 500,
      valuationAvailable: true,
      change24h: 0,
      changePeriod: '24h' as const,
      totalFeesEur: 0,
      primaryVenue: holding.venue,
      costBasisAvailable: holding.costBasisAvailable,
      financialMetricsAvailable: holding.costBasisAvailable,
    }));

    const summary = buildAccountSummaries(holdings, 500, transactions).find(
      (account) => account.venue === 'trade-republic',
    );

    expect(summary?.value).toBe(500);
    expect(summary?.negativeCashValue).toBe(-501);
  });

  test('does not partially execute or credit an invalid legacy oversell', () => {
    const transactions = [
      tx({
        id: 'deposit',
        amount: 100,
        total: 100,
      }),
      tx({
        id: 'buy-one',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 1,
        price: 100,
        total: 100,
        taxType: 'acquisition',
      }),
      tx({
        id: 'oversell-two',
        type: 'sell',
        asset: 'SPY',
        assetClass: 'etf',
        amount: 2,
        price: 120,
        total: 240,
        taxType: 'disposal',
      }),
    ];
    const holdings = deriveHoldingsFromTransactions(transactions);

    expect(holdings.find((holding) => holding.symbol === 'SPY')).toEqual(
      expect.objectContaining({ amount: 1, avgCost: 100 }),
    );
    expect(holdings.find((holding) => holding.symbol === 'EUR')).toBeUndefined();
    expect(() => assertTransactionsHaveRequiredCash([], transactions)).toThrow(
      InvalidLedgerError,
    );
  });

  test('tracks non-cash deposits and withdrawals without inventing cash', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({
        id: 'btc-in',
        type: 'deposit',
        asset: 'BTC',
        assetClass: 'crypto',
        amount: 2,
        price: 20_000,
        total: 40_000,
        taxType: 'transfer_in',
      }),
      tx({
        id: 'btc-out',
        date: '2026-01-02T00:00:00Z',
        type: 'withdrawal',
        asset: 'BTC',
        assetClass: 'crypto',
        amount: 0.5,
        price: 20_000,
        total: 10_000,
        taxType: 'transfer_out',
      }),
    ]);

    expect(holdings).toEqual([
      expect.objectContaining({
        symbol: 'BTC',
        amount: 1.5,
        avgCost: 20_000,
        costBasisAvailable: true,
      }),
    ]);
  });

  test('preserves known cost basis across an asset transfer', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({
        id: 'cash',
        amount: 10_000,
        total: 10_000,
      }),
      tx({
        id: 'buy-btc',
        type: 'buy',
        asset: 'BTC',
        assetClass: 'crypto',
        amount: 2,
        price: 2_000,
        total: 4_000,
        taxType: 'acquisition',
      }),
      tx({
        id: 'transfer-out',
        date: '2026-01-02T00:00:00Z',
        type: 'transfer',
        asset: 'BTC',
        assetClass: 'crypto',
        amount: 0.5,
        price: 0,
        total: 0,
        taxType: 'transfer_out',
        transferGroupId: 'transfer-1',
        transferredCostBasisStatus: 'known',
        transferredCostBasisEur: 1_000,
      }),
      tx({
        id: 'transfer-in',
        date: '2026-01-02T00:00:00Z',
        venue: 'cold-wallet',
        type: 'transfer',
        asset: 'BTC',
        assetClass: 'crypto',
        amount: 0.5,
        price: 0,
        total: 0,
        taxType: 'transfer_in',
        transferGroupId: 'transfer-1',
        transferredCostBasisStatus: 'known',
        transferredCostBasisEur: 1_000,
      }),
    ]);

    expect(holdings.find((holding) => holding.venue === 'trade-republic')).toEqual(
      expect.objectContaining({ symbol: 'BTC', amount: 1.5, avgCost: 2_000 }),
    );
    expect(holdings.find((holding) => holding.venue === 'cold-wallet')).toEqual(
      expect.objectContaining({ symbol: 'BTC', amount: 0.5, avgCost: 2_000 }),
    );
  });

  test('marks an unsupported transaction currency unavailable instead of treating it as EUR', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({
        id: 'gbp-deposit',
        asset: 'GBP',
        quote: 'GBP',
        amount: 1000,
        total: 1000,
      }),
      tx({
        id: 'gbp-buy',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        quote: 'GBP',
        amount: 2,
        price: 100,
        total: 200,
        taxType: 'acquisition',
      }),
    ]);

    expect(holdings.find((holding) => holding.symbol === 'SPY')).toEqual(
      expect.objectContaining({
        avgCost: 0,
        costBasisAvailable: false,
      }),
    );
    expect(holdings.find((holding) => holding.symbol === 'GBP')).toEqual(
      expect.objectContaining({
        amount: 800,
        avgCost: 0,
        costBasisAvailable: false,
      }),
    );
  });

  test('does not value USD or USDT with the historical fixed 0.92 rate', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({
        id: 'usd-deposit',
        asset: 'USD',
        quote: 'USD',
        amount: 1000,
        total: 1000,
      }),
      tx({
        id: 'usd-buy',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        quote: 'USD',
        amount: 2,
        price: 100,
        total: 200,
        taxType: 'acquisition',
      }),
    ]);

    expect(holdings.find((holding) => holding.symbol === 'SPY')).toEqual(
      expect.objectContaining({
        avgCost: 0,
        costBasisAvailable: false,
      }),
    );
    expect(holdings.find((holding) => holding.symbol === 'USD')).toEqual(
      expect.objectContaining({
        amount: 800,
        avgCost: 0,
        costBasisAvailable: false,
      }),
    );
  });

  test('marks mixed-currency open lots unavailable instead of treating currencies as 1:1', () => {
    const holdings = deriveHoldingsFromTransactions([
      tx({
        id: 'eur-buy',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        quote: 'EUR',
        amount: 1,
        price: 100,
        total: 100,
        taxType: 'acquisition',
      }),
      tx({
        id: 'gbp-buy',
        type: 'buy',
        asset: 'SPY',
        assetClass: 'etf',
        quote: 'GBP',
        amount: 1,
        price: 90,
        total: 90,
        taxType: 'acquisition',
      }),
    ]);

    expect(holdings.find((holding) => holding.symbol === 'SPY')).toEqual(
      expect.objectContaining({
        amount: 2,
        avgCost: 0,
        costBasisAvailable: false,
      }),
    );
  });
});
