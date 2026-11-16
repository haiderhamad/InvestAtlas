'use client';

import { formatChartAxis, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import AppShell from '@/components/layout/app-shell';
import Link from 'next/link';
import PortfolioDonut, { assetColor } from '@/components/dashboard/portfolio-donut';
import { Skeleton } from '@/components/ui/skeleton';
import { DEMO_PORTFOLIO_GROWTH } from '@/lib/demo/investment-data';
import { getDemoSnapshotAsOfDay } from '@/lib/demo/showcase-snapshot';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  buildHoldingLedgerInsights,
  buildPortfolioMonitorSeries,
  deriveGoldSilverRatio,
} from '@/lib/portfolio/ux-insights';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_OPTIONS,
  SUPPORTED_STOCK_ASSETS,
  SUPPORTED_ETF_ASSETS,
  SUPPORTED_METAL_ASSETS,
  getAssetConfig,
  getAssetShariahStatus,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  getShariahDecisionLabel,
  type ShariahDecisionStatus,
} from '@/lib/shariah/decision';
import { calculateInvestmentTaxOverview } from '@/lib/tax/investment-tax';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_EVENT,
} from '@/lib/tax/tax-profile-store';
import { DEFAULT_TAX_PROFILE_SETTINGS } from '@/lib/tax/tax-profile';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { getVenueMeta } from '@/lib/portfolio/account-overview';
import {
  getAllManualAccounts,
  isPortfolioVenue,
  MANUAL_ACCOUNTS_EVENT,
} from '@/lib/accounts/manual-accounts-store';
import {
  HIDDEN_ACCOUNTS_EVENT,
  readHiddenAccountVenues,
} from '@/lib/accounts/account-visibility-store';
import { deriveHoldingsFromTransactions, type DerivedHolding } from '@/lib/transactions/holdings-engine';
import { getNegativeCashBalances } from '@/lib/transactions/cash-balances';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  getUnavailableValuationSymbols,
  summarizeCurrentValuationCoverage,
  type CurrentFxRatesToEur,
  type CurrentValuationPrices,
} from '@/lib/portfolio/current-valuation';
import { fetchCurrentQuoteBatches } from '@/lib/financial-data/quotes/client';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock3,
  PieChart,
  RefreshCw,
  Target,
  X,
} from 'lucide-react';
import { AssetIcon } from '@/components/ui/asset-icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type HoldingView = ReturnType<typeof buildCurrentHoldingValuations>[number];

type CurrentPriceSnapshot = CurrentValuationPrices;

function buildHoldingSnapshot(
  baseHoldings: DerivedHolding[],
  prices?: CurrentPriceSnapshot,
  fxRatesToEur?: CurrentFxRatesToEur,
): HoldingView[] {
  return buildCurrentHoldingValuations(baseHoldings, prices, fxRatesToEur);
}

const RenderCustomAxisTick = (props: any) => {
  const { x, y, payload, isRtl, domain, locale } = props;
  const val = Number(payload.value);
  const formattedValue = formatChartAxis(val, domain, locale, { suffix: '%' });

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={isRtl ? 10 : -10}
        y={4}
        textAnchor={isRtl ? 'start' : 'end'}
        fill="none"
        stroke="var(--bg-card)"
        strokeWidth={2}
        fontSize={11}
        fontWeight="bold"
      >
        {formattedValue}
      </text>
      <text
        x={isRtl ? 10 : -10}
        y={4}
        textAnchor={isRtl ? 'start' : 'end'}
        fill="var(--text-muted)"
        fontSize={11}
      >
        {formattedValue}
      </text>
    </g>
  );
};

