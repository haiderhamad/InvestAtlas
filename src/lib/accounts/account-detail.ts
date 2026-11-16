import {
  deriveHoldingsFromTransactions,
  type DerivedHolding,
} from '@/lib/transactions/holdings-engine';
import { normalizeTransactionToEur } from '@/lib/fx/quote-rates';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import type { AppTransaction } from '@/lib/transactions/manual-store';

export interface AccountHistoryPricePoint {
  date: string;
  close: number;
}

export interface AccountMonitorPoint {
  date: string;
  shortDate: string;
  invested: number;
  marketValue: number;
  monthlyDividends: number;
  cumulativeDividends: number;
  cashBalance: number;
  holdingsValue: number;
}

export interface OpenCashBalance {
  symbol: string;
  amount: number;
}

export function listPositiveOpenCashBalances(
  holdings: DerivedHolding[],
): OpenCashBalance[] {
  return holdings
    .filter(
      (holding) =>
        holding.assetClass === 'cash'
        && Number.isFinite(holding.amount)
        && holding.amount > 0.0000001,
    )
    .map((holding) => ({
      symbol: holding.symbol,
      amount: holding.amount,
    }));
}

function requireEurValue(
  value: number,
  transaction: AppTransaction,
) {
  const converted = normalizeTransactionToEur(value, transaction);
  if (converted === null) {
    throw new Error(`Missing FX conversion for ${transaction.quote}`);
  }
  return converted;
}

function toDayKey(date: string) {
  return new Date(date).toISOString().slice(0, 10);
}

function getDayKeys(transactions: AppTransaction[]) {
  if (transactions.length === 0) {
    return [new Date().toISOString().slice(0, 10)];
  }

  const earliest = [...transactions]
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0]
    ?.date;

  if (!earliest) {
    return [new Date().toISOString().slice(0, 10)];
  }

  const dayKeys: string[] = [];
  const start = new Date(earliest);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const end = new Date();

  while (cursor.getTime() <= end.getTime()) {
    dayKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dayKeys;
}

function getEndOfDayTimestamp(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).getTime();
}

function formatDayKey(dayKey: string, locale: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function getPriceAtOrBefore(
  history: AccountHistoryPricePoint[],
  cutoffTimestamp: number,
): number | null {
  const validHistory = history
    .filter(
      (point) =>
        Number.isFinite(point.close)
        && point.close > 0
        && Number.isFinite(new Date(point.date).getTime()),
    )
    .sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime(),
    );
  const cutoffDay = new Date(cutoffTimestamp).toISOString().slice(0, 10);
  const latestHistoryDay = validHistory.at(-1)?.date.slice(0, 10);

  if (!latestHistoryDay || cutoffDay > latestHistoryDay) {
    return null;
  }

  for (let index = validHistory.length - 1; index >= 0; index -= 1) {
    if (new Date(validHistory[index].date).getTime() <= cutoffTimestamp) {
      return validHistory[index].close;
    }
  }

  return null;
}

export function buildAccountMonitorSeries(
  transactions: AppTransaction[],
  historyBySymbol: Record<string, AccountHistoryPricePoint[]>,
  currentPrices: Record<string, number>,
  locale = 'en-US',
): AccountMonitorPoint[] {
  if (
    transactions.some(
      (transaction) => normalizeTransactionToEur(1, transaction) === null,
    )
  ) {
    return [];
  }

  const dayKeys = getDayKeys(transactions);
  const currentDayKey = new Date().toISOString().slice(0, 10);
  let cumulativeDividends = 0;

  return dayKeys.map((dayKey): AccountMonitorPoint | null => {
    const cutoff = getEndOfDayTimestamp(dayKey);
    const dayTransactions = transactions.filter(
      (transaction) => new Date(transaction.date).getTime() <= cutoff,
    );
    const holdings = deriveHoldingsFromTransactions(dayTransactions);
    if (holdings.some((holding) => !holding.costBasisAvailable)) {
      return null;
    }
    const cashBalance = holdings
      .filter((holding) => holding.assetClass === 'cash')
      .reduce((sum, holding) => sum + holding.amount * holding.avgCost, 0);
    let valuationAvailable = true;
    const holdingsValue = holdings.reduce((sum, holding) => {
      if (holding.assetClass === 'cash') {
        return sum;
      }
      const isMetal = holding.assetClass === 'metal';
      if (
        isMetal
        && (
          holding.metalFinenessAvailable !== true
          || typeof holding.fineMetalAmount !== 'number'
          || !Number.isFinite(holding.fineMetalAmount)
          || holding.fineMetalAmount < 0
        )
      ) {
        valuationAvailable = false;
        return sum;
      }
      const history = historyBySymbol[holding.symbol] ?? [];
      const currentPrice = currentPrices[holding.symbol];
      const price =
        dayKey === currentDayKey
        && Number.isFinite(currentPrice)
        && currentPrice > 0
          ? currentPrice
          : getPriceAtOrBefore(history, cutoff);
      if (price === null) {
        valuationAvailable = false;
        return sum;
      }
      const actualPrice = isMetal ? price / TROY_OUNCE_GRAMS : price;
      const valuedAmount =
        isMetal && typeof holding.fineMetalAmount === 'number'
          ? holding.fineMetalAmount
          : holding.amount;
      return sum + valuedAmount * actualPrice;
    }, 0);
    const dayDividends = dayTransactions
      .filter((transaction) => transaction.type === 'dividend' && toDayKey(transaction.date) === dayKey)
      .reduce(
        (sum, transaction) =>
          sum + requireEurValue(transaction.total, transaction),
        0,
      );

    cumulativeDividends += dayDividends;

    if (!valuationAvailable) {
      return null;
    }

    return {
      date: dayKey,
      shortDate: formatDayKey(dayKey, locale),
      invested: Number(
        (
          holdings
            .filter((holding) => holding.assetClass !== 'cash')
            .reduce((sum, holding) => sum + holding.amount * holding.avgCost, 0) + cashBalance
        ).toFixed(2),
      ),
      marketValue: Number((holdingsValue + cashBalance).toFixed(2)),
      monthlyDividends: Number(dayDividends.toFixed(2)),
      cumulativeDividends: Number(cumulativeDividends.toFixed(2)),
      cashBalance,
      holdingsValue: Number(holdingsValue.toFixed(2)),
    } satisfies AccountMonitorPoint;
  }).filter((point): point is AccountMonitorPoint => point !== null);
}
