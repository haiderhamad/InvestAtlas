import { calculateMetrics } from './metrics';
import type { BacktestMetrics } from './types';

export type BuyAndHoldMetrics = Pick<
  BacktestMetrics,
  | 'totalReturnPct'
  | 'annualizedReturnPct'
  | 'maxDrawdownPct'
  | 'drawdownDurationDays'
  | 'volatility'
  | 'sharpeRatio'
  | 'sortinoRatio'
  | 'beta'
  | 'calmarRatio'
  | 'bestYear'
  | 'worstYear'
>;

export function calculateBuyAndHoldMetrics(
  prices: number[],
  dates: string[],
  initialCapital: number,
  interval = '1d',
): BuyAndHoldMetrics | null {
  if (
    prices.length < 2
    || prices.length !== dates.length
    || !Number.isFinite(initialCapital)
    || initialCapital <= 0
    || prices.some((price) => !Number.isFinite(price) || price <= 0)
  ) {
    return null;
  }

  const timestamps = dates.map((date) => Date.parse(date));
  if (
    timestamps.some(
      (timestamp, index) =>
        !Number.isFinite(timestamp)
        || (index > 0 && timestamp <= timestamps[index - 1]),
    )
  ) {
    return null;
  }

  const firstPrice = prices[0];
  const equityCurve = prices.map(
    (price) => initialCapital * (price / firstPrice),
  );
  const metrics = calculateMetrics(
    [],
    equityCurve,
    prices,
    initialCapital,
    prices.length,
    dates,
    interval,
  );

  return {
    totalReturnPct: metrics.totalReturnPct,
    annualizedReturnPct: metrics.annualizedReturnPct,
    maxDrawdownPct: metrics.maxDrawdownPct,
    drawdownDurationDays: metrics.drawdownDurationDays,
    volatility: metrics.volatility,
    sharpeRatio: metrics.sharpeRatio,
    sortinoRatio: metrics.sortinoRatio,
    beta: metrics.beta,
    calmarRatio: metrics.calmarRatio,
    bestYear: metrics.bestYear,
    worstYear: metrics.worstYear,
  };
}
