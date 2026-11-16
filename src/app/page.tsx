'use client';

import Link from 'next/link';
import AppShell from '@/components/layout/app-shell';
import DashboardBacktest from '@/components/dashboard/dashboard-backtest';
import PortfolioDonut from '@/components/dashboard/portfolio-donut';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HIDDEN_ACCOUNTS_EVENT,
  readHiddenAccountVenues,
} from '@/lib/accounts/account-visibility-store';
import {
  getAllManualAccounts,
  isPortfolioVenue,
  MANUAL_ACCOUNTS_EVENT,
  readManualAccounts,
} from '@/lib/accounts/manual-accounts-store';
import { DEMO_PORTFOLIO_GROWTH } from '@/lib/demo/investment-data';
import { getDemoSnapshotAsOfDay } from '@/lib/demo/showcase-snapshot';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  buildHoldingLedgerInsights,
  buildPortfolioMonitorSeries,
} from '@/lib/portfolio/ux-insights';
import { buildInvestedPerformanceCashFlows } from '@/lib/portfolio/benchmarking';
import {
  buildAccountGroups,
  buildAccountSummaries,
  getVenueMeta,
} from '@/lib/portfolio/account-overview';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_OPTIONS,
  type AssetClass,
} from '@/lib/config/supported-assets';
import { calculateInvestmentTaxOverview } from '@/lib/tax/investment-tax';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_EVENT,
} from '@/lib/tax/tax-profile-store';
import { readAssetIcons } from '@/lib/config/asset-icon-store';
import { DEFAULT_TAX_PROFILE_SETTINGS } from '@/lib/tax/tax-profile';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
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
  type CurrentFxRatesToEur,
  type CurrentValuationPrices,
} from '@/lib/portfolio/current-valuation';
import {
  createCurrentQuoteRequestCoordinator,
  fetchCurrentQuoteBatches,
  shouldRefreshCurrentQuotes,
  type CurrentQuoteRefreshPolicy,
} from '@/lib/financial-data/quotes/client';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  LayoutDashboard,
  Microscope,
  PieChart,
  Plus,
  RefreshCw,
  WalletCards,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import dynamic from 'next/dynamic';

const DashboardChart = dynamic(() => import('@/components/dashboard/dashboard-chart'), { ssr: false });

interface MarketPrice {
  price: number;
  change24h: number | null;
  changePeriod?: '24h' | 'session' | 'unavailable';
  volume24h: number | null;
  marketCap: number | null;
}

interface AssetHolding {
  symbol: string;
  name: string;
  assetClass: AssetClass | 'cash';
  amount: number;
  avgCost: number;
  venue: string;
  price: number;
  value: number;
  change24h: number | null;
  changePeriod: '24h' | 'session' | 'unavailable';
  allocation: number;
  costBasisAvailable: boolean;
  valuationAvailable: boolean;
}

type DashboardRange = '1D' | '7D' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
type DashboardChartMode = 'value' | 'performance';
type DashboardExperience = 'beginner' | 'advanced';

const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; days: number | null }> = [
  { value: '1D', label: '1D', days: 2 },
  { value: '7D', label: '7D', days: 7 },
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '6M', label: '6M', days: 180 },
  { value: '1Y', label: '1Y', days: 365 },
  { value: 'ALL', label: 'All', days: null },
];

function formatMonthRangeLabel(value: string, language: string) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(
    language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US',
    {
      month: 'short',
      year: 'numeric',
    },
  ).format(new Date(Date.UTC(year, month - 1, 1)));
}

function buildAssetSnapshot(
  baseHoldings: DerivedHolding[],
  prices?: Record<string, MarketPrice>,
  fxRatesToEur?: CurrentFxRatesToEur,
): AssetHolding[] {
  return buildCurrentHoldingValuations(
    baseHoldings,
    prices as CurrentValuationPrices | undefined,
    fxRatesToEur,
  ).map(({ currentPrice, ...holding }) => ({
    ...holding,
    price: currentPrice,
  }));
}

