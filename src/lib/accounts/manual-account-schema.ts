import type { ManualAccount } from '@/lib/accounts/manual-accounts-store';

const ACCOUNT_KINDS = new Set([
  'Brokerage',
  'Bank Account',
  'Savings Account',
  'Exchange',
  'Vault',
  'Other',
]);
const PORTFOLIO_SCOPES = new Set(['portfolio', 'private']);
const CASH_CATEGORIES = new Set(['investment_cash', 'savings_cash']);
const CASH_ROUTES = new Set(['stock', 'etf', 'crypto', 'metal']);
const ALLOWED_KEYS = new Set([
  'id',
  'venue',
  'label',
  'kind',
  'portfolioScope',
  'cashCategory',
  'cashRoutes',
  'archivedAt',
  'needsPortfolioScopeReview',
  'notes',
  'createdAt',
]);

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Account data is not a valid object.');
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error('Account data contains unsupported fields.');
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

function optionalIsoDate(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const date = requireTrimmedString(value, label, 64);
  if (!Number.isFinite(Date.parse(date))) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

export function decodeManualAccount(value: unknown): ManualAccount {
  const account = requireObject(value);
  const kind = requireTrimmedString(account.kind, 'Account kind', 32);
  if (!ACCOUNT_KINDS.has(kind)) {
    throw new Error('Account kind is unsupported.');
  }

  const portfolioScope =
    account.portfolioScope === undefined
      ? 'portfolio'
      : requireTrimmedString(account.portfolioScope, 'Portfolio scope', 32);
  if (!PORTFOLIO_SCOPES.has(portfolioScope)) {
    throw new Error('Portfolio scope is unsupported.');
  }

  const defaultCashCategory =
    kind === 'Savings Account' ? 'savings_cash' : 'investment_cash';
  const cashCategory =
    account.cashCategory === undefined
      ? defaultCashCategory
      : requireTrimmedString(account.cashCategory, 'Cash category', 32);
  if (!CASH_CATEGORIES.has(cashCategory)) {
    throw new Error('Cash category is unsupported.');
  }

  const defaultCashRoutes =
    cashCategory === 'investment_cash' && kind === 'Bank Account'
      ? ['stock', 'etf', 'crypto', 'metal']
      : [];
  const cashRoutes = account.cashRoutes === undefined
    ? defaultCashRoutes
    : account.cashRoutes;
  if (
    !Array.isArray(cashRoutes)
    || cashRoutes.length > 4
    || cashRoutes.some((route) => typeof route !== 'string' || !CASH_ROUTES.has(route))
    || new Set(cashRoutes).size !== cashRoutes.length
  ) {
    throw new Error('Account cash routes are invalid.');
  }

  const notes =
    account.notes === undefined
      ? ''
      : typeof account.notes === 'string' && account.notes.length <= 4_000
        ? account.notes.trim()
        : null;
  if (notes === null) {
    throw new Error('Account notes are invalid.');
  }

  const createdAt = optionalIsoDate(account.createdAt, 'Account creation date');
  if (!createdAt) {
    throw new Error('Account creation date is required.');
  }

  const archivedAt = optionalIsoDate(account.archivedAt, 'Account archive date');
  return {
    id: requireTrimmedString(account.id, 'Account ID', 512),
    venue: requireTrimmedString(account.venue, 'Account venue', 160),
    label: requireTrimmedString(account.label, 'Account label', 160),
    kind: kind as ManualAccount['kind'],
    portfolioScope: portfolioScope as ManualAccount['portfolioScope'],
    cashCategory: cashCategory as ManualAccount['cashCategory'],
    cashRoutes: cashRoutes as ManualAccount['cashRoutes'],
    ...(archivedAt ? { archivedAt } : {}),
    needsPortfolioScopeReview:
      typeof account.needsPortfolioScopeReview === 'boolean'
        ? account.needsPortfolioScopeReview
        : kind === 'Bank Account' && account.portfolioScope === undefined,
    notes,
    createdAt,
  };
}
