import type {
  InvestmentTransaction,
  InvestmentTransactionType,
  InvestmentTaxType,
} from '@/lib/tax/investment-tax';
import {
  TRANSACTION_FX_SOURCES,
  type TransactionFxSource,
} from '@/lib/fx/quote-rates';
import { parseLegacyMetalFineness } from '@/lib/metals/metal-purity';

const TRANSACTION_TYPES = new Set([
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'dividend',
  'transfer',
  'fee',
  'adjustment',
]);
const ASSET_CLASSES = new Set(['crypto', 'stock', 'etf', 'metal', 'cash']);
const TAX_TYPES = new Set([
  'acquisition',
  'disposal',
  'transfer_in',
  'transfer_out',
  'dividend_income',
  'fee_expense',
  'adjustment',
  'cash_in',
  'cash_out',
]);
const FEE_MODES = new Set(['none', 'percent', 'flat']);
const ALLOWED_KEYS = new Set([
  'id',
  'date',
  'venue',
  'settlementVenue',
  'type',
  'asset',
  'assetName',
  'assetClass',
  'quote',
  'amount',
  'price',
  'total',
  'fee',
  'taxAmount',
  'taxType',
  'source',
  'notes',
  'updatedAt',
  'feeMode',
  'transferGroupId',
  'transferredCostBasisEur',
  'transferredCostBasisStatus',
  'metalFineness',
  'fxRateToEur',
  'fxRateSource',
  'fxRateDate',
]);

export interface DecodeInvestmentTransactionOptions {
  /**
   * Existing local/cloud ledgers may predate the structured fineness field.
   * Reads may preserve those rows so the UI can request a correction, while
   * every new or updated metal write remains strict.
   */
  allowMissingLegacyMetalFineness?: boolean;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction data is not a valid object.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error('Transaction data contains unsupported fields.');
  }
  return record;
}

function requireTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, label, minimum, maximum);
}

