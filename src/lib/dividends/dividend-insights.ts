import type { DerivedHolding } from '@/lib/transactions/holdings-engine';
import type { AppTransaction } from '@/lib/transactions/manual-store';
import { normalizeTransactionToEur } from '@/lib/fx/quote-rates';

function toMonthKey(date: string) {
  return new Date(date).toISOString().slice(0, 7);
}

function cadenceFromAverageGap(days: number) {
  if (days <= 45) return { label: 'Monthly', days: 30, confidence: 'high' as const };
  if (days <= 120) return { label: 'Quarterly', days: 90, confidence: 'high' as const };
  if (days <= 240) return { label: 'Semi-Annual', days: 180, confidence: 'medium' as const };
  return { label: 'Annual', days: 365, confidence: 'medium' as const };
}

export interface DividendAnnualTotal {
  year: string;
  total: number;
  payments: number;
}

export interface DividendMonthlyTotal {
  month: string;
  shortLabel: string;
  total: number;
}

export interface DividendAssetInsight {
  symbol: string;
  payments: number;
  totalAllTime: number;
  trailing12Months: number;
  lastAmount: number;
  averageAmount: number;
  cadenceLabel: string;
  nextExpectedDate: string | null;
  nextExpectedAmount: number | null;
  forecast12Months: number;
  yieldOnCostPct: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface DividendCalendarItem {
  date: string;
  symbol: string;
  amount: number;
  cadenceLabel: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DividendInsights {
  calculationStatus: 'calculated' | 'insufficient_fx_data';
  missingFxQuotes: string[];
  allTimeTotal: number;
  trailing12Months: number;
  forecast12Months: number;
  averageMonthlyTrailing: number;
  annualTotals: DividendAnnualTotal[];
  monthlyTotals: DividendMonthlyTotal[];
  assets: DividendAssetInsight[];
  calendar: DividendCalendarItem[];
}

export interface DividendInsightsOptions {
  asOf?: string | number | Date;
  locale?: string;
}

function resolveAsOfTimestamp(asOf: DividendInsightsOptions['asOf']): number {
  if (asOf === undefined) {
    return Date.now();
  }

  const timestamp = asOf instanceof Date
    ? asOf.getTime()
    : typeof asOf === 'number'
      ? asOf
      : new Date(asOf).getTime();

  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function buildDividendInsights(
  transactions: AppTransaction[],
  holdings: DerivedHolding[],
  options: DividendInsightsOptions = {},
): DividendInsights {
  const asOf = resolveAsOfTimestamp(options.asOf);
  const locale = options.locale ?? 'en-US';
  const missingFxQuotes = Array.from(new Set(
    transactions
      .filter(
        (transaction) =>
          transaction.type === 'dividend'
          && Number.isFinite(new Date(transaction.date).getTime())
          && new Date(transaction.date).getTime() <= asOf
          && normalizeTransactionToEur(1, transaction) === null,
      )
      .map((transaction) => transaction.quote.trim().toUpperCase()),
  )).sort();
  if (missingFxQuotes.length > 0) {
    return {
      calculationStatus: 'insufficient_fx_data',
      missingFxQuotes,
      allTimeTotal: 0,
      trailing12Months: 0,
      forecast12Months: 0,
      averageMonthlyTrailing: 0,
      annualTotals: [],
      monthlyTotals: [],
      assets: [],
      calendar: [],
    };
  }

  const dividendTransactions = transactions
    .filter((transaction) => transaction.type === 'dividend')
    .map((transaction) => ({
      ...transaction,
      totalEur: normalizeTransactionToEur(
        transaction.total,
        transaction,
      ) as number,
      timestamp: new Date(transaction.date).getTime(),
    }))
    .filter((transaction) => Number.isFinite(transaction.timestamp) && transaction.timestamp <= asOf)
    .sort((left, right) => left.timestamp - right.timestamp);

  const trailingStart = asOf - 365 * 86_400_000;
  const horizonEnd = asOf + 365 * 86_400_000;

  const annualMap = new Map<string, DividendAnnualTotal>();
  const trailingMonthlyMap = new Map<string, number>();
  const byAsset = new Map<string, typeof dividendTransactions>();

  for (const transaction of dividendTransactions) {
    const year = new Date(transaction.date).getUTCFullYear().toString();
    const month = toMonthKey(transaction.date);

    annualMap.set(year, {
      year,
      total: Number(((annualMap.get(year)?.total ?? 0) + transaction.totalEur).toFixed(2)),
      payments: (annualMap.get(year)?.payments ?? 0) + 1,
    });
    if (transaction.timestamp >= trailingStart) {
      trailingMonthlyMap.set(
        month,
        Number(((trailingMonthlyMap.get(month) ?? 0) + transaction.totalEur).toFixed(2)),
      );
    }
    const symbol = transaction.asset.trim().toUpperCase();
    byAsset.set(symbol, [...(byAsset.get(symbol) ?? []), transaction]);
  }

  const assets: DividendAssetInsight[] = [...byAsset.entries()]
    .map(([symbol, items]) => {
      const amounts = items.map((item) => item.totalEur);
      const lastDate = new Date(items[items.length - 1].date);
      const recentAmounts = amounts.slice(-Math.min(4, amounts.length));
      const averageAmount =
        recentAmounts.length > 0
          ? recentAmounts.reduce((sum, amount) => sum + amount, 0) / recentAmounts.length
          : 0;
      const totalAllTime = amounts.reduce((sum, amount) => sum + amount, 0);
      const trailing12Months = items
        .filter((item) => item.timestamp >= trailingStart && item.timestamp <= asOf)
        .reduce((sum, item) => sum + item.totalEur, 0);

      let cadenceLabel = 'Manual';
      let cadenceDays: number | null = null;
      let confidence: 'high' | 'medium' | 'low' = 'low';

      if (items.length >= 2) {
        const gaps: number[] = [];
        for (let index = 1; index < items.length; index += 1) {
          gaps.push(
            (new Date(items[index].date).getTime() - new Date(items[index - 1].date).getTime()) /
              86_400_000,
          );
        }
        const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
        const cadence = cadenceFromAverageGap(averageGap);
        cadenceLabel = cadence.label;
        cadenceDays = cadence.days;
        confidence = cadence.confidence;
      }

      const nextExpectedDate =
        cadenceDays !== null ? new Date(lastDate.getTime() + cadenceDays * 86_400_000).toISOString() : null;
      const forecast12Months =
        cadenceDays !== null && averageAmount > 0
          ? Number(((365 / cadenceDays) * averageAmount).toFixed(2))
          : Number(averageAmount.toFixed(2));
      const assetClass = items[0]?.assetClass;
      const matchingHoldings = holdings.filter(
        (holding) =>
          holding.symbol.trim().toUpperCase() === symbol
          && holding.assetClass === assetClass,
      );
      const costBasisAvailable = (
        matchingHoldings.length > 0
        && matchingHoldings.every(
          (holding) =>
            holding.costBasisAvailable
            && Number.isFinite(holding.amount)
            && holding.amount > 0
            && Number.isFinite(holding.avgCost)
            && holding.avgCost >= 0,
        )
      );
      const costBasis = costBasisAvailable
        ? matchingHoldings.reduce(
            (sum, holding) => sum + holding.amount * holding.avgCost,
            0,
          )
        : 0;

      return {
        symbol,
        payments: items.length,
        totalAllTime: Number(totalAllTime.toFixed(2)),
        trailing12Months: Number(trailing12Months.toFixed(2)),
        lastAmount: Number((amounts[amounts.length - 1] ?? 0).toFixed(2)),
        averageAmount: Number(averageAmount.toFixed(2)),
        cadenceLabel,
        nextExpectedDate,
        nextExpectedAmount: cadenceDays !== null ? Number(averageAmount.toFixed(2)) : null,
        forecast12Months,
        yieldOnCostPct: costBasis > 0 ? Number(((trailing12Months / costBasis) * 100).toFixed(2)) : null,
        confidence,
      } satisfies DividendAssetInsight;
    })
    .sort((left, right) => right.trailing12Months - left.trailing12Months);

  const calendar: DividendCalendarItem[] = [];
  for (const asset of assets) {
    if (!asset.nextExpectedDate || !asset.nextExpectedAmount) {
      continue;
    }

    const cadenceDays =
      asset.cadenceLabel === 'Monthly'
        ? 30
        : asset.cadenceLabel === 'Quarterly'
        ? 90
        : asset.cadenceLabel === 'Semi-Annual'
        ? 180
        : asset.cadenceLabel === 'Annual'
        ? 365
        : null;

    if (!cadenceDays) {
      continue;
    }

    let cursor = new Date(asset.nextExpectedDate).getTime();
    while (cursor < asOf) {
      cursor += cadenceDays * 86_400_000;
    }
    while (cursor <= horizonEnd) {
      calendar.push({
        date: new Date(cursor).toISOString(),
        symbol: asset.symbol,
        amount: asset.nextExpectedAmount,
        cadenceLabel: asset.cadenceLabel,
        confidence: asset.confidence,
      });
      cursor += cadenceDays * 86_400_000;
    }
  }

  const monthlyTotals = [...trailingMonthlyMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, total]) => ({
      month,
      shortLabel: new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(`${month}-01T00:00:00Z`)),
      total,
    }));

  const trailingTotal = dividendTransactions
    .filter((transaction) => transaction.timestamp >= trailingStart)
    .reduce((sum, transaction) => sum + transaction.totalEur, 0);

  return {
    calculationStatus: 'calculated',
    missingFxQuotes: [],
    allTimeTotal: Number(
      dividendTransactions.reduce((sum, transaction) => sum + transaction.totalEur, 0).toFixed(2),
    ),
    trailing12Months: Number(trailingTotal.toFixed(2)),
    forecast12Months: Number(assets.reduce((sum, asset) => sum + asset.forecast12Months, 0).toFixed(2)),
    averageMonthlyTrailing: Number((trailingTotal / 12).toFixed(2)),
    annualTotals: [...annualMap.values()].sort((left, right) => right.year.localeCompare(left.year)),
    monthlyTotals,
    assets,
    calendar: calendar.sort((left, right) => left.date.localeCompare(right.date)).slice(0, 18),
  };
}
