import {
  findAssetByIdentifier,
  type AssetConfig,
  type QuoteCurrency,
} from '@/lib/config/supported-assets';

export const HISTORY_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type HistoryInterval = (typeof HISTORY_INTERVALS)[number];

const HISTORY_CURRENCIES = ['eur', 'usd'] as const;

export interface NormalizedHistoryRequest {
  asset: AssetConfig;
  symbol: string;
  currency: QuoteCurrency;
  interval: HistoryInterval;
}

export class HistoryRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryRequestValidationError';
  }
}

export function normalizeHistoryRequest(
  symbol: string,
  currency = 'eur',
  interval = '1d',
): NormalizedHistoryRequest {
  if (typeof symbol !== 'string' || symbol.length > 64) {
    throw new HistoryRequestValidationError('Unsupported symbol.');
  }

  const asset = findAssetByIdentifier(symbol);
  if (!asset) {
    throw new HistoryRequestValidationError('Unsupported symbol.');
  }

  const normalizedCurrency = currency.trim().toLowerCase();
  if (!HISTORY_CURRENCIES.includes(normalizedCurrency as QuoteCurrency)) {
    throw new HistoryRequestValidationError('Unsupported currency.');
  }

  const normalizedInterval = interval.trim().toLowerCase();
  if (!HISTORY_INTERVALS.includes(normalizedInterval as HistoryInterval)) {
    throw new HistoryRequestValidationError('Unsupported interval.');
  }

  if (asset.assetClass !== 'crypto' && normalizedInterval !== '1d') {
    throw new HistoryRequestValidationError('Intraday history is only available for crypto assets.');
  }

  return {
    asset,
    symbol: asset.symbol,
    currency: normalizedCurrency as QuoteCurrency,
    interval: normalizedInterval as HistoryInterval,
  };
}
