'use client';

import { formatChartAxis, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import AppShell from '@/components/layout/app-shell';
import { EmptyState } from '@/components/ui/empty-state';
import PortfolioDonut, { type DonutAsset } from '@/components/dashboard/portfolio-donut';
import {
  BENCHMARK_OPTIONS,
} from '@/lib/portfolio/benchmark-options';
import {
  buildBenchmarkComparisonSeries,
  buildInvestedPerformanceCashFlows,
  buildMonthlyReturnHeatmap,
} from '@/lib/portfolio/benchmarking';

import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  type CurrentFxRatesToEur,
} from '@/lib/portfolio/current-valuation';
import { fetchCurrentQuoteBatches } from '@/lib/financial-data/quotes/client';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import { buildPortfolioMonitorSeries } from '@/lib/portfolio/ux-insights';
import { DEMO_PORTFOLIO_GROWTH } from '@/lib/demo/investment-data';
import { getDemoSnapshotAsOfDay } from '@/lib/demo/showcase-snapshot';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import {
  getAllManualAccounts,
  MANUAL_ACCOUNTS_EVENT,
} from '@/lib/accounts/manual-accounts-store';
import { getVenueMeta } from '@/lib/portfolio/account-overview';

import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  ASSET_CLASS_LABELS,
  getAssetConfig,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  Activity,
  BarChart3,
  CandlestickChart,
  LayoutGrid,
  PieChart as PieChartIcon,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {

  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type MarketPrice = {
  price: number;
  change24h: number | null;
};

type HoldingView = ReturnType<typeof buildCurrentHoldingValuations>[number] & {
  name: string;
};

type ChartTooltipPayload = {
  color?: string;
  name?: string | number;
  value?: string | number;
};

type AnalyticsPrimaryTab = 'returns' | 'allocation';
type AnalyticsReturnsView = 'line' | 'heatmap';
type AnalyticsDonutAsset = DonutAsset & { color: string };

const ANALYTICS_ASSET_CLASSES: AssetClass[] = ['crypto', 'stock', 'etf', 'metal'];
const ANALYTICS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  crypto: 'var(--series-crypto)',
  stock: 'var(--series-stocks)',
  etf: 'var(--series-etfs)',
  metal: 'var(--series-metals)',
};

function AnalyticsAllocationDonut({
  assets,
  totalValue,
  countLabel,
  hoveredIndex,
  setHoveredIndex,
}: {
  assets: AnalyticsDonutAsset[];
  totalValue: number;
  countLabel: string;
  hoveredIndex: number | undefined;
  setHoveredIndex: (index: number | undefined) => void;
}) {
  const hoveredSymbol = hoveredIndex !== undefined ? assets[hoveredIndex]?.symbol ?? null : null;

  return (
    <PortfolioDonut
      assets={assets}
      totalValue={totalValue}
      countLabel={countLabel}
      hoveredSymbol={hoveredSymbol}
      onHover={(symbol) => {
        if (!symbol) {
          setHoveredIndex(undefined);
          return;
        }
        const nextIndex = assets.findIndex((asset) => asset.symbol === symbol);
        setHoveredIndex(nextIndex >= 0 ? nextIndex : undefined);
      }}
    />
  );
}

function AnalyticsChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string | number;
  valueFormatter: (value: number) => string;
}) {
  const { t } = useAppTranslation();
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip-card">
      <div className="chart-tooltip-label">{String(label ?? t('Selected point'))}</div>
      {payload.map((entry) => {
        const value = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
        const labelText = String(entry.name ?? 'Value');

        return (
          <div key={`${labelText}-${entry.color ?? 'series'}`} className="chart-tooltip-row">
            <span className="chart-tooltip-name">
              <span className="chart-tooltip-dot" style={{ background: entry.color ?? 'var(--accent-blue)' }} />
              {labelText}
            </span>
            <span className="chart-tooltip-value">
              {Number.isFinite(value) ? valueFormatter(value) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}


export default function AnalyticsPage() {
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
  const [mounted, setMounted] = useState(false);

  const [currentPrices, setCurrentPrices] = useState<Record<string, MarketPrice>>({});
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsPrimaryTab>('returns');
  const [returnsView, setReturnsView] = useState<AnalyticsReturnsView>('line');
  const allocationView = 'classes' as const;
  const [hoveredAssetClassIndex, setHoveredAssetClassIndex] = useState<number | undefined>(undefined);

  const [benchmarkId, setBenchmarkId] = useState(BENCHMARK_OPTIONS[0].id);
  const [benchmarkPrices, setBenchmarkPrices] = useState<Array<{ date: string; close: number }>>([]);
  const [isBenchmarkLoading, setIsBenchmarkLoading] = useState(false);
  const [benchmarkPeriod, setBenchmarkPeriod] = useState<'30D' | '90D' | '1Y' | '3Y' | '5Y' | 'ALL'>('1Y');
  const [heatmapPeriod, setHeatmapPeriod] = useState<'1Y' | '3Y' | '5Y' | '10Y' | 'ALL'>('1Y');
  const [inflationRate, setInflationRate] = useState(2.5);

  useEffect(() => {
    setMounted(true);
    setTransactions(getAllTransactions());
    setManualAccounts(getAllManualAccounts());
    const syncTransactions = () => setTransactions(getAllTransactions());
    const syncManualAccounts = () => setManualAccounts(getAllManualAccounts());


    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncManualAccounts);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncManualAccounts);
    };
  }, []);

  const baseHoldings = useMemo(() => deriveHoldingsFromTransactions(transactions), [transactions]);

  const [historicalPrices, setHistoricalPrices] = useState<Record<string, Array<{ date: string, close: number }>>>({});

  useEffect(() => {
    const fetchHistoricalPrices = async () => {
      const symbols = [...new Set(transactions.map(tx => tx.asset))];
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

    if (transactions.length > 0) {
      fetchHistoricalPrices();
    }
  }, [transactions]);

  useEffect(() => {
    if (baseHoldings.length === 0) {
      setCurrentPrices({});
      return;
    }

    const loadPrices = async () => {
      try {
        const symbols = [
          ...new Set(
            baseHoldings
              .filter((holding) => holding.assetClass !== 'cash')
              .map((holding) => holding.symbol),
          ),
        ];
        if (symbols.length === 0) {
          setCurrentPrices({});
          return;
        }
        const data = await fetchCurrentQuoteBatches(symbols, 'eur');
        setCurrentPrices(data.prices ?? {});
      } catch {
        setCurrentPrices({});
      }
    };

    void loadPrices();
  }, [baseHoldings]);

  const selectedBenchmark = useMemo(
    () => BENCHMARK_OPTIONS.find((option) => option.id === benchmarkId) ?? BENCHMARK_OPTIONS[0],
    [benchmarkId],
  );

  useEffect(() => {
    const loadBenchmark = async () => {
      setIsBenchmarkLoading(true);
      try {
        let response: Response;
        if (selectedBenchmark.type === 'asset' && selectedBenchmark.assetSymbol) {
          response = await fetchFinancialData(
            `/api/prices/history?symbol=${selectedBenchmark.assetSymbol}&currency=${displayCurrency}&interval=1d`,
          );
        } else {
          response = await fetchFinancialData(
            `/api/prices/benchmark-history?yahooSymbol=${encodeURIComponent(
              selectedBenchmark.yahooSymbol ?? '',
            )}&currency=${displayCurrency}`,
          );
        }

        const data = await response.json();
        if (response.ok && isHistoryUsableForDerivedPerformance(data)) {
          let prices = data.prices ?? [];

          // Filter prices by period
          if (benchmarkPeriod !== 'ALL' && prices.length > 0) {
            const daysMap: Record<string, number> = { '30D': 30, '90D': 90, '1Y': 365, '3Y': 1095, '5Y': 1825 };
            const days = daysMap[benchmarkPeriod] || 365;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            prices = prices.filter((p: { date: string; close: number }) => new Date(p.date) >= cutoffDate);
          }

          setBenchmarkPrices(prices);
        } else {
          setBenchmarkPrices([]);
        }
      } catch {
        setBenchmarkPrices([]);
      } finally {
        setIsBenchmarkLoading(false);
      }
    };

    void loadBenchmark();
  }, [selectedBenchmark, benchmarkPeriod, displayCurrency]);

  const holdings = useMemo<HoldingView[]>(() => {
    const relevantHoldings = baseHoldings.filter(
        (holding) =>
          holding.assetClass !== 'cash' ||
          getVenueMeta(holding.venue, manualAccounts).cashCategory === 'savings_cash',
      );

    return buildCurrentHoldingValuations(
      relevantHoldings,
      currentPrices,
      fxRatesToEur,
    )
      .map((holding) => ({
        ...holding,
        name: getAssetConfig(holding.symbol)?.name ?? holding.symbol,
      }))
      .sort((left, right) => right.value - left.value);
  }, [baseHoldings, currentPrices, manualAccounts, fxRatesToEur]);

  const analyticsValuationAvailable = isCurrentValuationComplete(holdings);
  const allocationHoldings = analyticsValuationAvailable ? holdings : [];
  const totalValue = analyticsValuationAvailable
    ? holdings.reduce((sum, holding) => sum + holding.value, 0)
    : 0;
  const investedHoldings = useMemo(
    () => holdings.filter((holding) => holding.assetClass !== 'cash'),
    [holdings],
  );
  const investedCurrentValuationAvailable = isCurrentValuationComplete(investedHoldings);
  const investedCostBasisAvailable = investedHoldings.every(
    (holding) => holding.costBasisAvailable,
  );
  const investedTotalValue = investedHoldings.reduce((sum, holding) => sum + holding.value, 0);
  const investedTotalCost = investedHoldings.reduce((sum, holding) => sum + holding.amount * holding.avgCost, 0);
  const chartExcludedCashVenues = useMemo(() => {
    const venues = new Set<string>();
    manualAccounts.forEach((account) => venues.add(account.venue));
    transactions.forEach((transaction) => {
      venues.add(transaction.venue);
      if (transaction.settlementVenue) {
        venues.add(transaction.settlementVenue);
      }
    });

    return [...venues];
  }, [manualAccounts, transactions]);

  const portfolioMonitorData = useMemo(
    () => {
      if (!investedCostBasisAvailable || !investedCurrentValuationAvailable) return [];
      return buildPortfolioMonitorSeries(transactions, DEMO_PORTFOLIO_GROWTH, {
        monthKey: new Date().toISOString().slice(0, 7),
        asOfDay: getDemoSnapshotAsOfDay(transactions),
        invested: investedTotalCost,
        marketValue: investedTotalValue,
        sleeves: {
          crypto: investedHoldings.filter((holding) => holding.assetClass === 'crypto').reduce((sum, item) => sum + item.value, 0),
          stock: investedHoldings.filter((holding) => holding.assetClass === 'stock').reduce((sum, item) => sum + item.value, 0),
          etf: investedHoldings.filter((holding) => holding.assetClass === 'etf').reduce((sum, item) => sum + item.value, 0),
          metal: investedHoldings.filter((holding) => holding.assetClass === 'metal').reduce((sum, item) => sum + item.value, 0),
        },
      }, historicalPrices, {
        excludedCashVenues: chartExcludedCashVenues,
        language,
      });
    },
    [chartExcludedCashVenues, historicalPrices, investedCostBasisAvailable, investedCurrentValuationAvailable, investedHoldings, investedTotalCost, investedTotalValue, language, transactions],
  );
  const investedPerformanceCashFlows = useMemo(
    () => buildInvestedPerformanceCashFlows(transactions),
    [transactions],
  );

  const benchmarkSeries = useMemo(
    () => buildBenchmarkComparisonSeries(portfolioMonitorData, benchmarkPrices, inflationRate, investedPerformanceCashFlows),
    [benchmarkPrices, inflationRate, investedPerformanceCashFlows, portfolioMonitorData],
  );

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const chartDomain = getChartDomain(benchmarkSeries.flatMap(point => [point.portfolioPct, point.benchmarkPct]));

  const heatmapCells = useMemo(
    () => buildMonthlyReturnHeatmap(portfolioMonitorData, investedPerformanceCashFlows),
    [investedPerformanceCashFlows, portfolioMonitorData],
  );



  const assetClassRows = useMemo(
    () =>
      ANALYTICS_ASSET_CLASSES.map((assetClass) => {
        const bucket = allocationHoldings.filter((holding) => holding.assetClass === assetClass);
        const value = bucket.reduce((sum, item) => sum + item.value, 0);
        const costBasisAvailable = bucket.every(
          (item) => item.costBasisAvailable,
        );
        const invested = bucket.reduce((sum, item) => sum + item.amount * item.avgCost, 0);

        return {
          assetClass,
          positions: bucket.length,
          value,
          invested,
          pnl: costBasisAvailable ? value - invested : 0,
          costBasisAvailable,
          allocation: totalValue > 0 ? (value / totalValue) * 100 : 0,
        };
      }),
    [allocationHoldings, totalValue],
  );

  const assetClassChartRows = assetClassRows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((row) => ({
      ...row,
      label: ASSET_CLASS_LABELS[row.assetClass],
    }));
  const heatmapYears = useMemo(() => {
    // Filter cells by period
    const thisYear = new Date().getFullYear();
    const yearsCutoff =
      heatmapPeriod === '1Y' ? thisYear :
        heatmapPeriod === '3Y' ? thisYear - 3 :
          heatmapPeriod === '5Y' ? thisYear - 5 :
            heatmapPeriod === '10Y' ? thisYear - 10 :
              0; // ALL

    const filteredCells = heatmapCells.filter(cell => {
      const cellYear = parseInt(cell.year);
      return cellYear >= yearsCutoff;
    });

    const yearMap = new Map<string, Map<string, (typeof heatmapCells)[number]>>();

    for (const cell of filteredCells) {
      if (!yearMap.has(cell.year)) {
        yearMap.set(cell.year, new Map());
      }
      yearMap.get(cell.year)?.set(cell.month, cell);
    }

    const sortedYears = Array.from(yearMap.keys()).sort((a, b) => b.localeCompare(a));
    if (sortedYears.length === 0) return [];
    const result: Array<{
      label: string;
      isGroup: boolean;
      years: string[];
      months: Array<{
        month: string;
        cell: { returnPct: number | null } | null;
      }>;
    }> = [];

    let i = 0;
    while (i < sortedYears.length) {
      const yearStr = sortedYears[i];
      const yearNum = parseInt(yearStr);

      // Last 5 years are always individual
      if (yearNum > thisYear - 5) {
        const monthMap = yearMap.get(yearStr)!;
        result.push({
          label: yearStr,
          isGroup: false,
          years: [yearStr],
          months: ANALYTICS_MONTHS.map(month => ({
            month,
            cell: monthMap.get(month) || null
          }))
        });
        i++;
        continue;
      }

      // Older years grouping
      // Determine block size: 5 years for recent history, 10 for deep archive
      const blockSize = yearNum > thisYear - 15 ? 5 : 10;
      const groupYears: string[] = [];
      for (let j = 0; j < blockSize && i < sortedYears.length; j++) {
        groupYears.push(sortedYears[i]);
        i++;
      }

      const groupMonths = ANALYTICS_MONTHS.map(month => {
        const validReturns = groupYears
          .map(y => yearMap.get(y)?.get(month))
          .filter(c => c && typeof c.returnPct === 'number') as Array<{ returnPct: number }>;

        const avgReturn = validReturns.length > 0
          ? validReturns.reduce((sum, c) => sum + c.returnPct, 0) / validReturns.length
          : null;

        return {
          month,
          cell: validReturns.length > 0 ? { returnPct: avgReturn } : null
        };
      });

      result.push({
        label: groupYears.length > 1 ? `${groupYears[groupYears.length - 1]} – ${groupYears[0]}` : groupYears[0],
        isGroup: groupYears.length > 1,
        years: groupYears,
        months: groupMonths
      });
    }

    return result;
  }, [heatmapCells, heatmapPeriod]);
  const latestBenchmarkPoint = benchmarkSeries[benchmarkSeries.length - 1];
  const benchmarkGap = latestBenchmarkPoint
    ? latestBenchmarkPoint.portfolioPct - latestBenchmarkPoint.benchmarkPct
    : 0;
  const visibleAssetClassRows = assetClassRows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const filteredHeatmapCells = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const yearsCutoff =
      heatmapPeriod === '1Y' ? thisYear :
        heatmapPeriod === '3Y' ? thisYear - 3 :
          heatmapPeriod === '5Y' ? thisYear - 5 :
            heatmapPeriod === '10Y' ? thisYear - 10 :
              0; // ALL

    return heatmapCells.filter(cell => {
      const cellYear = parseInt(cell.year);
      return cellYear >= yearsCutoff;
    });
  }, [heatmapCells, heatmapPeriod]);

  const populatedHeatmapCells = filteredHeatmapCells.filter((cell) => typeof cell.returnPct === 'number');
  const bestHeatmapCell = populatedHeatmapCells.length > 0
    ? populatedHeatmapCells.reduce((best, cell) => (Number(cell.returnPct) > Number(best.returnPct) ? cell : best))
    : null;
  const worstHeatmapCell = populatedHeatmapCells.length > 0
    ? populatedHeatmapCells.reduce((worst, cell) => (Number(cell.returnPct) < Number(worst.returnPct) ? cell : worst))
    : null;
  const positiveHeatmapCount = populatedHeatmapCells.filter((cell) => Number(cell.returnPct) > 0).length;

  const activePanelKey = analyticsTab === 'returns' ? `returns-${returnsView}` : `allocation-${allocationView}`;

  if (!mounted) {
    return (
      <AppShell>
        <div className="page-header">
          <h1 className="page-title">
            <BarChart3 size={24} style={{ display: 'inline', marginRight: 8 }} />
            {t('Analytics')}
          </h1>
        </div>
        <div className="page-content">
          <section className="card analytics-shell" style={{ height: 400 }}>
            <div className="analytics-shell-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <RefreshCw className="loading-spin" />
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="page-title">
            <BarChart3 size={24} style={{ display: 'inline', marginRight: 8 }} />
            {t('Analytics')}
          </h1>
        </div>

        <div className="tabs">
          <button
            className={`tab ${analyticsTab === 'returns' ? 'active' : ''}`}
            onClick={() => setAnalyticsTab('returns')}
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <TrendingUp size={14} />
            <span>{t('Returns')}</span>
          </button>
          <button
            className={`tab ${analyticsTab === 'allocation' ? 'active' : ''}`}
            onClick={() => setAnalyticsTab('allocation')}
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <PieChartIcon size={14} />
            <span>{t('Allocation')}</span>
          </button>
        </div>
      </div>

      <div className="page-content animate-in">
        {holdings.length > 0 && !analyticsValuationAvailable && (
          <div className="callout warn" style={{ marginBottom: 16 }}>
            <Activity size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>{t('Unavailable — insufficient data')}</strong>{' '}
              {t('Allocation appears once holdings have sourced market prices.')}
            </div>
          </div>
        )}
        {analyticsTab === 'returns' && !investedCostBasisAvailable && investedHoldings.length > 0 && (
          <div className="callout warn" style={{ marginBottom: 16 }}>
            <Activity size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>{t('Performance unavailable')}</strong>{' '}
              {t('At least one position requires a reliable historical FX conversion. Allocation values remain available.')}
            </div>
          </div>
        )}
        <section className="card analytics-shell">
          <div className="analytics-shell-header">
            <div>
              <div className="section-title">{analyticsTab === 'returns' ? t('Performance Analysis') : t('Allocation Breakdown')}</div>
              <div className="panel-subtitle">
                {analyticsTab === 'returns'
                  ? t('Analyze your historical performance against global benchmarks and inflation.')
                  : t('View the current sourced allocation across supported asset classes.')}
              </div>
            </div>

          </div>

          <div className="analytics-shell-body">
            <div className="analytics-secondary-tabs">
              {analyticsTab === 'returns' ? (
                <>
                  <button
                    type="button"
                    className={`analytics-secondary-tab ${returnsView === 'line' ? 'active' : ''}`}
                    onClick={() => setReturnsView('line')}
                  >
                    {t('Return')}
                  </button>
                  <button
                    type="button"
                    className={`analytics-secondary-tab ${returnsView === 'heatmap' ? 'active' : ''}`}
                    onClick={() => setReturnsView('heatmap')}
                  >
                    {t('Heatmap')}
                  </button>

                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`analytics-secondary-tab ${allocationView === 'classes' ? 'active' : ''}`}
                  >
                    {t('Asset Classes')}
                  </button>
                </>
              )}
            </div>

            <div key={activePanelKey} className="analytics-panel-stage animate-in">
              {analyticsTab === 'returns' ? (
                <>
                  {returnsView === 'line' ? (
                    <>
                      <div className="analytics-panel-toolbar">
                        <div className="analytics-panel-header-group">
                          <div className="section-title">{t('Invested portfolio vs benchmark')}</div>

                        </div>
                        <div className="analytics-panel-controls">
                          <label className="analytics-control">
                            <span>{t('Benchmark')}</span>
                            <select
                              className="select"
                              value={benchmarkId}
                              onChange={(event) => setBenchmarkId(event.target.value)}
                            >
                              {BENCHMARK_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="analytics-control analytics-control-compact">
                            <span>{t('Inflation p.a.')}</span>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={15}
                              step="0.1"
                              value={inflationRate}
                              onChange={(event) => setInflationRate(Number(event.target.value))}
                            />
                          </label>
                          <div className="analytics-control">
                            <span>{t('Period')}</span>
                            <div className="dashboard-range-tabs" role="group" aria-label={t('Period')}>
                              {(['30D', '90D', '1Y', '3Y', '5Y', 'ALL'] as const).map((period) => (
                                <button
                                  key={period}
                                  className={`range-chip ${benchmarkPeriod === period ? 'active' : ''}`}
                                  onClick={() => setBenchmarkPeriod(period)}
                                  aria-pressed={benchmarkPeriod === period}
                                >
                                  {period}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {isBenchmarkLoading ? (
                        <div className="analytics-chart-loading-state">
                          <RefreshCw className="loading-spin" />
                          <p>{t('Benchmark loading')}</p>
                        </div>
                      ) : benchmarkSeries.length > 0 ? (
                        <>
                          <div className="analytics-main-chart">
                            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                              <LineChart data={benchmarkSeries} margin={{ top: 0, right: 0, left: -6, bottom: 0 }}>
                                <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.6} />
                                <XAxis
                                  dataKey="shortDate"
                                  tickLine={false}
                                  axisLine={false}
                                  tick={{ fill: 'var(--chart-text-dim)', fontSize: 11 }}
                                  minTickGap={60}
                                />
                                <YAxis
                                  tickLine={false}
                                  axisLine={false}
                                  tick={(props: any) => {
                                    const { x, y, payload } = props;
                                    const val = Number(payload.value);
                                    const formattedValue = formatChartAxis(val, chartDomain, numberLocale, { suffix: '%' });
                                    return (
                                      <g transform={`translate(${x},${y})`}>
                                        <text x={language === 'ar' ? 10 : -10} y={4} textAnchor={language === 'ar' ? 'start' : 'end'} fill="none" stroke="var(--bg-card)" strokeWidth={2} fontSize={11} fontWeight="bold">
                                          {formattedValue}
                                        </text>
                                        <text x={language === 'ar' ? 10 : -10} y={4} textAnchor={language === 'ar' ? 'start' : 'end'} fill="var(--chart-text-dim)" fontSize={11}>
                                          {formattedValue}
                                        </text>
                                      </g>
                                    );
                                  }}
                                  orientation={language === 'ar' ? 'right' : 'left'}
                                  domain={chartDomain}
                                  width={getChartAxisWidth(chartDomain, numberLocale, { suffix: '%' })}
                                />
                                <Tooltip
                                  content={<AnalyticsChartTooltip valueFormatter={(value) => formatPct(value)} />}
                                  cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="portfolioPct"
                                  stroke="var(--series-market)"
                                  strokeWidth={2.5}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  isAnimationActive
                                  animationDuration={900}
                                  name={t('Invested portfolio')}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="benchmarkPct"
                                  stroke="var(--series-benchmark)"
                                  strokeWidth={2.1}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  isAnimationActive
                                  animationDuration={900}
                                  name={t('Benchmark')}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="summary-strip analytics-panel-footer">
                            <div className="summary-item">
                              <span>{t('Invested portfolio')}</span>
                              <strong>{formatPct(benchmarkSeries[benchmarkSeries.length - 1]?.portfolioPct ?? 0)}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t(selectedBenchmark.label)}</span>
                              <strong>{formatPct(benchmarkSeries[benchmarkSeries.length - 1]?.benchmarkPct ?? 0)}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t('Benchmark gap')}</span>
                              <strong>{formatPct(benchmarkGap)}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t('Real after inflation')}</span>
                              <strong>{formatPct(benchmarkSeries[benchmarkSeries.length - 1]?.realPct ?? 0)}</strong>
                            </div>
                          </div>
                        </>
                      ) : (
                        <EmptyState
                          icon={BarChart3}
                          title={t("Benchmark unavailable")}
                          description={t("Benchmark history is not available for the current selection yet. Try selecting a major index like MSCI World.")}
                        />
                      )}
                    </>
                  ) : null}

                  {returnsView === 'heatmap' ? (
                    <>
                      <div className="analytics-panel-toolbar">
                        <div>
                          <div className="section-title">{t('Monthly return heatmap')}</div>

                        </div>
                        <div className="analytics-control">
                          <span>{t('Period')}</span>
                          <div className="dashboard-range-tabs" role="group" aria-label={t('Period')}>
                            {(['1Y', '3Y', '5Y', '10Y', 'ALL'] as const).map((period) => (
                              <button
                                key={period}
                                className={`range-chip ${heatmapPeriod === period ? 'active' : ''}`}
                                onClick={() => setHeatmapPeriod(period)}
                              >
                                {period}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {heatmapCells.length > 0 ? (
                        <>
                          <div className="return-heatmap">
                            {heatmapYears.map(({ label, months, isGroup }) => (
                              <div key={label} className="return-heatmap-year">
                                <div className="return-heatmap-year-label">
                                  <strong>{label}</strong>
                                  <span>{isGroup ? t('Average / month') : t('Calendar months')}</span>
                                </div>
                                <div className="return-heatmap-cells">
                                  {months.map(({ month, cell }) => {
                                    const intensity = Math.min(1, Math.abs((cell?.returnPct ?? 0) / 12));
                                    const background =
                                      !cell
                                        ? 'var(--surface-softer)'
                                        : cell.returnPct === null
                                          ? 'var(--surface-soft)'
                                          : cell.returnPct >= 0
                                            ? `rgba(52, 211, 153, ${0.15 + intensity * 0.35})`
                                            : `rgba(251, 113, 133, ${0.15 + intensity * 0.35})`;

                                    return (
                                      <div
                                        key={`${label}-${month}`}
                                        className={`return-heatmap-cell ${!cell ? 'is-empty' : ''} ${isGroup ? 'is-group-cell' : ''}`}
                                        style={{ background }}
                                        title={`${t(month)} ${label}: ${!cell ? t('No data') : cell.returnPct === null ? t('No previous month') : `${formatPct(cell.returnPct)}${isGroup ? ' (avg)' : ''}`
                                          }`}
                                      >
                                        <span>{t(month)}</span>
                                        <div className="return-heatmap-cell-val">
                                          <strong>
                                            {!cell || cell.returnPct === null ? '—' : formatPct(cell.returnPct)}
                                          </strong>
                                          {isGroup && cell && <small style={{ fontSize: '9px', opacity: 0.6, display: 'block', marginTop: '-2px' }}>{t('avg')}</small>}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="summary-strip analytics-panel-footer">
                            <div className="summary-item">
                              <span>{t('Positive months')}</span>
                              <strong>{positiveHeatmapCount}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t('Negative months')}</span>
                              <strong>{populatedHeatmapCells.length - positiveHeatmapCount}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t('Best month')}</span>
                              <strong>{bestHeatmapCell ? formatPct(Number(bestHeatmapCell.returnPct)) : '—'}</strong>
                            </div>
                            <div className="summary-item">
                              <span>{t('Worst month')}</span>
                              <strong>{worstHeatmapCell ? formatPct(Number(worstHeatmapCell.returnPct)) : '—'}</strong>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="empty-state">{t('The heatmap appears once monthly portfolio history is available.')}</div>
                      )}
                    </>
                  ) : null}


                </>
              ) : (
                <>
                  {allocationView === 'classes' ? (
                    <>
                      <div className="analytics-panel-toolbar">
                        <div>
                          <div className="section-title">{t('Asset class split')}</div>

                        </div>
                        <span className="badge badge-teal">
                          <CandlestickChart size={12} />
                          {t(`${holdings.length} holdings`)}
                        </span>
                      </div>

                      {visibleAssetClassRows.length > 0 ? (
                        <>
                          <div className="analytics-split-layout">
                            <div className="analytics-pie-shell">
                              <div className="analytics-pie-chart">
                                <AnalyticsAllocationDonut
                                  assets={assetClassChartRows.map((row) => ({
                                    symbol: row.assetClass.toUpperCase(),
                                    name: t(row.label),
                                    assetClass: row.assetClass,
                                    value: row.value,
                                    allocation: row.allocation,
                                    color: ASSET_CLASS_COLORS[row.assetClass],
                                  }))}
                                  totalValue={totalValue}
                                  countLabel={t('Categories')}
                                  hoveredIndex={hoveredAssetClassIndex}
                                  setHoveredIndex={setHoveredAssetClassIndex}
                                />
                              </div>
                            </div>

                            <div className="analytics-split-list">
                              {visibleAssetClassRows.map((row, index) => (
                                <div
                                  key={row.assetClass}
                                  className={`analytics-split-row ${hoveredAssetClassIndex === index ? 'active' : ''}`}
                                  onMouseEnter={() => setHoveredAssetClassIndex(index)}
                                  onMouseLeave={() => setHoveredAssetClassIndex(undefined)}
                                >
                                  <div className="analytics-split-main">
                                    <span className="analytics-split-dot" style={{ background: ASSET_CLASS_COLORS[row.assetClass] }} />
                                    <div>
                                      <strong>{t(ASSET_CLASS_LABELS[row.assetClass])}</strong>
                                      <span>
                                        {t(`${row.positions} positions`)} · {formatMoney(row.value)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="analytics-split-side">
                                    <strong>{row.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong>
                                    <span style={{ color: row.costBasisAvailable ? row.pnl >= 0 ? 'var(--green)' : 'var(--red)' : 'var(--text-muted)' }}>
                                      {row.costBasisAvailable
                                        ? formatMoney(row.pnl)
                                        : t('Unavailable')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>


                        </>
                      ) : (
                        <div className="empty-state">{t('Allocation appears once holdings have sourced market prices.')}</div>
                      )}
                    </>
                  ) : null}

                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
