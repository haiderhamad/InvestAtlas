import type { AssetClass } from '@/lib/config/supported-assets';
import type { PortfolioGrowthPoint } from '@/lib/demo/investment-data';
import { getDemoSnapshotAsOfDay, INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import type { InvestmentTaxOverview, InvestmentTransaction } from '@/lib/tax/investment-tax';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import { normalizeTransactionToEur } from '@/lib/fx/quote-rates';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import type { LanguagePreference } from '@/lib/preferences/app-preferences';

export interface HoldingLedgerInsight {
  symbol: string;
  primaryVenue: string;
  venues: string[];
  tradeCount: number;
  totalFeesEur: number;
  realizedPnl: number;
  firstAcquiredAt: string | null;
  oldestOpenLotAt: string | null;
  lastTradeAt: string | null;
  holdingDays: number | null;
  financialMetricsAvailable: boolean;
}

export interface PortfolioMonitorPoint {
  date: string;
  shortDate: string;
  invested: number;
  marketValue: number;
  totalReturn: number;
  pnlGap: number;
  monthlyDividends: number;
  cumulativeDividends: number;
  crypto: number;
  stocks: number;
  etfs: number;
  metals: number;
}

interface PortfolioMonitorOptions {
  excludedCashVenues?: string[];
  language?: LanguagePreference;
}

export interface GoldSilverRatioInsight {
  ratio: number;
  referenceBand: 'below_60' | '60_to_75' | '75_to_90' | '90_plus';
  label: string;
  description: string;
  bandLabel: string;
  bandDescription: string;
  ratioPositionPct: number;
  isVerified?: boolean;
  asOf?: string;
}

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

function normalizeVenueKey(venue: string) {
  return venue.trim().toLowerCase();
}

function buildShortDateFormatter(
  language: LanguagePreference = 'en',
) {
  const locale =
    language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US';
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    calendar: 'gregory',
  });
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
    calendar: 'gregory',
  });

  return (dateStr: string) => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts.map(Number);
      return dayFormatter.format(new Date(Date.UTC(year, month - 1, day)));
    }
    const [year, month] = parts.map(Number);
    return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
  };
}

function toMonthKey(date: string) {
  return new Date(date).toISOString().slice(0, 7);
}

function hashCode(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function calculateHoldingDays(fromDate: string) {
  return Math.floor((Date.now() - new Date(fromDate).getTime()) / 86_400_000);
}

interface PreparedPriceHistory {
  latestHistoryDay: string;
  points: Array<{ timestamp: number; close: number }>;
}

function preparePriceHistories(
  histories?: Record<string, Array<{ date: string; close: number }>>,
) {
  return new Map<string, PreparedPriceHistory>(
    Object.entries(histories ?? {}).flatMap(([symbol, history]) => {
      const validPoints = history
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
      const latestHistoryDay = validPoints.at(-1)?.date.slice(0, 10);
      if (!latestHistoryDay) return [];

      return [[symbol, {
        latestHistoryDay,
        points: validPoints.map((point) => ({
          timestamp: new Date(point.date).getTime(),
          close: point.close,
        })),
      } satisfies PreparedPriceHistory] as const];
    }),
  );
}

function findPriceOnDay(
  history: PreparedPriceHistory | undefined,
  dayKey: string,
): number | null {
  if (!history || dayKey > history.latestHistoryDay) {
    return null;
  }

  const cutoff = new Date(`${dayKey}T23:59:59.999Z`).getTime();
  let low = 0;
  let high = history.points.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (history.points[middle].timestamp <= cutoff) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match >= 0 ? history.points[match].close : null;
}

function buildDividendTimeline(transactions: InvestmentTransaction[]) {
  const monthlyByMonth = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'dividend') {
      continue;
    }

    const monthKey = toMonthKey(transaction.date);
    const current = monthlyByMonth.get(monthKey) ?? 0;
    monthlyByMonth.set(
      monthKey,
      Number((current + requireEurValue(transaction.total, transaction)).toFixed(2)),
    );
  }

  const orderedMonths = [...monthlyByMonth.entries()].sort(([left], [right]) => left.localeCompare(right));
  const cumulativeByIndex: number[] = [];
  let cumulative = 0;
  for (const [, amount] of orderedMonths) {
    cumulative += amount;
    cumulativeByIndex.push(cumulative);
  }

  return {
    monthlyByMonth,
    getCumulativeThroughMonth(monthKey: string) {
      let low = 0;
      let high = orderedMonths.length - 1;
      let match = -1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (orderedMonths[middle][0] <= monthKey) {
          match = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      return Number((match >= 0 ? cumulativeByIndex[match] : 0).toFixed(2));
    },
  };
}