function requireIsoDate(value: unknown, label: string): string {
  const date = requireTrimmedString(value, label, 64);
  if (!Number.isFinite(Date.parse(date))) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function requireIsoDay(value: unknown, label: string): string {
  const date = requireTrimmedString(value, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function isValidTaxType(
  type: InvestmentTransactionType,
  taxType: InvestmentTaxType,
  assetClass: InvestmentTransaction['assetClass'],
): boolean {
  switch (type) {
    case 'buy':
      return taxType === 'acquisition';
    case 'sell':
      return taxType === 'disposal';
    case 'deposit':
      return taxType === (assetClass === 'cash' ? 'cash_in' : 'transfer_in');
    case 'withdrawal':
      return taxType === (assetClass === 'cash' ? 'cash_out' : 'transfer_out');
    case 'dividend':
      return taxType === 'dividend_income';
    case 'transfer':
      return taxType === 'transfer_in' || taxType === 'transfer_out';
    case 'fee':
      return taxType === 'fee_expense';
    case 'adjustment':
      return taxType === 'adjustment';
  }
}

export function decodeInvestmentTransaction(
  value: unknown,
  options: DecodeInvestmentTransactionOptions | number = {},
): InvestmentTransaction {
  // Numeric second arguments are Array.map indexes from existing import paths.
  const decodeOptions =
    typeof options === 'number' ? {} : options;
  const transaction = requireObject(value);
  const type = requireTrimmedString(transaction.type, 'Transaction type', 32);
  const assetClass = requireTrimmedString(transaction.assetClass, 'Asset class', 16);
  const taxType = requireTrimmedString(transaction.taxType, 'Tax type', 32);

  if (!TRANSACTION_TYPES.has(type) || !ASSET_CLASSES.has(assetClass) || !TAX_TYPES.has(taxType)) {
    throw new Error('Transaction classification is unsupported.');
  }
  if (!isValidTaxType(
    type as InvestmentTransactionType,
    taxType as InvestmentTaxType,
    assetClass as InvestmentTransaction['assetClass'],
  )) {
    throw new Error('Transaction tax classification is inconsistent.');
  }

  const asset = requireTrimmedString(transaction.asset, 'Asset symbol', 64).toUpperCase();
  const quote = requireTrimmedString(transaction.quote, 'Quote currency', 16).toUpperCase();
  const date = requireIsoDate(transaction.date, 'Transaction date');
  if (
    !/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(asset)
    || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(quote)
  ) {
    throw new Error('Transaction symbol or quote currency is invalid.');
  }

  const source =
    transaction.source === undefined ? 'manual' : transaction.source;
  if (source !== 'manual' && source !== 'broker') {
    throw new Error('Transaction source is unsupported.');
  }

  const fxFieldCount = [
    transaction.fxRateToEur,
    transaction.fxRateSource,
    transaction.fxRateDate,
  ].filter((value) => value !== undefined).length;
  let fxRateToEur: number | undefined;
  let fxRateSource: TransactionFxSource | undefined;
  let fxRateDate: string | undefined;

  if (quote === 'EUR' && fxFieldCount > 0) {
    throw new Error('EUR transactions must not contain FX metadata.');
  }
  if (quote !== 'EUR' && fxFieldCount > 0 && fxFieldCount !== 3) {
    throw new Error('Transaction FX metadata is incomplete.');
  }
  if (fxFieldCount === 3) {
    fxRateToEur = requireFiniteNumber(
      transaction.fxRateToEur,
      'Transaction FX rate',
      0.000000000001,
      1_000_000,
    );
    const rawFxSource = requireTrimmedString(
      transaction.fxRateSource,
      'Transaction FX source',
      32,
    ) as TransactionFxSource;
    if (!TRANSACTION_FX_SOURCES.includes(rawFxSource)) {
      throw new Error('Transaction FX source is unsupported.');
    }
    fxRateSource = rawFxSource;
    fxRateDate = requireIsoDay(transaction.fxRateDate, 'Transaction FX date');

    const transactionTimestamp = Date.parse(date);
    const fxTimestamp = Date.parse(`${fxRateDate}T00:00:00Z`);
    if (Math.abs(transactionTimestamp - fxTimestamp) > 7 * 86_400_000) {
      throw new Error('Transaction FX date is too far from the transaction.');
    }
  }

  const feeMode = transaction.feeMode === undefined
    ? undefined
    : requireTrimmedString(transaction.feeMode, 'Fee mode', 16);
  if (feeMode !== undefined && !FEE_MODES.has(feeMode)) {
    throw new Error('Fee mode is unsupported.');
  }

  const transferredCostBasisStatus = transaction.transferredCostBasisStatus;
  if (
    transferredCostBasisStatus !== undefined
    && transferredCostBasisStatus !== 'known'
    && transferredCostBasisStatus !== 'unknown'
  ) {
    throw new Error('Transferred cost-basis status is invalid.');
  }
  const transferredCostBasisEur = optionalFiniteNumber(
    transaction.transferredCostBasisEur,
    'Transferred cost basis',
    0,
    1e18,
  );
  if (
    (transferredCostBasisEur !== undefined && transferredCostBasisStatus !== 'known')
    || (transferredCostBasisStatus === 'known' && transferredCostBasisEur === undefined)
  ) {
    throw new Error('Transferred cost basis is inconsistent.');
  }

  const notes = optionalString(transaction.notes, 'Transaction notes', 4_000);
  const explicitMetalFineness = optionalFiniteNumber(
    transaction.metalFineness,
    'Metal fineness',
    1,
    1_000,
  );
  let metalFineness: number | undefined;

  if (assetClass === 'metal') {
    metalFineness =
      explicitMetalFineness
      ?? parseLegacyMetalFineness(notes, asset);
    if (
      metalFineness === undefined
      && !decodeOptions.allowMissingLegacyMetalFineness
    ) {
      throw new Error('Metal fineness is required.');
    }
  } else if (explicitMetalFineness !== undefined) {
    throw new Error('Metal fineness is only valid for metal transactions.');
  }

  return {
    id: requireTrimmedString(transaction.id, 'Transaction ID', 512),
    date,
    venue: requireTrimmedString(transaction.venue, 'Transaction venue', 160),
    settlementVenue:
      transaction.settlementVenue === undefined
        ? undefined
        : requireTrimmedString(transaction.settlementVenue, 'Settlement venue', 160),
    type: type as InvestmentTransactionType,
    asset,
    assetName: optionalString(transaction.assetName, 'Asset name', 256),
    assetClass: assetClass as InvestmentTransaction['assetClass'],
    quote,
    amount: requireFiniteNumber(transaction.amount, 'Transaction amount', 1e-12, 1e15),
    price: requireFiniteNumber(transaction.price, 'Transaction price', 0, 1e15),
    total: requireFiniteNumber(transaction.total, 'Transaction total', 0, 1e18),
    fee: requireFiniteNumber(transaction.fee, 'Transaction fee', 0, 1e15),
    taxAmount: optionalFiniteNumber(transaction.taxAmount, 'Transaction tax', 0, 1e15),
    taxType: taxType as InvestmentTaxType,
    source,
    notes,
    updatedAt:
      transaction.updatedAt === undefined
        ? undefined
        : requireIsoDate(transaction.updatedAt, 'Transaction update date'),
    feeMode: feeMode as InvestmentTransaction['feeMode'],
    transferGroupId:
      transaction.transferGroupId === undefined
        ? undefined
        : requireTrimmedString(transaction.transferGroupId, 'Transfer group', 160),
    transferredCostBasisEur,
    transferredCostBasisStatus,
    metalFineness,
    fxRateToEur,
    fxRateSource,
    fxRateDate,
  };
}