function addRangePerformanceToChartData<T extends { date: string; marketValue: number; invested: number }>(
  rows: T[],
  cashFlowsByDate: Map<string, number>,
) {
  let previousMarketValue = 0;
  let cumulativeFactor = 1;
  let hasStarted = false;

  return rows.map((point) => {
    const pnl = point.marketValue - point.invested;
    const pnlPct = point.invested > 0 ? (pnl / point.invested) * 100 : 0;
    const flow = cashFlowsByDate.get(point.date) ?? 0;
    let rangeReturnPct = 0;

    if (!hasStarted || previousMarketValue <= 0 || point.marketValue <= 0) {
      hasStarted = point.marketValue > 0;
    } else {
      const periodReturn = (point.marketValue - previousMarketValue - flow) / previousMarketValue;
      if (Number.isFinite(periodReturn)) {
        cumulativeFactor *= 1 + periodReturn;
      }
      rangeReturnPct = (cumulativeFactor - 1) * 100;
    }

    previousMarketValue = point.marketValue;

    return {
      ...point,
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2)),
      rangeReturnPct: Number(rangeReturnPct.toFixed(2)),
    };
  });
}

export default function DashboardPage() {
  const { t, language } = useAppTranslation();
  const {
    displayCurrency,
    formatMoney,
    formatSignedMoney,
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
  const [mounted, setMounted] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DashboardRange>('1Y');
  const [chartMode, setChartMode] = useState<DashboardChartMode>('performance');
  const [hoveredDashboardSymbol, setHoveredDashboardSymbol] = useState<string | null>(null);

  const [manualAccounts, setManualAccounts] = useState<ReturnType<typeof getAllManualAccounts>>([]);
  const [hiddenAccountVenues, setHiddenAccountVenues] = useState<string[]>([]);
  const [taxProfileSettings, setTaxProfileSettings] = useState(DEFAULT_TAX_PROFILE_SETTINGS);
  const [assetIcons, setAssetIcons] = useState<Record<string, string>>({});
  const hiddenVenueSet = useMemo(() => new Set(hiddenAccountVenues), [hiddenAccountVenues]);
  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => !hiddenVenueSet.has(transaction.venue) && isPortfolioVenue(transaction.venue, manualAccounts)),
    [transactions, hiddenVenueSet, manualAccounts],
  );

  const [historicalPrices, setHistoricalPrices] = useState<Record<string, Array<{date: string, close: number}>>>({});
  
  useEffect(() => {
    const fetchHistoricalPrices = async () => {
      const symbols = [...new Set(visibleTransactions.map(tx => tx.asset))];
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
    
    if (visibleTransactions.length > 0) {
      fetchHistoricalPrices();
    }
  }, [visibleTransactions]);
  const baseHoldings = useMemo(
    () => deriveHoldingsFromTransactions(visibleTransactions),
    [visibleTransactions],
  );
  const hasPriceableHoldings = baseHoldings.some(
    (holding) => holding.assetClass !== 'cash',
  );
  const [syncing, setSyncing] = useState(false);
  const [assets, setAssets] = useState<AssetHolding[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingPriceSymbols, setMissingPriceSymbols] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    // Hydrate state from localStorage on client mount
    setAssetIcons(readAssetIcons());
    setTransactions(getAllTransactions());
    setManualAccounts(getAllManualAccounts());
    setHiddenAccountVenues(readHiddenAccountVenues());
    setTaxProfileSettings(readTaxProfileSettings());

    const syncIcons = () => setAssetIcons(readAssetIcons());
    window.addEventListener('investatlas.asset-icons-updated', syncIcons);

    const syncTransactions = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setTransactions(event.detail);
      } else {
        setTransactions(getAllTransactions());
      }
    };
    const syncManualAccounts = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setManualAccounts(event.detail);
      } else {
        setManualAccounts(getAllManualAccounts());
      }
    };
    const syncHiddenAccounts = () => {
      setHiddenAccountVenues(readHiddenAccountVenues());
    };
    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
    window.addEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncManualAccounts);
    window.addEventListener('storage', syncHiddenAccounts);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener('investatlas.asset-icons-updated', syncIcons);
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
      window.removeEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncManualAccounts);
      window.removeEventListener('storage', syncHiddenAccounts);
      window.removeEventListener('storage', syncTaxProfile);
    };
  }, []);
  const quoteRefreshPolicyRef = useRef<CurrentQuoteRefreshPolicy>('unknown');
  const quoteRequestCoordinatorRef = useRef<ReturnType<typeof createCurrentQuoteRequestCoordinator> | null>(null);
  if (!quoteRequestCoordinatorRef.current) {
    quoteRequestCoordinatorRef.current = createCurrentQuoteRequestCoordinator();
  }

  const fetchPrices = useCallback(async () => {
    let shouldFinalizeRequest = true;
    setSyncing(true);
    setError(null);
    setMissingPriceSymbols([]);

    try {
      if (baseHoldings.length === 0) {
        quoteRefreshPolicyRef.current = 'unknown';
        setAssets([]);
        setLastSync(null);
        setIsLive(false);
        return quoteRefreshPolicyRef.current;
      }

      const priceableHoldings = baseHoldings.filter((holding) => holding.assetClass !== 'cash');
      if (priceableHoldings.length === 0) {
        quoteRefreshPolicyRef.current = 'unknown';
        setAssets(buildAssetSnapshot(baseHoldings, undefined, fxRatesToEur));
        setLastSync(new Date().toISOString());
        setIsLive(false);
        return quoteRefreshPolicyRef.current;
      }

      const symbols = priceableHoldings.map((holding) => holding.symbol);
      const outcome = await quoteRequestCoordinatorRef.current!.run(
        `eur:${[...symbols].sort().join(',')}`,
        (signal) => fetchCurrentQuoteBatches(symbols, 'eur', undefined, signal),
      );
      if (outcome.status === 'stale') {
        shouldFinalizeRequest = false;
        return quoteRefreshPolicyRef.current;
      }
      if (outcome.status === 'current_error') {
        throw outcome.error;
      }
      const data = outcome.value;
      quoteRefreshPolicyRef.current = data.refreshPolicy;
      if (data.status === 'unavailable') {
        setMissingPriceSymbols(data.failedSymbols);
        throw new Error('Price fetch failed');
      }

      const prices = data.prices as Record<string, MarketPrice>;
      const nextAssets = buildAssetSnapshot(baseHoldings, prices, fxRatesToEur);
      const valuationComplete = isCurrentValuationComplete(nextAssets);
      setAssets(nextAssets);
      setLastSync(data.timestamp);
      setIsLive(valuationComplete);
      if (!valuationComplete) {
        setMissingPriceSymbols([...new Set([
          ...data.failedSymbols,
          ...nextAssets.filter((asset) => !asset.valuationAvailable && asset.assetClass !== 'cash').map((asset) => asset.symbol),
        ])]);
        setError('Current market data is unavailable for one or more holdings.');
      }
    } catch (fetchError) {
      setMissingPriceSymbols((previous) => previous.length ? previous
        : baseHoldings.filter((holding) => holding.assetClass !== 'cash').map((holding) => holding.symbol));
      setAssets(buildAssetSnapshot(baseHoldings, undefined, fxRatesToEur));
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch prices');
      setIsLive(false);
    } finally {
      if (shouldFinalizeRequest) {
        setSyncing(false);
      }
    }
    return quoteRefreshPolicyRef.current;
  }, [baseHoldings, fxRatesToEur]);

  useEffect(() => {
    setAssets(
      baseHoldings.length > 0
        ? buildAssetSnapshot(baseHoldings, undefined, fxRatesToEur)
        : [],
    );
    setSyncing(false);
    return () => quoteRequestCoordinatorRef.current?.cancel();
  }, [baseHoldings, fxRatesToEur]);

  useEffect(() => {
    if (
      visibleTransactions.length > 0
      && shouldRefreshCurrentQuotes(
        quoteRefreshPolicyRef.current,
        document.visibilityState,
      )
    ) {
      void fetchPrices();
    }
  }, [fetchPrices, visibleTransactions.length]);

  useEffect(() => {
    if (!hasPriceableHoldings) return;

    const refreshIfEligible = () => {
      if (
        shouldRefreshCurrentQuotes(
          quoteRefreshPolicyRef.current,
          document.visibilityState,
        )
      ) {
        void fetchPrices();
      }
    };
    const interval = window.setInterval(refreshIfEligible, 60_000);
    document.addEventListener('visibilitychange', refreshIfEligible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfEligible);
    };
  }, [fetchPrices, hasPriceableHoldings]);

  const taxOverview = useMemo(
    () => calculateInvestmentTaxOverview(visibleTransactions, taxProfileSettings),
    [taxProfileSettings, visibleTransactions],
  );
  const holdingInsights = useMemo(
    () => buildHoldingLedgerInsights(visibleTransactions, taxOverview),
    [taxOverview, visibleTransactions],
  );

  const valuationAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          !hiddenVenueSet.has(asset.venue) &&
          isPortfolioVenue(asset.venue, manualAccounts) &&
          (asset.assetClass !== 'cash' || asset.amount > 0),
      ),
    [assets, hiddenVenueSet, manualAccounts],
  );
  const dashboardAllocationAssets = useMemo(() => {
    const displayAssets = valuationAssets.filter(
      (asset) =>
        asset.assetClass !== 'cash' ||
        getVenueMeta(asset.venue, manualAccounts).cashCategory === 'savings_cash',
    );
    const displayTotal = isCurrentValuationComplete(displayAssets)
      ? displayAssets.reduce((sum, asset) => sum + asset.value, 0)
      : 0;

    return displayAssets.map((asset) => ({
      ...asset,
      allocation: displayTotal > 0 ? (asset.value / displayTotal) * 100 : 0,
    }));
  }, [manualAccounts, valuationAssets]);
  const chartExcludedCashVenues = useMemo(() => {
    const venues = new Set<string>();
    manualAccounts.forEach((account) => venues.add(account.venue));
    visibleTransactions.forEach((transaction) => {
      venues.add(transaction.venue);
      if (transaction.settlementVenue) {
        venues.add(transaction.settlementVenue);
      }
    });

    return [...venues];
  }, [manualAccounts, visibleTransactions]);
  const negativeCashBalances = useMemo(
    () => getNegativeCashBalances(visibleTransactions),
    [visibleTransactions],
  );
  const totalNegativeCash = negativeCashBalances.reduce((sum, balance) => sum + balance.value, 0);
  const totalValue = valuationAssets.reduce((sum, asset) => sum + asset.value, 0);
  const dashboardValuationAvailable = isCurrentValuationComplete(valuationAssets);
  const valuedPositions = valuationAssets.filter((asset) => asset.valuationAvailable && Number.isFinite(asset.value));
  const partialValuedAmount = valuedPositions.reduce((sum, asset) => sum + asset.value, 0);
  const dashboardPortfolioValue = dashboardAllocationAssets.reduce((sum, asset) => sum + asset.value, 0);
  const dashboardPerformanceAssets = dashboardAllocationAssets.filter((asset) => asset.assetClass !== 'cash');
  const dashboardCostBasisAvailable = dashboardPerformanceAssets.every(
    (asset) => asset.costBasisAvailable,
  );
  const dashboardPnlAvailable =
    dashboardValuationAvailable && dashboardCostBasisAvailable;
  const dashboardPerformanceValue = dashboardPerformanceAssets.reduce((sum, asset) => sum + asset.value, 0);
  const dashboardInvestedCapital = dashboardPerformanceAssets.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0);
  const unrealizedPnl = dashboardPnlAvailable
    ? dashboardPerformanceValue - dashboardInvestedCapital
    : 0;
  const largestAsset = dashboardValuationAvailable
    ? [...dashboardAllocationAssets].sort((left, right) => right.allocation - left.allocation)[0]
    : undefined;
  const valuationBreakdownAssets = dashboardValuationAvailable
    ? dashboardAllocationAssets
    : [];

  const categoryBreakdown = useMemo(() => {
    const buckets = ASSET_CLASS_OPTIONS.map((option) => {
      const sleeveHoldings = valuationBreakdownAssets.filter((asset) => asset.assetClass === option.value);
      const sleeveValue = sleeveHoldings.reduce((sum, asset) => sum + asset.value, 0);
      const invested = sleeveHoldings.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0);
      return {
        assetClass: option.value,
        label: option.label,
        positions: sleeveHoldings.length,
        value: sleeveValue,
        invested,
        topHolding: [...sleeveHoldings].sort((left, right) => right.value - left.value)[0],
      };
    });

    const cashHoldings = valuationBreakdownAssets.filter((asset) => asset.assetClass === 'cash');
    const savingCashHoldings = cashHoldings.filter(
      (asset) => getVenueMeta(asset.venue, manualAccounts).cashCategory === 'savings_cash',
    );
    const savingCashBucket = {
      assetClass: 'cash',
      label: 'Saving Cash',
      positions: savingCashHoldings.length,
      value: savingCashHoldings.reduce((sum, asset) => sum + asset.value, 0),
      invested: savingCashHoldings.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0),
      topHolding: [...savingCashHoldings].sort((left, right) => right.value - left.value)[0],
    };

    const allBuckets = [...buckets, savingCashBucket];
    const totalSleevesValue = allBuckets.reduce((sum, b) => sum + Math.max(b.value, 0), 0);

    return allBuckets.map((bucket) => ({
      ...bucket,
      allocation: totalSleevesValue > 0 ? (Math.max(bucket.value, 0) / totalSleevesValue) * 100 : 0,
    }));
  }, [manualAccounts, valuationBreakdownAssets]);

  const portfolioMonitorData = useMemo(
    () => {
      if (!dashboardPnlAvailable) return [];
      return buildPortfolioMonitorSeries(visibleTransactions, DEMO_PORTFOLIO_GROWTH, {
        monthKey: new Date().toISOString().slice(0, 7),
        asOfDay: getDemoSnapshotAsOfDay(visibleTransactions),
        invested: dashboardInvestedCapital,
        marketValue: dashboardPerformanceValue,
        sleeves: {
          crypto: categoryBreakdown.find((item) => item.assetClass === 'crypto')?.value ?? 0,
          stock: categoryBreakdown.find((item) => item.assetClass === 'stock')?.value ?? 0,
          etf: categoryBreakdown.find((item) => item.assetClass === 'etf')?.value ?? 0,
          metal: categoryBreakdown.find((item) => item.assetClass === 'metal')?.value ?? 0,
        },
      }, historicalPrices, {
        excludedCashVenues: chartExcludedCashVenues,
        language,
      });
    },
    [categoryBreakdown, chartExcludedCashVenues, dashboardInvestedCapital, dashboardPerformanceValue, dashboardPnlAvailable, historicalPrices, language, visibleTransactions],
  );
  const investedPerformanceCashFlows = useMemo(
    () => buildInvestedPerformanceCashFlows(visibleTransactions),
    [visibleTransactions],
  );

  const chartData = useMemo(() => {
    const selectedConfig = DASHBOARD_RANGE_OPTIONS.find((option) => option.value === selectedRange);
    if (!selectedConfig || selectedConfig.days === null) {
      return portfolioMonitorData;
    }

    return portfolioMonitorData.slice(-selectedConfig.days);
  }, [portfolioMonitorData, selectedRange]);

  const firstChartPoint = chartData[0];
  const firstValueChartPoint = chartData.find((point) => point.marketValue > 0) ?? firstChartPoint;
  const latestChartPoint = chartData[chartData.length - 1];
  const rangeContextLabel =
    firstValueChartPoint && latestChartPoint
      ? `${formatMonthRangeLabel(firstValueChartPoint.date, language)} – ${formatMonthRangeLabel(latestChartPoint.date, language)}`
      : t('Portfolio snapshot');
  const selectedRangeDividendIncome = chartData.reduce((sum, point) => sum + point.monthlyDividends, 0);
  const selectedRangeDividendPct =
    firstChartPoint && firstChartPoint.marketValue > 0
      ? (selectedRangeDividendIncome / firstChartPoint.marketValue) * 100
      : 0;
  const totalBookedDividends = latestChartPoint?.cumulativeDividends ?? 0;
  const chartDisplayData = useMemo(() => {
    const rows = addRangePerformanceToChartData(chartData, investedPerformanceCashFlows);
    if (selectedRange !== 'ALL') {
      return rows;
    }

    return rows.map((point) => ({
      ...point,
      rangeReturnPct: point.pnlPct,
    }));
  }, [chartData, investedPerformanceCashFlows, selectedRange]);
  const selectedRangeReturnPct = chartDisplayData[chartDisplayData.length - 1]?.rangeReturnPct ?? 0;



  const accountHoldingsTable = useMemo(
    () =>
      valuationAssets.map((asset) => ({
        ...asset,
        realizedPnl: holdingInsights[asset.symbol]?.realizedPnl ?? 0,
        primaryVenue: asset.venue,
        oldestOpenLotAt: holdingInsights[asset.symbol]?.oldestOpenLotAt ?? null,
        holdingDays: holdingInsights[asset.symbol]?.holdingDays ?? null,
        totalFeesEur: holdingInsights[asset.symbol]?.totalFeesEur ?? 0,
        financialMetricsAvailable:
          holdingInsights[asset.symbol]?.financialMetricsAvailable ?? false,
      })),
    [holdingInsights, valuationAssets],
  );

  const holdingsTable = useMemo(() => {
    const sorted = [...dashboardAllocationAssets].sort((left, right) => right.allocation - left.allocation);
    const rounded = sorted.map((asset) => Number(asset.allocation.toFixed(2)));
    const sumOfOthers = rounded.slice(1).reduce((sum, val) => sum + val, 0);
    
    return sorted.map((asset, index) => {
      const displayAllocation = index === 0 && rounded.length > 0 
        ? Number((100 - sumOfOthers).toFixed(2)) 
        : rounded[index];
        
      return {
        ...asset,
        displayAllocation,
        realizedPnl: holdingInsights[asset.symbol]?.realizedPnl ?? 0,
        primaryVenue: asset.venue,
        oldestOpenLotAt: holdingInsights[asset.symbol]?.oldestOpenLotAt ?? null,
        holdingDays: holdingInsights[asset.symbol]?.holdingDays ?? null,
        totalFeesEur: holdingInsights[asset.symbol]?.totalFeesEur ?? 0,
        financialMetricsAvailable:
          holdingInsights[asset.symbol]?.financialMetricsAvailable ?? false,
      };
    });
  }, [dashboardAllocationAssets, holdingInsights]);

  const allAccountSummaries = useMemo(
    () =>
      dashboardValuationAvailable
        ? buildAccountSummaries(
            accountHoldingsTable,
            totalValue,
            visibleTransactions,
            manualAccounts,
          )
        : [],
    [
      accountHoldingsTable,
      dashboardValuationAvailable,
      manualAccounts,
      totalValue,
      visibleTransactions,
    ],
  );
  const accountSummaries = useMemo(
    () => allAccountSummaries.filter((account) => !hiddenVenueSet.has(account.venue)),
    [allAccountSummaries, hiddenVenueSet],
  );
  const hiddenAccountCount = useMemo(() => {
    const trackedVenues = new Set([
      ...transactions.map((transaction) => transaction.venue),
      ...manualAccounts.map((account) => account.venue),
    ]);

    return [...trackedVenues].filter((venue) => hiddenVenueSet.has(venue)).length;
  }, [transactions, manualAccounts, hiddenVenueSet]);

  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: language !== 'de' 
      })
    : '—';


  const showSkeleton = syncing && !lastSync && assets.length === 0;
  const categoryDonutAssets = categoryBreakdown
    .filter((bucket) => bucket.value > 0)
    .map((bucket) => ({
      symbol: bucket.assetClass === 'cash' ? bucket.label.toUpperCase().replace(/\s+/g, '_') : bucket.assetClass.toUpperCase(),
      name: bucket.label,
      value: bucket.value,
      allocation: bucket.allocation,
      assetClass: bucket.assetClass === 'cash' ? undefined : bucket.assetClass as AssetClass,
    }));

  const largestAccount = accountSummaries[0];
  const topSleeves = [...categoryBreakdown]
    .filter((bucket) => bucket.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3);
  const featuredHoldings = holdingsTable.slice(0, 4);
  const accountGroups = useMemo(
    () => buildAccountGroups(accountSummaries),
    [accountSummaries],
  );

  if (!mounted) {
    return (
      <AppShell>
        <div className="page-header dashboard-page-header">
          <div className="page-header-row">
            <div className="page-header-main">
              <h1 className="page-title">
                <LayoutDashboard size={24} style={{ display: 'inline', marginRight: 8 }} />
                {t('Dashboard')}
              </h1>
            </div>
          </div>
        </div>
        <div className="page-content">
          <div className="card" style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RefreshCw className="loading-spin" />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-header dashboard-page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <LayoutDashboard size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Dashboard')}
            </h1>
          </div>

          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={fetchPrices} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'loading-spin' : undefined} />
              {syncing ? t('Refreshing…') : t('Refresh')}
            </button>
          </div>
        </div>
      </div>

      <div className="page-content dashboard-page-content animate-in">
        {error && (
          <div className="callout warn">
            <Activity size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Price sync degraded.')}</strong>{' '}
              {t('Current values and dependent calculations remain unavailable until every required price is sourced.')}
              {missingPriceSymbols.length > 0 && (
                <p style={{ marginTop: 6 }}>
                  {language === 'de' ? 'Fehlende Kurse für' : language === 'ar' ? 'الأسعار غير المتاحة لـ' : 'Missing prices for'}:{' '}
                  <bdi dir="ltr">{missingPriceSymbols.join(', ')}</bdi>
                </p>
              )}
            </div>
          </div>
        )}
        {!dashboardCostBasisAvailable && dashboardPerformanceAssets.length > 0 && (
          <div className="callout warn">
            <Activity size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Cost basis and P&L unavailable')}</strong>{' '}
              {t('At least one position requires a reliable historical FX conversion. Original transactions remain unchanged.')}
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

        <div className="dashboard-overview-grid">
          <div className="card dashboard-wealth-card">
            <div className="dashboard-wealth-head">
              <div className="dashboard-wealth-figure">
                <div className="card-title" style={{ marginBottom: 6 }}>{t('Current wealth')}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                  <span className="card-value">
                    {showSkeleton
                      ? <Skeleton width={180} height={32} borderRadius={8} />
                      : dashboardValuationAvailable
                        ? formatMoney(dashboardPortfolioValue)
                        : t('Unavailable')}
                  </span>
                  <span className={`card-change ${dashboardPnlAvailable && unrealizedPnl >= 0 ? 'positive' : 'negative'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {dashboardPnlAvailable ? (
                      <>
                        {unrealizedPnl >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {formatSignedMoney(unrealizedPnl)} ({formatPct(selectedRangeReturnPct)})
                      </>
                    ) : t('P&L unavailable')}
                  </span>
                </div>
                {!dashboardValuationAvailable && valuedPositions.length > 0 && (
                  <p className="panel-subtitle" style={{ marginTop: 10 }}>
                    {language === 'de' ? 'Bewertete Positionen (Teilwert, kein Portfoliogesamtwert)' : language === 'ar' ? 'المراكز المقيمة (قيمة جزئية وليست إجمالي المحفظة)' : 'Priced holdings (partial value, not portfolio total)'}:{' '}
                    <strong>{formatMoney(partialValuedAmount)}</strong>{' '}
                    ({valuedPositions.length}/{valuationAssets.length})
                  </p>
                )}
              </div>
            </div>

            <div className="dashboard-range-row">
              <div className="dashboard-range-controls">
                <div className="dashboard-range-tabs">
                  {DASHBOARD_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`range-chip ${selectedRange === option.value ? 'active' : ''}`}
                      onClick={() => setSelectedRange(option.value)}
                    >
                      {t(option.label)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="dashboard-chart-shell">
              <DashboardChart data={chartDisplayData} />
            </div>
          </div>

          <div className="card premium-sidebar-card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('At A Glance')}</div>

              </div>
            </div>

            {dashboardValuationAvailable && totalValue > 0 ? (
              <>
                <div style={{ padding: '0 8px' }}>
                  <PortfolioDonut
                    assets={categoryDonutAssets}
                    totalValue={dashboardPortfolioValue}
                    countLabel={t('Categories')}
                    hoveredSymbol={hoveredDashboardSymbol}
                    onHover={setHoveredDashboardSymbol}
                  />
                </div>

                <div className="dashboard-simple-list premium-list">
                  <div className="dashboard-simple-list-title">{t('Top holdings')}</div>
                  {featuredHoldings.map((asset) => {
                    const categorySymbol = asset.assetClass === 'cash'
                      ? 'CASH'
                      : asset.assetClass.toUpperCase();
                    const isHovered = hoveredDashboardSymbol === categorySymbol;
                    return (
                      <div
                        key={asset.symbol}
                        className={`dashboard-simple-row premium-row ${isHovered ? 'hovered' : ''}`}
                        onMouseEnter={() => setHoveredDashboardSymbol(categorySymbol)}
                        onMouseLeave={() => setHoveredDashboardSymbol(null)}
                      >
                        <div className="row-asset-info">
                          <div className="asset-symbol-tag">{asset.symbol}</div>
                          <div className="asset-class-label">
                            {asset.assetClass === 'cash' ? t('Cash') : t(ASSET_CLASS_LABELS[asset.assetClass])}
                          </div>
                        </div>
                        <div className="row-value-info">
                          <div className="mono asset-value">{formatMoney(asset.value)}</div>
                          <div className="asset-allocation-pct">
                            {asset.displayAllocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <PieChart size={22} />
                </div>
                {valuationAssets.length > 0 && !dashboardValuationAvailable
                  ? t('Current market data is unavailable for one or more holdings.')
                  : t('Add positions to see the allocation split.')}
              </div>
            )}

            <Link href="/portfolio" className="btn btn-secondary btn-sm btn-premium-action">
              {t('Open Portfolio')}
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>




      </div>
    </AppShell>
  );
}
