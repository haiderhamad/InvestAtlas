export const QUOTE_TO_EUR_RATE: Record<string, number> = {
  EUR: 1,
};

export const TRANSACTION_FX_SOURCES = [
  'broker_statement',
  'market_provider',
  'user_entered',
] as const;

export type TransactionFxSource = (typeof TRANSACTION_FX_SOURCES)[number];

export interface TransactionFxInput {
  quote: string;
  fxRateToEur?: number;
  fxRateSource?: TransactionFxSource;
  fxRateDate?: string;
}

export function normalizeToEur(value: number, quote: string): number | null {
  const rate = QUOTE_TO_EUR_RATE[quote.trim().toUpperCase()];
  return (
    typeof rate === 'number'
    && Number.isFinite(value)
  )
    ? value * rate
    : null;
}

export function hasCompleteTransactionFx(
  transaction: TransactionFxInput,
): boolean {
  if (transaction.quote.trim().toUpperCase() === 'EUR') return true;

  return (
    typeof transaction.fxRateToEur === 'number'
    && Number.isFinite(transaction.fxRateToEur)
    && transaction.fxRateToEur > 0
    && TRANSACTION_FX_SOURCES.includes(
      transaction.fxRateSource as TransactionFxSource,
    )
    && typeof transaction.fxRateDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(transaction.fxRateDate)
    && Number.isFinite(Date.parse(`${transaction.fxRateDate}T00:00:00Z`))
  );
}

export function normalizeTransactionToEur(
  value: number,
  transaction: TransactionFxInput,
): number | null {
  const direct = normalizeToEur(value, transaction.quote);
  if (direct !== null) return direct;
  if (!Number.isFinite(value) || !hasCompleteTransactionFx(transaction)) {
    return null;
  }

  return value * transaction.fxRateToEur!;
}

export function canNormalizeToEur(quote: string): boolean {
  return typeof QUOTE_TO_EUR_RATE[quote.trim().toUpperCase()] === 'number';
}