export function buildHoldingLedgerInsights(
  transactions: InvestmentTransaction[],
  taxOverview: InvestmentTaxOverview,
): Record<string, HoldingLedgerInsight> {
  const assetTransactions = transactions.filter((transaction) => transaction.assetClass !== 'cash');
  const grouped = new Map<string, InvestmentTransaction[]>();

  for (const transaction of assetTransactions) {
    const symbol = transaction.asset.trim().toUpperCase();
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), transaction]);
  }

  const realizedByAsset = taxOverview.disposals.reduce<Record<string, number>>((acc, disposal) => {
    acc[disposal.asset] = (acc[disposal.asset] ?? 0) + disposal.realizedGain;
    return acc;
  }, {});

  const openLotDateByAsset = taxOverview.openLots.reduce<Record<string, string>>((acc, lot) => {
    if (!acc[lot.asset] || new Date(lot.acquisitionDate).getTime() < new Date(acc[lot.asset]).getTime()) {
      acc[lot.asset] = lot.acquisitionDate;
    }
    return acc;
  }, {});

  return Object.fromEntries(
    [...grouped.entries()].map(([symbol, items]) => {
      const ordered = [...items].sort(
        (left, right) => new Date(left.date).getTime() - new Date(right.date).getTime(),
      );
      const buys = ordered.filter((transaction) => transaction.type === 'buy');
      const venues = [...new Set(ordered.map((transaction) => transaction.venue))];
      const oldestOpenLotAt = openLotDateByAsset[symbol] ?? null;
      const primaryVenue = ordered[ordered.length - 1]?.venue ?? '—';
      const financialMetricsAvailable =
        taxOverview.calculationStatus === 'calculated'
        && ordered.every(
          (transaction) =>
            normalizeTransactionToEur(1, transaction) !== null,
        );

      return [
        symbol,
        {
          symbol,
          primaryVenue,
          venues,
          tradeCount: ordered.length,
          totalFeesEur: Number(
            (
              financialMetricsAvailable
                ? ordered.reduce(
                    (sum, transaction) =>
                      sum + requireEurValue(transaction.fee, transaction),
                    0,
                  )
                : 0
            ).toFixed(2),
          ),
          realizedPnl: Number((realizedByAsset[symbol] ?? 0).toFixed(2)),
          firstAcquiredAt: buys[0]?.date ?? null,
          oldestOpenLotAt,
          lastTradeAt: ordered[ordered.length - 1]?.date ?? null,
          holdingDays: oldestOpenLotAt ? calculateHoldingDays(oldestOpenLotAt) : null,
          financialMetricsAvailable,
        } satisfies HoldingLedgerInsight,
      ];
    }),
  );
}

