import type { BacktestFeeMode, BacktestParameters, QuoteCurrency } from '@/lib/strategy/models';

export function resolveBacktestFeeMode(params: BacktestParameters): BacktestFeeMode {
  return params.feeMode ?? 'percent';
}

export function calculateBacktestFee(notional: number, params: BacktestParameters): number {
  const safeNotional = Math.max(0, notional);
  const feeMode = resolveBacktestFeeMode(params);

  if (feeMode === 'flat') {
    return Math.max(0, params.flatFeeAmount ?? 0);
  }

  return safeNotional * Math.max(0, params.feePercent) / 100;
}

export function getQuoteCurrencySymbol(currency: QuoteCurrency = 'eur'): string {
  return currency === 'usd' ? '$' : '€';
}

export function describeBacktestFeeModel(params: BacktestParameters): string {
  const feeMode = resolveBacktestFeeMode(params);
  const symbol = getQuoteCurrencySymbol(params.quoteCurrency ?? 'eur');

  if (feeMode === 'flat') {
    return `${symbol}${(params.flatFeeAmount ?? 0).toFixed(2)} per order`;
  }

  return `${params.feePercent.toFixed(2)}% per trade`;
}
