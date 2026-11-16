import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

const LEDGER_EPSILON = 0.0000001;

export type LedgerIssueCode =
  | 'invalid_transaction'
  | 'insufficient_cash'
  | 'insufficient_asset';

export interface LedgerIssue {
  code: LedgerIssueCode;
  transactionId: string;
  venue: string;
  symbol: string;
  required: number;
  available: number;
  missing: number;
}

export interface LedgerReplayResult {
  valid: boolean;
  issues: LedgerIssue[];
  balances: Map<string, number>;
}

export class InvalidLedgerError extends Error {
  constructor(public readonly issue: LedgerIssue) {
    super(
      issue.code === 'insufficient_cash'
        ? `Not enough cash in ${issue.venue}. Required: ${issue.required} ${issue.symbol}. Available: ${issue.available} ${issue.symbol}.`
        : issue.code === 'insufficient_asset'
          ? `Not enough ${issue.symbol} in ${issue.venue}. Required: ${issue.required}. Available: ${issue.available}.`
          : `Transaction ${issue.transactionId} contains invalid ledger values.`,
    );
    this.name = 'InvalidLedgerError';
  }
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeVenue(value: string): string {
  return value.trim().toLowerCase() || 'manual-entry';
}

function balanceKey(venue: string, symbol: string): string {
  return `${normalizeVenue(venue)}::${normalizeSymbol(symbol)}`;
}

function readBalance(
  balances: Map<string, number>,
  venue: string,
  symbol: string,
): number {
  return balances.get(balanceKey(venue, symbol)) ?? 0;
}

function writeBalance(
  balances: Map<string, number>,
  venue: string,
  symbol: string,
  value: number,
): void {
  balances.set(balanceKey(venue, symbol), value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function transactionIsStructurallyValid(transaction: InvestmentTransaction): boolean {
  return Boolean(
    transaction.id.trim()
    && transaction.venue.trim()
    && transaction.asset.trim()
    && transaction.quote.trim()
    && Number.isFinite(new Date(transaction.date).getTime())
    && typeof transaction.amount === 'number'
    && Number.isFinite(transaction.amount)
    && transaction.amount > 0
    && isFiniteNonNegative(transaction.price)
    && isFiniteNonNegative(transaction.total)
    && isFiniteNonNegative(transaction.fee)
    && (
      transaction.taxAmount === undefined
      || isFiniteNonNegative(transaction.taxAmount)
    ),
  );
}

function issue(
  code: LedgerIssueCode,
  transaction: InvestmentTransaction,
  venue: string,
  symbol: string,
  required: number,
  available: number,
): LedgerIssue {
  return {
    code,
    transactionId: transaction.id,
    venue,
    symbol,
    required,
    available,
    missing: Math.max(0, required - available),
  };
}

function orderedTransactions(
  transactions: InvestmentTransaction[],
): InvestmentTransaction[] {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((left, right) => {
      const timeDifference =
        new Date(left.transaction.date).getTime()
        - new Date(right.transaction.date).getTime();
      return timeDifference || left.index - right.index;
    })
    .map(({ transaction }) => transaction);
}

export function replayLedger(
  transactions: InvestmentTransaction[],
): LedgerReplayResult {
  const balances = new Map<string, number>();
  const issues: LedgerIssue[] = [];

  for (const transaction of orderedTransactions(transactions)) {
    const venue = normalizeVenue(transaction.venue);
    const symbol = normalizeSymbol(transaction.asset);

    if (!transactionIsStructurallyValid(transaction)) {
      issues.push(issue('invalid_transaction', transaction, venue, symbol, 0, 0));
      continue;
    }

    if (transaction.assetClass === 'cash') {
      const current = readBalance(balances, venue, symbol);
      const isCredit =
        transaction.type === 'deposit'
        || transaction.type === 'adjustment'
        || (
          transaction.type === 'transfer'
          && transaction.taxType === 'transfer_in'
        );
      const isDebit =
        transaction.type === 'withdrawal'
        || transaction.type === 'fee'
        || (
          transaction.type === 'transfer'
          && transaction.taxType === 'transfer_out'
        );

      if (isCredit) {
        writeBalance(balances, venue, symbol, current + transaction.amount);
      } else if (isDebit) {
        if (current + LEDGER_EPSILON < transaction.amount) {
          issues.push(
            issue(
              'insufficient_cash',
              transaction,
              venue,
              symbol,
              transaction.amount,
              current,
            ),
          );
          continue;
        }
        writeBalance(balances, venue, symbol, current - transaction.amount);
      }
      continue;
    }

    const currentAsset = readBalance(balances, venue, symbol);

    if (
      transaction.type === 'buy'
      || transaction.type === 'deposit'
      || transaction.type === 'adjustment'
      || (
        transaction.type === 'transfer'
        && transaction.taxType === 'transfer_in'
      )
    ) {
      if (transaction.type === 'buy') {
        const cashVenue = normalizeVenue(
          transaction.settlementVenue || transaction.venue,
        );
        const cashSymbol = normalizeSymbol(transaction.quote);
        const availableCash = readBalance(balances, cashVenue, cashSymbol);
        const requiredCash =
          transaction.total
          + transaction.fee
          + (transaction.taxAmount ?? 0);

        if (availableCash + LEDGER_EPSILON < requiredCash) {
          issues.push(
            issue(
              'insufficient_cash',
              transaction,
              cashVenue,
              cashSymbol,
              requiredCash,
              availableCash,
            ),
          );
          continue;
        }

        writeBalance(
          balances,
          cashVenue,
          cashSymbol,
          availableCash - requiredCash,
        );
      }

      writeBalance(
        balances,
        venue,
        symbol,
        currentAsset + transaction.amount,
      );
      continue;
    }

    if (
      transaction.type === 'sell'
      || transaction.type === 'withdrawal'
      || transaction.type === 'fee'
      || (
        transaction.type === 'transfer'
        && transaction.taxType === 'transfer_out'
      )
    ) {
      if (currentAsset + LEDGER_EPSILON < transaction.amount) {
        issues.push(
          issue(
            'insufficient_asset',
            transaction,
            venue,
            symbol,
            transaction.amount,
            currentAsset,
          ),
        );
        continue;
      }

      writeBalance(
        balances,
        venue,
        symbol,
        currentAsset - transaction.amount,
      );

      if (transaction.type === 'sell') {
        const cashVenue = normalizeVenue(
          transaction.settlementVenue || transaction.venue,
        );
        const cashSymbol = normalizeSymbol(transaction.quote);
        const cashBalance = readBalance(balances, cashVenue, cashSymbol);
        const netProceeds = Math.max(
          0,
          transaction.total
          - transaction.fee
          - (transaction.taxAmount ?? 0),
        );
        writeBalance(
          balances,
          cashVenue,
          cashSymbol,
          cashBalance + netProceeds,
        );
      }
      continue;
    }

    if (transaction.type === 'dividend') {
      const cashVenue = normalizeVenue(
        transaction.settlementVenue || transaction.venue,
      );
      const cashSymbol = normalizeSymbol(transaction.quote);
      const cashBalance = readBalance(balances, cashVenue, cashSymbol);
      writeBalance(
        balances,
        cashVenue,
        cashSymbol,
        cashBalance + transaction.total,
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    balances,
  };
}

export function assertLedgerIntegrity(
  transactions: InvestmentTransaction[],
): void {
  const result = replayLedger(transactions);
  if (!result.valid) {
    throw new InvalidLedgerError(result.issues[0]);
  }
}

export function getLedgerBalanceAt(
  transactions: InvestmentTransaction[],
  venue: string,
  symbol: string,
  asOf: string,
): number {
  const asOfTime = new Date(asOf).getTime();
  if (!Number.isFinite(asOfTime)) return 0;

  const result = replayLedger(
    transactions.filter(
      (transaction) => new Date(transaction.date).getTime() <= asOfTime,
    ),
  );
  return result.balances.get(balanceKey(venue, symbol)) ?? 0;
}
