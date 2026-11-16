import type { PortfolioMonitorPoint } from '@/lib/portfolio/ux-insights';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import { normalizeTransactionToEur } from '@/lib/fx/quote-rates';

export interface BenchmarkComparisonPoint {
  date: string;
  shortDate: string;
  portfolioPct: number;
  benchmarkPct: number;
  realPct: number;
}

export interface MonthlyReturnHeatmapCell {
  year: string;
  month: string;
  returnPct: number | null;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MILLISECONDS_PER_YEAR = 365.2425 * 86_400_000;

function requireEurValue(
  value: number,
  transaction: InvestmentTransaction,
) {
  const converted = normalizeTransactionToEur(value, transaction);
  if (converted === null) {
    throw new Error(`Missing FX conversion for ${transaction.quote}`);
  }
  return converted;
}

function isInvestedAssetTransaction(transaction: InvestmentTransaction) {
  const assetClass = transaction.assetClass?.trim().toLowerCase();
  return assetClass === 'crypto' || assetClass === 'stock' || assetClass === 'stocks' || assetClass === 'etf' || assetClass === 'metal' || assetClass === 'metals';
}

export function buildInvestedPerformanceCashFlows(
  transactions: InvestmentTransaction[],
): Map<string, number> {
  const flows = new Map<string, number>();
  if (
    transactions.some(
      (transaction) =>
        isInvestedAssetTransaction(transaction)
        && ['buy', 'sell', 'deposit', 'withdrawal', 'adjustment'].includes(transaction.type)
        && normalizeTransactionToEur(1, transaction) === null,
    )
  ) {
    return flows;
  }

  for (const transaction of transactions) {
    if (!isInvestedAssetTransaction(transaction)) continue;

    const date = transaction.date.slice(0, 10);
    const fee = transaction.fee || 0;
    let flow = 0;

    if (transaction.type === 'buy' || transaction.type === 'deposit') {
      flow = requireEurValue(
        transaction.total + fee + (transaction.taxAmount ?? 0),
        transaction,
      );
    } else if (transaction.type === 'sell' || transaction.type === 'withdrawal') {
      flow = -requireEurValue(
        Math.max(
          0,
          transaction.total - fee - (transaction.taxAmount ?? 0),
        ),
        transaction,
      );
    } else if (transaction.type === 'adjustment' && transaction.amount > 0) {
      flow = requireEurValue(
        transaction.total + fee + (transaction.taxAmount ?? 0),
        transaction,
      );
    }

    if (flow !== 0) {
      flows.set(date, Number(((flows.get(date) ?? 0) + flow).toFixed(2)));
    }
  }

  return flows;
}

function readFlow(cashFlowsByDate: Map<string, number> | undefined, date: string) {
  return cashFlowsByDate?.get(date) ?? 0;
}

function buildInvestedPortfolioPerformance(
  portfolioSeries: PortfolioMonitorPoint[],
  cashFlowsByDate?: Map<string, number>,
) {
  const sortedSeries = [...portfolioSeries]
    .filter((point) => point.totalReturn > 0 && point.invested > 0)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (sortedSeries.length === 0) return [];

  let cumulativeGrowth = 1;
  let previousValue = sortedSeries[0].totalReturn;
  const performance = [{
    ...sortedSeries[0],
    portfolioPct: 0,
  }];

  for (let index = 1; index < sortedSeries.length; index++) {
    const point = sortedSeries[index];
    const flow = readFlow(cashFlowsByDate, point.date);
    const valueBeforeFlow = point.totalReturn - flow;
    if (
      previousValue <= 0
      || valueBeforeFlow < 0
      || !Number.isFinite(valueBeforeFlow)
    ) {
      return [];
    }

    cumulativeGrowth *= valueBeforeFlow / previousValue;
    if (!Number.isFinite(cumulativeGrowth) || cumulativeGrowth < 0) {
      return [];
    }

    performance.push({
      ...point,
      portfolioPct: Number(((cumulativeGrowth - 1) * 100).toFixed(2)),
    });
    previousValue = point.totalReturn;
  }

  return performance;
}

export function buildBenchmarkComparisonSeries(
  portfolioSeries: PortfolioMonitorPoint[],
  benchmarkHistory: Array<{ date: string; close: number }>,
  annualInflationPct: number,
  cashFlowsByDate?: Map<string, number>,
): BenchmarkComparisonPoint[] {
  const validBenchmarkHistory = benchmarkHistory
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({ date: bar.date.slice(0, 10), close: bar.close }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const portfolioPerformanceSeries = buildInvestedPortfolioPerformance(
    portfolioSeries,
    cashFlowsByDate,
  );
  const comparisonPoints: Array<{
    point: (typeof portfolioPerformanceSeries)[number];
    benchmarkClose: number;
  }> = [];
  let benchmarkIndex = 0;
  let latestBenchmarkClose: number | null = null;

  for (const point of portfolioPerformanceSeries) {
    const pointDate = point.date.slice(0, 10);
    while (
      benchmarkIndex < validBenchmarkHistory.length
      && validBenchmarkHistory[benchmarkIndex].date <= pointDate
    ) {
      latestBenchmarkClose = validBenchmarkHistory[benchmarkIndex].close;
      benchmarkIndex++;
    }

    if (latestBenchmarkClose !== null) {
      comparisonPoints.push({ point, benchmarkClose: latestBenchmarkClose });
    }
  }

  const basePoint = comparisonPoints[0];
  if (!basePoint) {
    return [];
  }

  const benchmarkBase = basePoint.benchmarkClose;
  const portfolioBase = 1 + basePoint.point.portfolioPct / 100;
  const baseTimestamp = Date.parse(basePoint.point.date);

  return comparisonPoints
    .map(({ point, benchmarkClose }) => {
      const portfolioPct = portfolioBase > 0
        ? (((1 + point.portfolioPct / 100) / portfolioBase) - 1) * 100
        : 0;
      const benchmarkPct = ((benchmarkClose - benchmarkBase) / benchmarkBase) * 100;
      const pointTimestamp = Date.parse(point.date);
      const yearsElapsed =
        Number.isFinite(baseTimestamp)
        && Number.isFinite(pointTimestamp)
        && pointTimestamp >= baseTimestamp
          ? (pointTimestamp - baseTimestamp) / MILLISECONDS_PER_YEAR
          : 0;
      const inflationFactor = Math.pow(1 + annualInflationPct / 100, yearsElapsed);
      const realPct = (((1 + portfolioPct / 100) / inflationFactor) - 1) * 100;

      return {
        date: point.date,
        shortDate: point.shortDate,
        portfolioPct: Number(portfolioPct.toFixed(2)),
        benchmarkPct: Number(benchmarkPct.toFixed(2)),
        realPct: Number(realPct.toFixed(2)),
      } satisfies BenchmarkComparisonPoint;
    });
}

export function buildMonthlyReturnHeatmap(
  portfolioSeries: PortfolioMonitorPoint[],
  cashFlowsByDate?: Map<string, number>,
): MonthlyReturnHeatmapCell[] {
  const sortedSeries = [...portfolioSeries]
    .filter((point) => point.totalReturn > 0 && point.invested > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const monthFactors = new Map<string, { factor: number; valid: boolean }>();

  for (const point of sortedSeries) {
    const monthKey = point.date.slice(0, 7);
    if (!monthFactors.has(monthKey)) {
      monthFactors.set(monthKey, { factor: 1, valid: true });
    }
  }

  for (let index = 1; index < sortedSeries.length; index++) {
    const previous = sortedSeries[index - 1];
    const point = sortedSeries[index];
    const monthKey = point.date.slice(0, 7);
    const month = monthFactors.get(monthKey)!;
    const valueBeforeFlow =
      point.totalReturn - readFlow(cashFlowsByDate, point.date);

    if (
      previous.totalReturn <= 0
      || valueBeforeFlow < 0
      || !Number.isFinite(valueBeforeFlow)
    ) {
      month.valid = false;
      continue;
    }

    month.factor *= valueBeforeFlow / previous.totalReturn;
    if (!Number.isFinite(month.factor) || month.factor < 0) {
      month.valid = false;
    }
  }

  return Array.from(monthFactors.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, month]) => {
    const monthIndex = Number(monthKey.slice(5, 7)) - 1;
    const returnPct = month.valid
      ? (month.factor - 1) * 100
      : null;

    return {
      year: monthKey.slice(0, 4),
      month: MONTH_LABELS[monthIndex] ?? monthKey.slice(5, 7),
      returnPct: returnPct === null ? null : Number(returnPct.toFixed(2)),
    };
  });
}