export function buildPortfolioMonitorSeries(
  transactions: InvestmentTransaction[],
  _growthSeries: PortfolioGrowthPoint[],
  liveSnapshot?: {
    monthKey?: string;
    asOfDay?: string;
    invested?: number;
    marketValue?: number;
    sleeves?: Partial<Record<AssetClass, number>>;
  },
  historicalPrices?: Record<string, Array<{date: string, close: number}>>,
  options: PortfolioMonitorOptions = {},
): PortfolioMonitorPoint[] {
  const needsEurValuation = transactions.some(
    (transaction) => normalizeTransactionToEur(1, transaction) === null,
  );
  if (needsEurValuation) {
    return [];
  }
  if (transactions.length === 0 && !liveSnapshot) {
    return [];
  }

  const dividendTimeline = buildDividendTimeline(transactions);
  const formatShortDate = buildShortDateFormatter(options.language);
  const preparedPriceHistories = preparePriceHistories(historicalPrices);
  const demoAsOfDay = getDemoSnapshotAsOfDay(transactions);
  const requestedAsOfDay = liveSnapshot?.asOfDay ?? demoAsOfDay;
  const currentDayKey = requestedAsOfDay
    && /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOfDay)
    && Number.isFinite(Date.parse(`${requestedAsOfDay}T00:00:00.000Z`))
      ? requestedAsOfDay
      : new Date().toISOString().slice(0, 10);
  const excludedCashVenueSet = new Set((options.excludedCashVenues ?? []).map(normalizeVenueKey));
  const getMonitorHoldings = (input: InvestmentTransaction[]) =>
    deriveHoldingsFromTransactions(input).filter(
      (holding) =>
        holding.assetClass !== 'cash' ||
        !excludedCashVenueSet.has(normalizeVenueKey(holding.venue)),
    );
  const orderedTransactions = transactions
    .map((transaction, originalIndex) => ({
      transaction,
      originalIndex,
      timestamp: new Date(transaction.date).getTime(),
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp
        || left.originalIndex - right.originalIndex,
    );
  
  // Calculate the dynamic start date based on the earliest transaction
  const baselineDays: string[] = [];
  const now = new Date(`${currentDayKey}T00:00:00.000Z`);
  
  const earliestTx = transactions.length > 0 
    ? transactions.reduce((earliest, tx) => 
        new Date(tx.date).getTime() < new Date(earliest.date).getTime() ? tx : earliest
      )
    : null;
    
  const startDate = earliestTx 
    ? new Date(earliestTx.date) 
    : new Date(Date.UTC(now.getFullYear(), now.getMonth() - 12, 1));
  // The synthetic ledger predates its authored 90-day observation window.
  // Keep the monitor inside that window so a cash-only January point cannot
  // be drawn as a continuous line across months with no market observations.
  const demoStartDay = demoAsOfDay
    ? INVESTATLAS_SHOWCASE_SNAPSHOT.portfolioHistory[0]?.date
    : undefined;
  const boundedStartDate = demoStartDay
    ? new Date(Math.max(startDate.getTime(), Date.parse(`${demoStartDay}T00:00:00.000Z`)))
    : startDate;
    
  // Start at the specific date of the earliest transaction or 12 months ago
  let current = new Date(Date.UTC(boundedStartDate.getUTCFullYear(), boundedStartDate.getUTCMonth(), boundedStartDate.getUTCDate()));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  
  while (current <= end) {
    baselineDays.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const currentMonthKey = currentDayKey.slice(0, 7);
  const currentMonthDividends = dividendTimeline.monthlyByMonth.get(currentMonthKey) ?? 0;
  const currentCumulativeDividends = dividendTimeline.getCumulativeThroughMonth(currentMonthKey);
  const combinedMap = new Map<string, PortfolioMonitorPoint>();

  const activeTransactions: InvestmentTransaction[] = [];
  let transactionIndex = 0;
  let holdingsAtPoint: ReturnType<typeof getMonitorHoldings> = [];

  for (const d of baselineDays) {
    const cutoff = new Date(d + 'T23:59:59.999Z').getTime();
    let ledgerChanged = false;
    while (
      transactionIndex < orderedTransactions.length
      && orderedTransactions[transactionIndex].timestamp <= cutoff
    ) {
      activeTransactions.push(orderedTransactions[transactionIndex].transaction);
      transactionIndex += 1;
      ledgerChanged = true;
    }
    if (ledgerChanged) {
      holdingsAtPoint = getMonitorHoldings(activeTransactions);
    }

    if (holdingsAtPoint.some((holding) => !holding.costBasisAvailable)) {
      continue;
    }

    const invested = holdingsAtPoint.reduce((sum, h) => sum + h.amount * h.avgCost, 0);
    const monthKey = d.slice(0, 7);
    const monthlyDividends = dividendTimeline.monthlyByMonth.get(monthKey) ?? 0;
    const cumulativeDividends = dividendTimeline.getCumulativeThroughMonth(monthKey);
    let marketValue = 0;
    const sleeves: Partial<Record<AssetClass, number>> = {};
    let valuationAvailable = true;

    for (const holding of holdingsAtPoint) {
      let holdingValue: number;
      if (holding.assetClass === 'cash') {
        holdingValue = holding.amount * holding.avgCost;
      } else {
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
          break;
        }
        const history = preparedPriceHistories.get(holding.symbol);
        const priceOnDay = findPriceOnDay(history, d);
        if (priceOnDay === null) {
          valuationAvailable = false;
          break;
        }
        const actualPrice = isMetal ? priceOnDay / TROY_OUNCE_GRAMS : priceOnDay;
        holdingValue =
          (isMetal ? holding.fineMetalAmount! : holding.amount)
          * actualPrice;
        sleeves[holding.assetClass] =
          (sleeves[holding.assetClass] ?? 0) + holdingValue;
      }
      marketValue += holdingValue;
    }

    if (!valuationAvailable) {
      continue;
    }

    combinedMap.set(d, {
      date: d,
      shortDate: formatShortDate(d),
      invested: Number(invested.toFixed(2)),
      marketValue: Number(marketValue.toFixed(2)),
      totalReturn: Number((marketValue + cumulativeDividends).toFixed(2)),
      pnlGap: Number((marketValue - invested).toFixed(2)),
      monthlyDividends: Number(monthlyDividends.toFixed(2)),
      cumulativeDividends,
      crypto: Number((sleeves.crypto ?? 0).toFixed(2)),
      stocks: Number((sleeves.stock ?? 0).toFixed(2)),
      etfs: Number((sleeves.etf ?? 0).toFixed(2)),
      metals: Number((sleeves.metal ?? 0).toFixed(2)),
    });
  }

  if (
    liveSnapshot
    && Number.isFinite(liveSnapshot.invested)
    && Number.isFinite(liveSnapshot.marketValue)
  ) {
    const invested = liveSnapshot.invested as number;
    const marketValue = liveSnapshot.marketValue as number;
    combinedMap.set(currentDayKey, {
      date: currentDayKey,
      shortDate: formatShortDate(currentDayKey),
      invested: Number(invested.toFixed(2)),
      marketValue: Number(marketValue.toFixed(2)),
      totalReturn: Number((marketValue + currentCumulativeDividends).toFixed(2)),
      pnlGap: Number((marketValue - invested).toFixed(2)),
      monthlyDividends: Number(currentMonthDividends.toFixed(2)),
      cumulativeDividends: currentCumulativeDividends,
      crypto: Number((liveSnapshot.sleeves?.crypto ?? 0).toFixed(2)),
      stocks: Number((liveSnapshot.sleeves?.stock ?? 0).toFixed(2)),
      etfs: Number((liveSnapshot.sleeves?.etf ?? 0).toFixed(2)),
      metals: Number((liveSnapshot.sleeves?.metal ?? 0).toFixed(2)),
    });
  }

  return [...combinedMap.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function deriveGoldSilverRatio(
  holdings: Array<{ symbol: string; currentPrice: number; isVerified?: boolean; asOf?: string }>,
): GoldSilverRatioInsight | null {
  const goldHolding = holdings.find((holding) => holding.symbol === 'GOLD');
  const silverHolding = holdings.find((holding) => holding.symbol === 'SILVER');
  
  const gold = goldHolding?.currentPrice ?? 0;
  const silver = silverHolding?.currentPrice ?? 0;

  if (
    gold <= 0
    || silver <= 0
    || !goldHolding?.asOf
    || goldHolding.asOf !== silverHolding?.asOf
  ) {
    return null;
  }

  const isVerified = (goldHolding?.isVerified ?? false) && (silverHolding?.isVerified ?? false);
  const asOf = goldHolding.asOf;

  const ratio = gold / silver;
  const ratioPositionPct = Math.min(
    100,
    Math.max(0, ((Math.min(ratio, 105) - 45) / 60) * 100),
  );
  const common = {
    ratio: Number(ratio.toFixed(1)),
    ratioPositionPct: Number(ratioPositionPct.toFixed(1)),
    isVerified,
    asOf,
  };

  if (ratio >= 90) {
    return {
      ...common,
      referenceBand: '90_plus',
      label: 'Gold-to-silver ratio is 90 or above',
      description: 'One unit of gold is priced at least 90 times one unit of silver in the matched observation.',
      bandLabel: 'Reference band: 90 or above',
      bandDescription: 'This descriptive InvestAtlas reference band does not indicate value or predict future performance.',
    };
  }

  if (ratio >= 75) {
    return {
      ...common,
      referenceBand: '75_to_90',
      label: 'Gold-to-silver ratio is between 75 and 90',
      description: 'One unit of gold is priced between 75 and 90 times one unit of silver in the matched observation.',
      bandLabel: 'Reference band: 75 to below 90',
      bandDescription: 'This descriptive InvestAtlas reference band does not indicate value or predict future performance.',
    };
  }

  if (ratio >= 60) {
    return {
      ...common,
      referenceBand: '60_to_75',
      label: 'Gold-to-silver ratio is between 60 and 75',
      description: 'One unit of gold is priced between 60 and 75 times one unit of silver in the matched observation.',
      bandLabel: 'Reference band: 60 to below 75',
      bandDescription: 'This descriptive InvestAtlas reference band does not indicate value or predict future performance.',
    };
  }

  return {
    ...common,
    referenceBand: 'below_60',
    label: 'Gold-to-silver ratio is below 60',
    description: 'One unit of gold is priced below 60 times one unit of silver in the matched observation.',
    bandLabel: 'Reference band: below 60',
    bandDescription: 'This descriptive InvestAtlas reference band does not indicate value or predict future performance.',
  };
}
