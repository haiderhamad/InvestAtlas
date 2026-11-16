import type { BacktestParameters } from '@/lib/strategy/models';

export const MAX_BACKTEST_DATA_POINTS = 5_000;

const ALLOWED_INTERVALS = new Set(['1h', '4h', '1d', '1w']);

function isFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function isOptionalIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined
    || (
      Number.isInteger(value)
      && isFiniteInRange(value, minimum, maximum)
    )
  );
}

export function isBacktestParameters(
  value: unknown,
): value is BacktestParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.strategyType !== 'single_sma'
    && candidate.strategyType !== 'dual_sma'
  ) {
    return false;
  }

  if (
    !isFiniteInRange(candidate.initialCapital, 1, 1_000_000_000)
    || !isFiniteInRange(candidate.feePercent, 0, 10)
    || !isFiniteInRange(candidate.slippagePercent, 0, 10)
    || !isOptionalIntegerInRange(candidate.minBarsBetweenSignals, 1, 500)
    || !isOptionalIntegerInRange(candidate.candleConfirmation, 1, 10)
    || (
      candidate.interval !== undefined
      && (
        typeof candidate.interval !== 'string'
        || !ALLOWED_INTERVALS.has(candidate.interval)
      )
    )
    || (
      candidate.feeMode !== undefined
      && candidate.feeMode !== 'percent'
      && candidate.feeMode !== 'flat'
    )
    || (
      candidate.flatFeeAmount !== undefined
      && !isFiniteInRange(candidate.flatFeeAmount, 0, 1_000_000)
    )
    || (
      candidate.feeMode === 'flat'
      && !isFiniteInRange(candidate.flatFeeAmount, 0, 1_000_000)
    )
    || (
      candidate.quoteCurrency !== undefined
      && candidate.quoteCurrency !== 'eur'
      && candidate.quoteCurrency !== 'usd'
    )
  ) {
    return false;
  }

  if (candidate.strategyType === 'single_sma') {
    return (
      typeof candidate.smaPeriod === 'number'
      && isOptionalIntegerInRange(candidate.smaPeriod, 2, 500)
    );
  }

  return (
    typeof candidate.fastPeriod === 'number'
    && typeof candidate.slowPeriod === 'number'
    && isOptionalIntegerInRange(candidate.fastPeriod, 2, 500)
    && isOptionalIntegerInRange(candidate.slowPeriod, 3, 500)
    && candidate.fastPeriod < candidate.slowPeriod
  );
}

export function isBacktestSeries(
  prices: unknown,
  dates: unknown,
  maximumDataPoints = MAX_BACKTEST_DATA_POINTS,
): prices is number[] {
  if (
    !Array.isArray(prices)
    || !Array.isArray(dates)
    || prices.length < 10
    || prices.length !== dates.length
    || prices.length > maximumDataPoints
    || !prices.every(
      (price) =>
        typeof price === 'number'
        && Number.isFinite(price)
        && price > 0,
    )
  ) {
    return false;
  }

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const date of dates) {
    if (typeof date !== 'string' || date.length > 40) return false;
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp) || timestamp <= previousTimestamp) {
      return false;
    }
    previousTimestamp = timestamp;
  }

  return true;
}

export function assertValidBacktestInput(
  prices: number[],
  dates: string[],
  parameters: BacktestParameters,
  volumes?: (number | null)[],
): void {
  if (
    !isBacktestParameters(parameters)
    || !isBacktestSeries(prices, dates)
    || (
      volumes !== undefined
      && (
        volumes.length !== prices.length
        || !volumes.every(
          (volume) =>
            volume === null
            || (
              typeof volume === 'number'
              && Number.isFinite(volume)
              && volume >= 0
            ),
        )
      )
    )
  ) {
    throw new Error('Backtest inputs are invalid.');
  }
}