export default function PortfolioPage() {
  const { t, language } = useAppTranslation();

  const {
    displayCurrency,
    formatMoney,
    usdToEurRate,
    fxFreshness,
    fxAsOf,
  } = useDisplayCurrencyPreference();
  const fxRatesToEur = useMemo<CurrentFxRatesToEur>(() =>
    usdToEurRate && fxFreshness && fxAsOf
      ? {
          USD: {
            rate: usdToEurRate,
            freshness: fxFreshness,
            asOf: fxAsOf,
            providerId: 'ecb_reference_rates',
          },
        }
      : {},
  [usdToEurRate, fxFreshness, fxAsOf]);

  const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ReturnType<typeof getAllManualAccounts>>([]);
  const [hiddenAccountVenues, setHiddenAccountVenues] = useState<string[]>([]);
  const hiddenVenueSet = useMemo(() => new Set(hiddenAccountVenues), [hiddenAccountVenues]);
  const portfolioTransactions = useMemo(
    () => transactions.filter((transaction) => !hiddenVenueSet.has(transaction.venue) && isPortfolioVenue(transaction.venue, manualAccounts)),
    [transactions, hiddenVenueSet, manualAccounts],
  );
  const [taxProfileSettings, setTaxProfileSettings] = useState(DEFAULT_TAX_PROFILE_SETTINGS);
  const baseHoldings = useMemo(() => deriveHoldingsFromTransactions(portfolioTransactions), [portfolioTransactions]);

  const [historicalPrices, setHistoricalPrices] = useState<Record<string, Array<{ date: string, close: number }>>>({});

  useEffect(() => {
    const fetchHistoricalPrices = async () => {
      const symbols = [...new Set(portfolioTransactions.map(tx => tx.asset))];
      const newHistoricalPrices = { ...historicalPrices };
      let changed = false;

      for (const symbol of symbols) {
        if (!newHistoricalPrices[symbol]) {
          try {
            const res = await fetchFinancialData(`/api/prices/history?symbol=${symbol}`);
            const data = await res.json();
            if (res.ok && isHistoryUsableForDerivedPerformance(data)) {
              newHistoricalPrices[symbol] = data.prices;
              changed = true;
            }
          } catch (error) {
            console.error(`Failed to fetch history for ${symbol}:`, error);
          }
        }
      }

      if (changed) {
        setHistoricalPrices(newHistoricalPrices);
      }
    };

    if (portfolioTransactions.length > 0) {
      fetchHistoricalPrices();
    }
  }, [portfolioTransactions]);

  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [currentPrices, setCurrentPrices] = useState<CurrentPriceSnapshot>({});
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complianceFilter, setComplianceFilter] = useState<ShariahDecisionStatus | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

  useEffect(() => {
    // Hydrate state from localStorage on client mount
    setTransactions(getAllTransactions());
    setManualAccounts(getAllManualAccounts());
    setHiddenAccountVenues(readHiddenAccountVenues());
    setTaxProfileSettings(readTaxProfileSettings());

    const syncTransactions = () => {
      setTransactions(getAllTransactions());
    };
    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };
    const syncManualAccounts = () => {
      setManualAccounts(getAllManualAccounts());
    };
    const syncHiddenAccounts = () => {
      setHiddenAccountVenues(readHiddenAccountVenues());
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
    window.addEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
      window.removeEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncTaxProfile);
    };
  }, []);

  const fetchPortfolioSnapshot = useCallback(async () => {
    setSyncing(true);
    setError(null);

    try {
      if (baseHoldings.length === 0) {
        setHoldings([]);
        setCurrentPrices({});
        setLastSync(null);
        setIsLive(false);
        return;
      }

      const priceableHoldings = baseHoldings.filter((holding) => holding.assetClass !== 'cash');
      if (priceableHoldings.length === 0) {
        setHoldings(buildHoldingSnapshot(baseHoldings, undefined, fxRatesToEur));
        setCurrentPrices({});
        setLastSync(new Date().toISOString());
        setIsLive(false);
        return;
      }

      const symbolsToFetch = new Set(priceableHoldings.map((holding) => holding.symbol));
      if (priceableHoldings.some((holding) => holding.assetClass === 'metal')) {
        symbolsToFetch.add('GOLD');
        symbolsToFetch.add('SILVER');
      }
      const data = await fetchCurrentQuoteBatches(
        Array.from(symbolsToFetch),
        'eur',
      );
      if (data.status === 'unavailable') {
        throw new Error('Portfolio snapshot failed');
      }

      const priceSnapshot = (data.prices ?? {}) as CurrentPriceSnapshot;
      const nextHoldings = buildHoldingSnapshot(baseHoldings, priceSnapshot, fxRatesToEur);
      const valuationComplete = isCurrentValuationComplete(nextHoldings);
      setCurrentPrices(priceSnapshot);
      setHoldings(nextHoldings);
      setLastSync(data.timestamp);
      setIsLive(valuationComplete);
      if (!valuationComplete) {
        setError('Current market data is unavailable for one or more holdings.');
      }
    } catch (fetchError) {
      setHoldings(buildHoldingSnapshot(baseHoldings, undefined, fxRatesToEur));
      setCurrentPrices({});
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to refresh portfolio');
      setIsLive(false);
    } finally {
      setSyncing(false);
    }
  }, [baseHoldings, fxRatesToEur]);

  useEffect(() => {
    setHoldings(
      baseHoldings.length > 0
        ? buildHoldingSnapshot(baseHoldings, undefined, fxRatesToEur)
        : [],
    );
  }, [baseHoldings, fxRatesToEur]);

  useEffect(() => {
    void fetchPortfolioSnapshot();
  }, [fetchPortfolioSnapshot]);

  const taxOverview = useMemo(
    () => calculateInvestmentTaxOverview(portfolioTransactions, taxProfileSettings),
    [taxProfileSettings, portfolioTransactions],
  );
  const holdingInsights = useMemo(
    () => buildHoldingLedgerInsights(portfolioTransactions, taxOverview),
    [taxOverview, portfolioTransactions],
  );

  const valuationHoldings = useMemo(
    () =>
      holdings.filter(
        (asset) =>
          !hiddenVenueSet.has(asset.venue) &&
          isPortfolioVenue(asset.venue, manualAccounts) &&
          (asset.assetClass !== 'cash' || asset.amount > 0),
      ),
    [hiddenVenueSet, holdings, manualAccounts],
  );
  const unavailableHoldingSymbols = getUnavailableValuationSymbols(valuationHoldings);
  const allocationHoldings = useMemo(() => {
    const displayHoldings = valuationHoldings.filter(
      (asset) =>
        asset.assetClass !== 'cash' ||
        getVenueMeta(asset.venue, manualAccounts).cashCategory === 'savings_cash',
    );
    const displayTotal = isCurrentValuationComplete(displayHoldings)
      ? displayHoldings.reduce((sum, asset) => sum + (asset.value || 0), 0)
      : 0;

    return displayHoldings.map((asset) => ({
      ...asset,
      allocation: displayTotal > 0 ? ((asset.value || 0) / displayTotal) * 100 : 0,
    }));
  }, [manualAccounts, valuationHoldings]);
  const chartExcludedCashVenues = useMemo(() => {
    const venues = new Set<string>();
    manualAccounts.forEach((account) => venues.add(account.venue));
    portfolioTransactions.forEach((transaction) => {
      venues.add(transaction.venue);
      if (transaction.settlementVenue) {
        venues.add(transaction.settlementVenue);
      }
    });

    return [...venues].filter(
      (venue) => getVenueMeta(venue, manualAccounts).cashCategory !== 'savings_cash',
    );
  }, [manualAccounts, portfolioTransactions]);
  const negativeCashBalances = useMemo(
    () => getNegativeCashBalances(portfolioTransactions),
    [portfolioTransactions],
  );
  const totalNegativeCash = negativeCashBalances.reduce((sum, balance) => sum + balance.value, 0);
  const portfolioValuationAvailable = isCurrentValuationComplete(valuationHoldings);
  const allocationValue = allocationHoldings.reduce((sum, asset) => sum + (asset.value || 0), 0);
  const valuationCoverage = summarizeCurrentValuationCoverage(allocationHoldings);
  const allocationCostBasisAvailable = allocationHoldings.every(
    (asset) => asset.costBasisAvailable,
  );
  const allocationPnlAvailable =
    portfolioValuationAvailable && allocationCostBasisAvailable;
  const allocationCost = allocationHoldings.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0);
  const totalPnl = allocationPnlAvailable ? allocationValue - allocationCost : 0;
  const unrealizedPct =
    allocationPnlAvailable && allocationCost > 0
      ? (totalPnl / allocationCost) * 100
      : 0;
  const dailyChangeAvailable = valuationHoldings.every(
    (asset) =>
      asset.valuationAvailable
      && asset.change24h !== null
      && asset.changePeriod === '24h',
  );
  const dailyPnl = dailyChangeAvailable
    ? valuationHoldings.reduce(
        (sum, asset) => sum + (asset.value * (asset.change24h ?? 0)) / 100,
        0,
      )
    : null;
  const largestHolding = portfolioValuationAvailable
    ? [...allocationHoldings].sort((left, right) => right.allocation - left.allocation)[0]
    : undefined;
  const valuationBreakdownHoldings = portfolioValuationAvailable
    ? allocationHoldings
    : [];

  const categoryBreakdown = useMemo(() => {
    const baseBuckets = ASSET_CLASS_OPTIONS.map(({ value, label }) => {
      const assetClass = value;
      const sleeveHoldings = valuationBreakdownHoldings.filter((asset) => asset.assetClass === assetClass);
      const currentValue = sleeveHoldings.reduce((sum, asset) => sum + (asset.value || 0), 0);
      const costBasisAvailable = sleeveHoldings.every(
        (asset) => asset.costBasisAvailable,
      );
      const investedValue = sleeveHoldings.reduce((sum, asset) => sum + (asset.amount || 0) * (asset.avgCost || 0), 0);
      const pnl = costBasisAvailable ? currentValue - investedValue : 0;
      const topHolding = [...sleeveHoldings].sort((left, right) => right.value - left.value)[0];

      return {
        assetClass,
        label,
        currentValue,
        investedValue,
        pnl,
        costBasisAvailable,
        positions: sleeveHoldings.length,
        topHolding,
        topHoldingShare:
          currentValue > 0 && topHolding ? (topHolding.value / currentValue) * 100 : 0,
      };
    });

    const cashHoldings = valuationBreakdownHoldings.filter((asset) => asset.assetClass === 'cash');
    const savingCashHoldings = cashHoldings.filter(
      (asset) => getVenueMeta(asset.venue, manualAccounts).cashCategory === 'savings_cash',
    );
    const savingCashValue = savingCashHoldings.reduce((sum, asset) => sum + (asset.value || 0), 0);
    const savingCashInvested = savingCashHoldings.reduce((sum, asset) => sum + (asset.amount || 0) * (asset.avgCost || 0), 0);
    const savingCashCostBasisAvailable = savingCashHoldings.every(
      (asset) => asset.costBasisAvailable,
    );
    const savingCashTopHolding = [...savingCashHoldings].sort((left, right) => right.value - left.value)[0];

    const savingCashBucket = {
      assetClass: 'cash',
      label: 'Saving Cash',
      currentValue: savingCashValue,
      investedValue: savingCashInvested,
      pnl: 0,
      costBasisAvailable: savingCashCostBasisAvailable,
      positions: savingCashHoldings.length,
      topHolding: savingCashTopHolding,
      topHoldingShare: savingCashValue > 0 && savingCashTopHolding ? (savingCashTopHolding.value / savingCashValue) * 100 : 0,
    };

    const buckets = [...baseBuckets, savingCashBucket];

    const totalSleevesValue = buckets.reduce((sum, b) => sum + Math.max(b.currentValue, 0), 0);

    return buckets.map((bucket) => ({
      ...bucket,
      allocation: totalSleevesValue > 0 ? (Math.max(bucket.currentValue, 0) / totalSleevesValue) * 100 : 0,
    }));
  }, [manualAccounts, valuationBreakdownHoldings]);

  const activeCategoryBreakdown = categoryBreakdown
    .filter((item) => item.positions > 0 || item.currentValue > 0)
    .sort((left, right) => right.currentValue - left.currentValue);
  const categoryAssets = activeCategoryBreakdown.map((item) => ({
    symbol: item.assetClass === 'cash' ? item.label.toUpperCase().replace(/\s+/g, '_') : item.assetClass.toUpperCase(),
    name: item.label,
    value: item.currentValue,
    allocation: item.allocation,
    assetClass: item.assetClass as AssetClass,
  }));
  const activeSleeveCount = activeCategoryBreakdown.length;

  const portfolioMonitorData = useMemo(
    () => {
      if (!allocationPnlAvailable) return [];
      return buildPortfolioMonitorSeries(portfolioTransactions, DEMO_PORTFOLIO_GROWTH, {
        monthKey: new Date().toISOString().slice(0, 7),
        asOfDay: getDemoSnapshotAsOfDay(portfolioTransactions),
        invested: allocationCost,
        marketValue: allocationValue,
        sleeves: {
          crypto: categoryBreakdown.find((item) => item.assetClass === 'crypto')?.currentValue ?? 0,
          stock: categoryBreakdown.find((item) => item.assetClass === 'stock')?.currentValue ?? 0,
          etf: categoryBreakdown.find((item) => item.assetClass === 'etf')?.currentValue ?? 0,
          metal: categoryBreakdown.find((item) => item.assetClass === 'metal')?.currentValue ?? 0,
        },
      }, historicalPrices, {
        excludedCashVenues: chartExcludedCashVenues,
        language,
      });
    },
    [allocationCost, allocationPnlAvailable, allocationValue, categoryBreakdown, chartExcludedCashVenues, historicalPrices, language, portfolioTransactions],
  );

  const chartDisplayData = useMemo(() => {
    return portfolioMonitorData.map((point, chartIndex) => {
      const pnlPct = point.invested > 0 ? ((point.marketValue - point.invested) / point.invested) * 100 : 0;
      return {
        ...point,
        chartIndex,
        chartMarketValue: Number(pnlPct.toFixed(2)),
        chartInvested: 0,
      };
    });
  }, [portfolioMonitorData]);
  const chartXAxisTicks = useMemo(
    () => chartDisplayData.map((_, index) => index),
    [chartDisplayData],
  );

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const chartDomain = getChartDomain(chartDisplayData.flatMap(point => [point.chartMarketValue, point.chartInvested]));

  const metalRatioSnapshot = useMemo(() => {
    const ratioInputs = (['GOLD', 'SILVER'] as const).flatMap((symbol) => {
      const quote = currentPrices[symbol];
      const field = quote?.fields?.price;
      if (
        field?.status !== 'available'
        || field.value.currency !== 'EUR'
        || !Number.isFinite(field.value.amount)
        || field.value.amount <= 0
      ) {
        return [];
      }
      const observationTimestamp = field.observedAt ?? field.asOf;
      const asOf = observationTimestamp?.slice(0, 10);
      if (!asOf || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) return [];

      return [{
        symbol,
        currentPrice: field.value.amount / TROY_OUNCE_GRAMS,
        isVerified: quote.verified,
        asOf,
      }];
    });

    const hasGoldPrice = ratioInputs.some((holding) => holding.symbol === 'GOLD' && holding.currentPrice > 0);
    const hasSilverPrice = ratioInputs.some((holding) => holding.symbol === 'SILVER' && holding.currentPrice > 0);

    return {
      ratio: deriveGoldSilverRatio(ratioInputs),
      hasGoldPrice,
      hasSilverPrice,
    };
  }, [currentPrices]);
  const goldSilverRatio = metalRatioSnapshot.ratio;
  const goldSilverRatioUnavailableLabel = !metalRatioSnapshot.hasGoldPrice
    ? 'Gold price missing. The marker appears once gold and silver prices are available.'
    : !metalRatioSnapshot.hasSilverPrice
      ? 'Silver price missing. The marker appears once gold and silver prices are available.'
      : 'Gold and silver prices need matching observation dates.';
  const metalSleeve = activeCategoryBreakdown.find((bucket) => bucket.assetClass === 'metal');
  const matureMetalLots = taxOverview.openLots.filter(
    (lot) => lot.assetClass === 'metal' && lot.isTaxFreeIfSoldToday,
  ).length;
  const dominantMetal = holdings
    .filter((holding) => holding.assetClass === 'metal')
    .sort((left, right) => right.value - left.value)[0];

  const holdingsTable = useMemo(
    () =>
      [...allocationHoldings]
        .filter(asset => {
          if (!complianceFilter) return true;
          const status = asset.assetClass === 'cash'
            ? 'insufficient_data'
            : getAssetShariahStatus(asset.symbol);
          return status === complianceFilter;
        })
        .sort((left, right) => right.value - left.value)
        .map((asset) => ({
          ...asset,
          realizedPnl: holdingInsights[asset.symbol]?.realizedPnl ?? 0,
          primaryVenue: asset.venue,
          oldestOpenLotAt: holdingInsights[asset.symbol]?.oldestOpenLotAt ?? null,
          holdingDays: holdingInsights[asset.symbol]?.holdingDays ?? null,
          totalFeesEur: holdingInsights[asset.symbol]?.totalFeesEur ?? 0,
          financialMetricsAvailable:
            holdingInsights[asset.symbol]?.financialMetricsAvailable ?? false,
        })),
    [allocationHoldings, complianceFilter, holdingInsights],
  );
  const complianceDistribution = useMemo(() => {
    const stats: Record<ShariahDecisionStatus | 'total', number> = {
      compliant: 0,
      non_compliant: 0,
      review_required: 0,
      insufficient_data: 0,
      total: 0,
    };
    if (!portfolioValuationAvailable) {
      return stats;
    }

    holdings.forEach(holding => {
      const status = holding.assetClass === 'cash'
        ? 'insufficient_data'
        : getAssetShariahStatus(holding.symbol);
      const val = holding.value || 0;

      stats[status] += val;
      stats.total += val;
    });
    return stats;
  }, [holdings, portfolioValuationAvailable]);


  const complianceViolations = useMemo(() => {
    return holdings
      .filter(h => h.amount > 0)
      .filter(h => h.assetClass !== 'cash')
      .filter(h => getAssetShariahStatus(h.symbol) === 'non_compliant')
      .map(h => ({
        ...h,
        config: getAssetConfig(h.symbol)
      }));
  }, [holdings]);

  const topHoldings = holdingsTable.slice(0, 4);

  const getLedgerTimeFormatter = (language: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: language !== 'de',
  });

  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: language !== 'de'
    })
    : t('Demo snapshot');

  const showSkeleton = syncing && !lastSync && holdings.length === 0;
  const emptyPortfolio = !showSkeleton && portfolioTransactions.length === 0;

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <PieChart size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Portfolio')}
            </h1>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={fetchPortfolioSnapshot} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'loading-spin' : undefined} />
              {syncing ? t('Refreshing…') : t('Refresh portfolio')}
            </button>
          </div>
        </div>
      </div>

      <div className="page-content animate-in">
        {emptyPortfolio && (
          <section className="portfolio-empty-start" aria-labelledby="portfolio-empty-title">
            <div>
              <h2 id="portfolio-empty-title">{t('Your portfolio is empty')}</h2>
              <p>{t('Create an account or open an existing one, then add or import transactions there.')}</p>
            </div>
            <Link href="/accounts" className="btn btn-primary">{t('Set up an account')}</Link>
          </section>
        )}
        {error && (
          <div className="callout warn">
            <Activity size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Market-data refresh is degraded.')}</strong>{' '}
              {t('Current values and dependent calculations remain unavailable until every required price is sourced.')}
              {unavailableHoldingSymbols.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <strong>{t('No usable current EUR valuation for:')}</strong>{' '}
                  <bdi dir="ltr">{unavailableHoldingSymbols.join(', ')}</bdi>
                </div>
              )}
            </div>
          </div>
        )}

        {!allocationCostBasisAvailable && allocationHoldings.length > 0 && (
          <div className="callout warn">
            <Activity size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Cost basis and P&L unavailable')}</strong>{' '}
              {t('At least one position requires a reliable historical FX conversion. Original transactions remain unchanged.')}
            </div>
          </div>
        )}

        {complianceViolations.length > 0 && (
          <div className="callout error animate-in" style={{
            background: 'linear-gradient(90deg, rgba(255, 92, 124, 0.12) 0%, rgba(255, 92, 124, 0.04) 100%)',
            border: '1px solid rgba(255, 92, 124, 0.3)',
            padding: '20px 24px',
            borderRadius: 16,
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start'
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(255, 92, 124, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <X size={20} style={{ color: 'var(--red)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>
                {t('Shariah Compliance Alert')}
              </h4>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('The implemented core-activity screen flags the following assets as non-compliant. This is informational, not a religious ruling or personal investment advice.')}
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {complianceViolations.map(v => (
                  <div key={v.symbol} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <AssetIcon
                        symbol={v.symbol}
                        name={v.config?.name}
                        assetClass={v.assetClass as AssetClass}
                        size={24}
                      />
                      <strong style={{ fontSize: 14 }}>{v.symbol}</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.config?.name}</span>
                      {v.config?.compliance?.reason && (
                        <span style={{ fontSize: 11, color: 'var(--red)', background: 'rgba(255, 92, 124, 0.1)', padding: '2px 8px', borderRadius: 6 }}>
                          {t(v.config.compliance.reason)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {v.valuationAvailable ? formatMoney(v.value) : t('Unavailable')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {negativeCashBalances.length > 0 ? (
          <div className="callout warn">
            <Activity size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Open cash correction')}:</strong>{' '}
              {formatMoney(totalNegativeCash)} ·{' '}
              {negativeCashBalances
                .map((balance) => `${getVenueMeta(balance.venue, manualAccounts).label} ${formatMoney(balance.value)}`)
                .join(' · ')}
            </div>
          </div>
        ) : null}

        <div className="portfolio-overview-grid">
          <div className="card portfolio-snapshot-card">
            <div className="card-title">{t('Current market value')}</div>
            <div className="card-value">
              {showSkeleton
                ? <Skeleton width={200} height={36} borderRadius={8} />
                : portfolioValuationAvailable
                  ? formatMoney(allocationValue)
                  : t('Unavailable')}
            </div>
            {!showSkeleton && !portfolioValuationAvailable && valuationCoverage.valuedCount > 0 && (
              <p className="portfolio-kpi-note">
                {t('Valued positions only (incomplete total)')}: <strong>{formatMoney(valuationCoverage.valuedValue)}</strong>
                {' '}({valuationCoverage.valuedCount}/{valuationCoverage.totalCount} {t('positions')})
              </p>
            )}

            <div className="portfolio-kpi-grid">
              <div className="portfolio-kpi-card">
                <span className="portfolio-kpi-label">{t('Invested capital')}</span>
                <strong className="portfolio-kpi-value">
                  {showSkeleton
                    ? <Skeleton width={100} height={20} />
                    : allocationCostBasisAvailable
                      ? formatMoney(allocationCost)
                      : t('Unavailable')}
                </strong>
                <span className="portfolio-kpi-note">{t('Still active across open positions')}</span>
              </div>
              <div className="portfolio-kpi-card">
                <span className="portfolio-kpi-label">{t('Unrealized P&L')}</span>
                <strong
                  className="portfolio-kpi-value"
                  style={{
                    color: allocationPnlAvailable
                      ? totalPnl >= 0
                        ? 'var(--green)'
                        : 'var(--red)'
                      : 'var(--text-muted)',
                  }}
                >
                  {allocationPnlAvailable
                    ? `${totalPnl >= 0 ? '+' : '−'}${formatMoney(Math.abs(totalPnl))}`
                    : t('Unavailable')}
                </strong>
                <span className="portfolio-kpi-note">
                  {allocationPnlAvailable
                    ? t(`${formatPct(unrealizedPct)} versus invested`)
                    : portfolioValuationAvailable
                      ? t('Historical FX data required')
                      : t('Current prices required')}
                </span>
                {!showSkeleton && !portfolioValuationAvailable && valuationCoverage.valuedUnrealizedPnl !== null && (
                  <span className="portfolio-kpi-note">
                    {t('Partial unrealized P&L (valued positions only)')}: {' '}
                    <strong style={{ color: valuationCoverage.valuedUnrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {valuationCoverage.valuedUnrealizedPnl >= 0 ? '+' : '−'}{formatMoney(Math.abs(valuationCoverage.valuedUnrealizedPnl))}
                    </strong>
                    {' '}({valuationCoverage.valuedCount}/{valuationCoverage.totalCount} {t('positions')})
                  </span>
                )}
              </div>
              <div className="portfolio-kpi-card">
                <span className="portfolio-kpi-label">{t('Day move')}</span>
                <strong
                  className="portfolio-kpi-value"
                  style={{
                    color: dailyPnl === null
                      ? 'var(--text-muted)'
                      : dailyPnl >= 0
                        ? 'var(--green)'
                        : 'var(--red)',
                  }}
                >
                  {dailyPnl === null
                    ? t('Unavailable')
                    : `${dailyPnl >= 0 ? '+' : '−'}${formatMoney(Math.abs(dailyPnl))}`}
                </strong>
                <span className="portfolio-kpi-note">
                  {dailyPnl === null
                    ? t('A provider did not supply a current 24h change for every holding.')
                    : t('Sourced change across all holdings')}
                </span>
              </div>
              <div className="portfolio-kpi-card">
                <span className="portfolio-kpi-label">{t('Largest holding')}</span>
                <strong className="portfolio-kpi-value">{largestHolding?.symbol ?? '—'}</strong>
                <span className="portfolio-kpi-note">
                  {largestHolding ? `${largestHolding.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ${t('of portfolio')}` : valuationHoldings.length > 0 ? t('Current prices required') : t('No position yet')}
                </span>
              </div>
            </div>
          </div>

          <div className="card portfolio-focus-card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Shariah Health')}</div>
                <div className="panel-subtitle">
                  {t('Portfolio distribution by Shariah compliance status.')}
                </div>
              </div>
            </div>

            <div className="portfolio-focus-list">
              {([
                { status: 'compliant', color: 'var(--green)' },
                { status: 'non_compliant', color: 'var(--red)' },
                { status: 'review_required', color: 'var(--yellow)' },
                { status: 'insufficient_data', color: 'var(--text-muted)' },
              ] as const).map(({ status, color }) => (
                <button
                  key={status}
                  className={`portfolio-focus-row btn-ghost ${complianceFilter === status ? 'active' : ''}`}
                  onClick={() => {
                    setComplianceFilter(complianceFilter === status ? null : status);
                    document.getElementById('holdings-detail')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '10px 8px', borderRadius: 8 }}
                >
                  <div className="portfolio-focus-copy">
                    <span className="portfolio-focus-dot" style={{ background: color }} />
                    <strong>{t(getShariahDecisionLabel(status))}</strong>
                  </div>
                  <div className="portfolio-focus-value" style={{ color: status === 'non_compliant' && complianceDistribution[status] > 0 ? 'var(--red)' : 'inherit' }}>
                    {!portfolioValuationAvailable && valuationHoldings.length > 0
                      ? t('Unavailable')
                      : complianceDistribution.total > 0
                        ? formatPct((complianceDistribution[status] / complianceDistribution.total) * 100)
                        : '0%'}
                  </div>
                </button>
              ))}

              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-muted)' }}>
                {complianceDistribution.non_compliant > 0
                  ? t('The implemented screen flags one or more assets as non-compliant. Review the methodology and evidence before taking action.')
                  : complianceDistribution.review_required > 0
                    ? t('Some assets require manual Shariah review.')
                    : complianceDistribution.insufficient_data > 0
                      ? t('Shariah status is unavailable for some assets because evidence is missing.')
                      : complianceDistribution.total > 0
                        ? t('All assessed assets meet the implemented screening methodology.')
                        : valuationHoldings.length > 0 && !portfolioValuationAvailable
                          ? t('Current prices required')
                          : t('No assets available for Shariah assessment.')}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Portfolio Development')}</div>

            </div>

          </div>



          {emptyPortfolio ? <p className="panel-subtitle">{t('Portfolio development appears once transactions are available.')}</p> : <div style={{ height: 400 }} dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={chartDisplayData} margin={{ top: 0, right: 0, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id="portfolioDevelopmentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--series-market)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--series-market)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.6} />
                <XAxis
                  dataKey="chartIndex"
                  type="number"
                  domain={[0, Math.max(chartDisplayData.length - 1, 0)]}
                  allowDecimals={false}
                  tickFormatter={(value) => chartDisplayData[Number(value)]?.shortDate ?? ''}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  minTickGap={60}
                  height={30}
                  padding={{ left: 10, right: 5 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={<RenderCustomAxisTick isRtl={language === 'ar'} domain={chartDomain} locale={numberLocale} />}
                  orientation={language === 'ar' ? 'right' : 'left'}
                  domain={chartDomain}
                  width={getChartAxisWidth(chartDomain, numberLocale, { suffix: '%' })}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }

                    const point = chartDisplayData[Number(label)] ?? payload[0]?.payload;
                    if (!point) {
                      return null;
                    }

                    return (
                      <div
                        style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 12,
                          color: 'var(--text-primary)',
                          padding: 12,
                          minWidth: 220,
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{point.shortDate}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{t('Market value')}</span>
                          <strong>{formatMoney(point.marketValue)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{t('Invested capital')}</span>
                          <strong>{formatMoney(point.invested)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{t('Performance')}</span>
                          <strong style={{ color: point.chartMarketValue >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {formatPct(point.chartMarketValue)}
                          </strong>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Area
                  type="monotone"
                  dataKey="chartMarketValue"
                  name={t('Performance')}
                  stroke="var(--series-market)"
                  fill="url(#portfolioDevelopmentFill)"
                  strokeWidth={2.4}
                />
                <Line
                  type="monotone"
                  dataKey="chartInvested"
                  name={t('0% reference')}
                  stroke="var(--series-invested)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>}
        </div>

        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Allocation Overview')}</div>

            </div>
          </div>

          <div className="portfolio-allocation-grid">
            <div className="portfolio-allocation-chart">
              {categoryAssets.length > 0 ? (
                <PortfolioDonut assets={categoryAssets} totalValue={allocationValue} countLabel={t('Categories')} hoveredSymbol={hoveredSymbol} onHover={setHoveredSymbol} />
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <PieChart size={22} />
                  </div>
                  {allocationHoldings.length > 0 && !portfolioValuationAvailable
                    ? t('Current market data is unavailable for one or more holdings.')
                    : t('Add positions to see the allocation split.')}
                </div>
              )}
            </div>

            <div className="portfolio-allocation-list">
              {activeCategoryBreakdown.length > 0 ? (
                activeCategoryBreakdown.map((bucket, index) => {
                  const color = assetColor(bucket.assetClass.toUpperCase(), index);
                  return (
                    <div
                      key={bucket.assetClass}
                      className={`portfolio-allocation-row ${hoveredSymbol === bucket.assetClass.toUpperCase() ? 'hovered' : ''}`}
                      onMouseEnter={() => setHoveredSymbol(bucket.assetClass.toUpperCase())}
                      onMouseLeave={() => setHoveredSymbol(null)}
                    >
                      <div className="portfolio-allocation-main">
                        <div className="portfolio-allocation-topline">
                          <AssetIcon
                            symbol={bucket.assetClass.toUpperCase()}
                            name={bucket.label}
                            assetClass={bucket.assetClass as AssetClass}
                            size={28}
                            color={color}
                          />
                          <strong>{t(bucket.label)}</strong>
                          <span className="portfolio-allocation-share">{bucket.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>
                        </div>
                        <div className="portfolio-allocation-meta">
                          {t(`${bucket.positions} positions \u00b7 top holding ${bucket.topHolding?.symbol ?? '\u2014'}`)}
                        </div>
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${bucket.allocation}%`, background: color }} />
                        </div>
                      </div>

                      <div className="portfolio-allocation-side">
                        <strong>{formatMoney(bucket.currentValue)}</strong>
                        <span style={{ color: bucket.costBasisAvailable ? bucket.pnl >= 0 ? 'var(--green)' : 'var(--red)' : 'var(--text-muted)' }}>
                          {bucket.costBasisAvailable
                            ? `${bucket.pnl >= 0 ? '+' : '−'}${formatMoney(Math.abs(bucket.pnl))}`
                            : t('Unavailable')}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">
                  {portfolioValuationAvailable
                    ? t('No active sleeves yet.')
                    : t('Current market data is unavailable for one or more holdings.')}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Biggest Positions')}</div>
                <div className="panel-subtitle">
                  {t('Start here if you want to know what currently drives the portfolio most.')}
                </div>
              </div>
            </div>

            <div className="portfolio-top-holdings">
              {topHoldings.length > 0 ? (
                topHoldings.map((asset, index) => {
                  const color = assetColor(asset.symbol, index);
                  return (
                    <div key={asset.symbol} className="portfolio-top-holding-row">
                      <div className="portfolio-top-holding-main">
                        <div className="portfolio-top-holding-symbol" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <AssetIcon
                            symbol={asset.symbol}
                            name={asset.name}
                            assetClass={asset.assetClass as AssetClass}
                            size={20}
                            color={color}
                          />
                          <strong>{asset.symbol}</strong>
                        </div>
                        <div className="portfolio-top-holding-meta">
                          {asset.name} · {asset.assetClass === 'cash' ? t('Cash') : ASSET_CLASS_LABELS[asset.assetClass]}
                        </div>
                      </div>

                      <div className="portfolio-top-holding-side">
                        <strong>
                          {asset.valuationAvailable ? formatMoney(asset.value) : t('Unavailable')}
                        </strong>
                        <span>
                          {asset.valuationAvailable
                            ? `${asset.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ${t('weight')}`
                            : t('Weight unavailable')}
                        </span>
                        <span style={{ color: asset.valuationAvailable && asset.costBasisAvailable ? asset.pnl >= 0 ? 'var(--green)' : 'var(--red)' : 'var(--text-muted)' }}>
                          {asset.valuationAvailable && asset.costBasisAvailable
                            ? `${asset.pnl >= 0 ? '+' : '−'}${formatMoney(Math.abs(asset.pnl))}`
                            : t('Unavailable')}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">{t('No open positions yet.')}</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Metals Watch')}</div>
              </div>
            </div>

            {metalSleeve ? (
              <>
                <div className="summary-strip" style={{ marginBottom: 16 }}>
                  <div className="summary-item">
                    <span>{t('Metals category')}</span>
                    <strong>{formatMoney(metalSleeve.currentValue)}</strong>
                  </div>
                  <div className="summary-item">
                    <span title={t('Share of total portfolio value')}>{t('Portfolio share')}</span>
                    <strong>{metalSleeve.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong>
                  </div>
                  <div className="summary-item">
                    <span>{t('Dominant metal')}</span>
                    <strong>{dominantMetal?.symbol ?? '\u2014'}</strong>
                  </div>
                  <div className="summary-item">
                    <span>{t('Tax-free lots')}</span>
                    <strong>{matureMetalLots}</strong>
                  </div>
                </div>
                <div className="portfolio-metals-shell">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="card-title">{t('Gold / Silver Ratio')}</div>
                    {goldSilverRatio && (
                      <span className={`status-pill ${goldSilverRatio.isVerified ? 'success' : 'warn'}`} style={{ fontSize: 10, padding: '2px 8px' }}>
                        {goldSilverRatio.isVerified ? <Check size={10} /> : <Activity size={10} />}
                        {goldSilverRatio.isVerified ? t('Independently verified') : t('Not independently verified')}
                      </span>
                    )}
                  </div>
                  <div className="card-value" style={{ fontSize: 30 }}>
                    {goldSilverRatio ? `${goldSilverRatio.ratio.toFixed(1)}x` : '\u2014'}
                  </div>
                  <div className="card-change" style={{ color: 'var(--text-secondary)' }}>
                    {goldSilverRatio ? t(goldSilverRatio.label) : t(goldSilverRatioUnavailableLabel)}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {goldSilverRatio
                      ? t(goldSilverRatio.description)
                      : t('The scale is shown already; the marker appears as soon as both metal prices are available.')}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', opacity: 0.8, fontStyle: 'italic' }}>
                    {goldSilverRatio?.asOf
                      ? `${t('Calculated from matching closes as of')} ${new Date(`${goldSilverRatio.asOf}T00:00:00.000Z`).toLocaleDateString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}.`
                      : t('Data sources vary by asset and availability. Missing or unverified inputs remain unavailable.')}
                  </div>

                  <div className={`metal-ratio-valuation ${goldSilverRatio ? '' : 'is-muted'}`}>
                    <div className="metal-ratio-valuation-header">
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {t(goldSilverRatio ? 'Ratio reference band' : 'Ratio scale')}
                      </div>
                      <span className={`status-pill ${goldSilverRatio ? 'neutral' : 'warn'}`}>
                        {t(goldSilverRatio ? goldSilverRatio.bandLabel : 'Waiting for prices')}
                      </span>
                    </div>

                    <div className="metal-ratio-meter" aria-label={t('Gold to silver ratio reference scale')}>
                      <div className="metal-ratio-meter-track">
                        {goldSilverRatio ? (
                          <div
                            className="metal-ratio-meter-marker"
                            style={{ left: `calc(${goldSilverRatio.ratioPositionPct}% - 9px)` }}
                          />
                        ) : null}
                      </div>

                      <div className="metal-ratio-meter-labels">
                        <span>45x</span>
                        <span>75x</span>
                        <span>105x</span>
                      </div>

                      <div className="metal-ratio-meter-thresholds">
                        <span>&lt; 60x</span>
                        <span>60-75x</span>
                        <span>75-90x</span>
                        <span>90x+</span>
                      </div>
                    </div>

                    <div className={`callout ${goldSilverRatio ? 'info' : 'warning'}`} style={{ marginTop: 14 }}>
                      <Target size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
                      <div>
                        {goldSilverRatio ? (
                          <>
                            <strong>{t(goldSilverRatio.bandLabel)}.</strong> {t(goldSilverRatio.bandDescription)}
                          </>
                        ) : (
                          <>
                            <strong>{t('Marker unavailable')}.</strong> {t(goldSilverRatioUnavailableLabel)}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Activity size={22} />
                </div>
                {t('No metals exposure detected yet.')}
              </div>
            )}
          </div>
        </div>

        <div id="holdings-detail" className="card desktop-only" style={{ padding: 0 }}>
          <div className="table-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div className="section-title">{t('Holdings Detail')}</div>
              </div>
              {complianceFilter && (
                <div className="badge badge-teal" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px' }}>
                  <span>{t(getShariahDecisionLabel(complianceFilter))}</span>
                  <button
                    onClick={() => setComplianceFilter(null)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            <span className="badge badge-teal">{holdingsTable.length} {t('positions')}</span>
          </div>

          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>{t('Asset')}</th>
                  <th>{t('Position')}</th>
                  <th>{t('Value now')}</th>
                  <th>{t('Gain / loss')}</th>
                  <th>{t('Weight & venue')}</th>
                </tr>
              </thead>
              <tbody>
                {holdingsTable.map((asset, index) => {
                  const color = assetColor(asset.symbol, index);
                  const costBasis = asset.amount * asset.avgCost;

                  return (
                    <tr key={asset.symbol}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <AssetIcon
                            symbol={asset.symbol}
                            name={asset.name}
                            assetClass={asset.assetClass as AssetClass}
                            color={color}
                          />
                          <div>
                            <div style={{ fontWeight: 700 }}>{asset.symbol}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(asset.name || asset.symbol)}</div>
                            <div style={{ marginTop: 6 }}>
                              <span className={`badge ${asset.assetClass === 'cash' ? 'badge-gray' : ASSET_CLASS_BADGE_CLASSES[asset.assetClass]}`}>
                                {asset.assetClass === 'cash' ? t('Cash') : t(ASSET_CLASS_LABELS[asset.assetClass])}
                              </span>
                              {asset.assetClass !== 'cash' && getAssetShariahStatus(asset.symbol) !== 'compliant' && (
                                <span
                                  className={`badge ${
                                    getAssetShariahStatus(asset.symbol) === 'non_compliant'
                                      ? 'badge-red'
                                      : getAssetShariahStatus(asset.symbol) === 'review_required'
                                        ? 'badge-yellow'
                                        : 'badge-gray'
                                  }`}
                                  style={{ marginLeft: 6 }}
                                >
                                  {t(getShariahDecisionLabel(getAssetShariahStatus(asset.symbol)))}
                                </span>
                              )}

                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="mono" style={{ fontWeight: 700 }}>
                          {asset.amount}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {asset.costBasisAvailable
                            ? t(`Avg cost ${formatMoney(asset.avgCost)}`)
                            : `${t('Avg cost')}: ${t('Unavailable')}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {asset.costBasisAvailable
                            ? t(`Spent ${formatMoney(costBasis)}`)
                            : `${t('Spent')}: ${t('Unavailable')}`}
                        </div>
                      </td>
                      <td>
                        <div className="mono" style={{ fontWeight: 700 }}>
                          {asset.valuationAvailable
                            ? formatMoney(asset.value)
                            : t('Unavailable')}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {asset.valuationAvailable
                            ? asset.assetClass === 'metal'
                              ? <>{t('Price')} <bdi dir="ltr">{formatMoney(asset.currentPrice, 2, 2)}{t('/g')}</bdi></>
                              : t(`Price ${formatMoney(asset.currentPrice)}`)
                            : `${t('Price')}: ${t('Unavailable')}`}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <span className={`badge badge-lg ${
                            asset.change24h === null
                              ? 'neutral'
                              : asset.change24h >= 0
                                ? 'badge-green'
                                : 'badge-red'
                          }`}>
                            {asset.change24h === null
                              ? `${t(asset.changePeriod === 'session' ? 'Session' : '24h')}: ${t('Unavailable')}`
                              : `${t(asset.changePeriod === 'session' ? 'Session' : '24h')} ${formatPct(asset.change24h)}`}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div
                          className="mono"
                          style={{ color: asset.valuationAvailable && asset.costBasisAvailable ? asset.pnl >= 0 ? 'var(--green)' : 'var(--red)' : 'var(--text-muted)', fontWeight: 700 }}
                        >
                          {asset.valuationAvailable && asset.costBasisAvailable
                            ? `${asset.pnl >= 0 ? '+' : '−'}${formatMoney(Math.abs(asset.pnl))}`
                            : t('Unavailable')}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {asset.valuationAvailable && asset.costBasisAvailable
                            ? t(`${formatPct(asset.pnlPct)} unrealized`)
                            : asset.valuationAvailable
                              ? t('Historical FX data required')
                              : t('Current prices required')}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {!asset.financialMetricsAvailable
                            ? `${t('Realized')}: ${t('Unavailable')}`
                            : asset.realizedPnl === 0
                            ? `${t('Realized')} ${formatMoney(0)}`
                            : t(`Realized ${asset.realizedPnl > 0 ? '+' : '\u2212'}${formatMoney(Math.abs(asset.realizedPnl))}`)}
                        </div>
                      </td>
                      <td>
                        {asset.valuationAvailable && portfolioValuationAvailable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="progress-bar" style={{ width: 96 }}>
                              <div className="progress-fill" style={{ width: `${asset.allocation}%`, background: color }} />
                            </div>
                            <span className="mono" style={{ fontSize: 12, color, fontWeight: 700 }}>
                              {asset.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                            </span>
                          </div>
                        ) : (
                          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                            {t('Unavailable')}
                          </span>
                        )}
                        <div className="mono" style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>
                          {getVenueMeta(asset.primaryVenue, manualAccounts).label}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {asset.oldestOpenLotAt ? t(`Held since ${asset.oldestOpenLotAt.slice(0, 10)}`) : t('No open-lot date')}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {t(`Fees ${formatMoney(asset.totalFeesEur)}`)}
                          {asset.holdingDays !== null ? t(` \u00b7 ${asset.holdingDays} days`) : ''}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card mobile-only">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Holdings')}</div>
              <div className="panel-subtitle">
                {t('Mobile summary with value, return, weight, and broker.')}
              </div>
            </div>
            <span className="badge badge-teal">{holdings.length} {t('open positions')}</span>
          </div>

          <div className="mobile-card-list">
            {holdingsTable.map((asset, index) => {
              const color = assetColor(asset.symbol, index);
              const costBasis = asset.amount * asset.avgCost;

              return (
                <div key={asset.symbol} className="mobile-data-card">
                  <div className="mobile-data-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <AssetIcon
                        symbol={asset.symbol}
                        name={asset.name}
                        assetClass={asset.assetClass as AssetClass}
                        size={28}
                        color={color}
                      />
                      <div>
                        <div className="mobile-data-title">{asset.symbol}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                          {t(asset.name || asset.symbol)} · {asset.assetClass === 'cash' ? t('Cash') : t(ASSET_CLASS_LABELS[asset.assetClass])}
                        </div>
                      </div>
                    </div>
                    <span className="mono" style={{ color, fontWeight: 800 }}>
                      {asset.valuationAvailable && portfolioValuationAvailable
                        ? `${asset.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                        : t('Unavailable')}
                    </span>
                  </div>

                  <div className="mobile-data-grid">
                    {asset.assetClass === 'metal' && (
                      <div className="mobile-data-row">
                        <span className="mobile-data-label">{t('Price')}</span>
                        <strong className="mobile-data-value">
                          {asset.valuationAvailable
                            ? <bdi dir="ltr">{formatMoney(asset.currentPrice, 2, 2)}{t('/g')}</bdi>
                            : t('Unavailable')}
                        </strong>
                      </div>
                    )}
                    <div className="mobile-data-row">
                      <span className="mobile-data-label">{t('Value')}</span>
                      <strong className="mobile-data-value">
                        {asset.valuationAvailable
                          ? formatMoney(asset.value)
                          : t('Unavailable')}
                      </strong>
                    </div>
                    <div className="mobile-data-row">
                      <span className="mobile-data-label">{t('Invested')}</span>
                      <strong className="mobile-data-value">
                        {asset.costBasisAvailable ? formatMoney(costBasis) : t('Unavailable')}
                      </strong>
                    </div>
                    <div className="mobile-data-row">
                      <span className="mobile-data-label">{t('Unrealized')}</span>
                      <strong
                        className="mobile-data-value"
                        style={{ color: asset.valuationAvailable && asset.costBasisAvailable ? asset.pnl >= 0 ? 'var(--green)' : 'var(--red)' : 'var(--text-muted)' }}
                      >
                        {asset.valuationAvailable && asset.costBasisAvailable
                          ? `${asset.pnl >= 0 ? '+' : '\u2212'}${formatMoney(Math.abs(asset.pnl))}`
                          : t('Unavailable')}
                      </strong>
                    </div>
                    <div className="mobile-data-row">
                      <span className="mobile-data-label">{t('Broker')}</span>
                      <strong className="mobile-data-value">{getVenueMeta(asset.primaryVenue, manualAccounts).label}</strong>
                    </div>
                  </div>

                  <div className="mobile-action-row" style={{ marginTop: 12 }}>
                    <span className={`badge badge-lg ${
                      asset.change24h === null
                        ? 'neutral'
                        : asset.change24h >= 0
                          ? 'badge-green'
                          : 'badge-red'
                    }`}>
                      {asset.change24h === null
                        ? `${t(asset.changePeriod === 'session' ? 'Session' : '24h')}: ${t('Unavailable')}`
                        : `${t(asset.changePeriod === 'session' ? 'Session' : '24h')} ${formatPct(asset.change24h)}`}
                    </span>
                    <span className="badge badge-blue">
                      {asset.costBasisAvailable
                        ? t(`Avg ${formatMoney(asset.avgCost)}`)
                        : `${t('Avg')}: ${t('Unavailable')}`}
                    </span>
                    <span className="badge badge-teal">
                      {asset.oldestOpenLotAt ? t(`Since ${asset.oldestOpenLotAt.slice(0, 10)}`) : t('Open lot')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
