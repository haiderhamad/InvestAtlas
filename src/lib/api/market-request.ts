import type { QuoteCurrency } from '@/lib/config/supported-assets';

const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_HISTORY_DAYS = new Set([1, 7, 14, 30, 90, 180, 365]);

export class MarketRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketRequestValidationError';
  }
}

export function parseQuoteCurrency(
  value: string | null | undefined,
  fallback: QuoteCurrency = 'eur',
): QuoteCurrency {
  const normalized = (value ?? fallback).trim().toLowerCase();
  if (normalized !== 'eur' && normalized !== 'usd') {
    throw new MarketRequestValidationError('Unsupported quote currency');
  }
  return normalized;
}

export function parseMarketSymbols(
  value: string | null | undefined,
  fallback: string,
  maximum = 25,
): string[] {
  const rawSymbols = (value ?? fallback).split(',');
  if (rawSymbols.length > maximum) {
    throw new MarketRequestValidationError('Too many symbols');
  }

  const symbols = [
    ...new Set(
      rawSymbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];

  if (
    symbols.length === 0
    || symbols.length > maximum
    || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))
  ) {
    throw new MarketRequestValidationError('Invalid symbol list');
  }

  return symbols;
}

export function parseAssetSearchQuery(value: string | null): string {
  const query = value?.trim() ?? '';
  if (
    query.length < 1
    || query.length > 64
    || /[\u0000-\u001f\u007f]/.test(query)
  ) {
    throw new MarketRequestValidationError('Invalid search query');
  }
  return query;
}

export function parseHistoryDays(value: string | null | undefined): number {
  const parsed = Number(value ?? 365);
  if (!Number.isInteger(parsed) || !ALLOWED_HISTORY_DAYS.has(parsed)) {
    throw new MarketRequestValidationError('Unsupported history range');
  }
  return parsed;
}

export function parseIsoDate(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new MarketRequestValidationError('Invalid date');
  }

  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new MarketRequestValidationError('Invalid date');
  }
  return value;
}

export function requireAllowlistedValue(
  value: string | null,
  allowlist: ReadonlySet<string>,
  label: string,
): string {
  if (!value || !allowlist.has(value)) {
    throw new MarketRequestValidationError(`Unsupported ${label}`);
  }
  return value;
}
