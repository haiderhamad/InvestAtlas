import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import {
  getLedgerBalanceAt,
  InvalidLedgerError,
  replayLedger,
} from '@/lib/transactions/ledger-validation';

const CASH_EPSILON = 0.0000001;

export interface CashBalance {
  venue: string;
  symbol: string;
  amount: number;
  value: number;
  valuationAvailable: boolean;
}

export interface BuyCashValidationResult {
  ok: boolean;
  transactionId: string;
  venue: string;
  symbol: string;
  required: number;
  available: number;
  missing: number;
}

export class InsufficientCashError extends Error {
  result: BuyCashValidationResult;

  constructor(result: BuyCashValidationResult) {
    super(
      `Not enough cash in ${result.venue}. Required: ${result.required} ${result.symbol}. Available: ${result.available} ${result.symbol}. Missing: ${result.missing} ${result.symbol}.`,
    );
    this.name = 'InsufficientCashError';
    this.result = result;
  }
}

export function getCashBalances(
  transactions: InvestmentTransaction[],
  options: { excludeTransactionId?: string } = {},
): CashBalance[] {
  const sourceTransactions = options.excludeTransactionId
    ? transactions.filter((transaction) => transaction.id !== options.excludeTransactionId)
    : transactions;

  return deriveHoldingsFromTransactions(sourceTransactions)
    .filter((holding) => holding.assetClass === 'cash')
    .map((holding) => ({
      venue: holding.venue,
      symbol: holding.symbol.trim().toUpperCase(),
      amount: holding.amount,
      value:
        holding.costBasisAvailable
          ? holding.amount * holding.avgCost
          : 0,
      valuationAvailable: holding.costBasisAvailable,
    }));
}

export function getCashBalance(
  transactions: InvestmentTransaction[],
  venue: string,
  symbol: string,
  options: { excludeTransactionId?: string } = {},
) {
  const normalizedVenue = venue.trim().toLowerCase();
  const normalizedSymbol = symbol.trim().toUpperCase();

  return getCashBalances(transactions, options)
    .filter(
      (balance) =>
        balance.venue.trim().toLowerCase() === normalizedVenue &&
        balance.symbol === normalizedSymbol,
    )
    .reduce((sum, balance) => sum + balance.amount, 0);
}

export function getNegativeCashBalances(transactions: InvestmentTransaction[]) {
  return getCashBalances(transactions).filter((balance) => balance.amount < -CASH_EPSILON);
}

export function getPositiveCashSources(
  transactions: InvestmentTransaction[],
  symbol: string,
  excludeVenue?: string,
) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExcludeVenue = excludeVenue?.trim().toLowerCase();

  return getCashBalances(transactions)
    .filter(
      (balance) =>
        balance.symbol === normalizedSymbol &&
        balance.amount > 0.0000001 &&
        balance.venue.trim().toLowerCase() !== normalizedExcludeVenue,
    )
    .sort((left, right) => right.amount - left.amount);
}

export function validateBuyCashAvailability(
  transactions: InvestmentTransaction[],
  transaction: InvestmentTransaction,
  options: { excludeTransactionId?: string } = {},
): BuyCashValidationResult {
  const symbol = transaction.quote.trim().toUpperCase();
  const venue = transaction.settlementVenue?.trim() || transaction.venue.trim();
  const required = transaction.type === 'buy' && transaction.assetClass !== 'cash'
    ? Number((
        (Number(transaction.total) || 0)
        + (Number(transaction.fee) || 0)
        + (Number(transaction.taxAmount) || 0)
      ).toFixed(2))
    : 0;
  const available = required > 0
    ? getLedgerBalanceAt(
        options.excludeTransactionId
          ? transactions.filter(
              (candidate) => candidate.id !== options.excludeTransactionId,
            )
          : transactions,
        venue,
        symbol,
        transaction.date,
      )
    : 0;
  const missing = Math.max(0, Number((required - available).toFixed(2)));

  return {
    ok: required <= 0 || available + CASH_EPSILON >= required,
    transactionId: transaction.id,
    venue,
    symbol,
    required,
    available: Number(available.toFixed(2)),
    missing,
  };
}

export function assertBuyCashAvailability(
  transactions: InvestmentTransaction[],
  transaction: InvestmentTransaction,
  options: { excludeTransactionId?: string } = {},
) {
  const result = validateBuyCashAvailability(transactions, transaction, options);
  if (!result.ok) {
    throw new InsufficientCashError(result);
  }
}

export function assertTransactionsHaveRequiredCash(
  existingTransactions: InvestmentTransaction[],
  transactionsToAdd: InvestmentTransaction[],
) {
  const result = replayLedger([...existingTransactions, ...transactionsToAdd]);
  const firstIssue = result.issues[0];
  if (!firstIssue) return;

  if (firstIssue.code === 'insufficient_cash') {
    throw new InsufficientCashError({
      ok: false,
      transactionId: firstIssue.transactionId,
      venue: firstIssue.venue,
      symbol: firstIssue.symbol,
      required: Number(firstIssue.required.toFixed(2)),
      available: Number(firstIssue.available.toFixed(2)),
      missing: Number(firstIssue.missing.toFixed(2)),
    });
  }

  throw new InvalidLedgerError(firstIssue);
}
