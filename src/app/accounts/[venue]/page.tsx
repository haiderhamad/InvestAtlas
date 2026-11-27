'use client';

import { formatChartAxis, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  ArrowUpRight,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  WalletCards,
  X,
} from 'lucide-react';
import AppShell from '@/components/layout/app-shell';
import GlobalAddModal from '@/components/layout/global-add-modal';
import { TradeEntryActions, useTradeEntry } from '@/components/layout/trade-entry-actions';
import Dialog from '@/components/ui/dialog';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import {
  buildAccountMonitorSeries,
  listPositiveOpenCashBalances,
  type AccountHistoryPricePoint,
} from '@/lib/accounts/account-detail';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  HIDDEN_ACCOUNTS_EVENT,
  readHiddenAccountVenues,
} from '@/lib/accounts/account-visibility-store';
import {
  getAllManualAccounts,
  MANUAL_ACCOUNTS_EVENT,
  removeManualAccount,
  readManualAccounts,
  updateManualAccount,
  type ManualAccountCashRoute,
} from '@/lib/accounts/manual-accounts-store';
import { formatCashRouteLabel } from '@/lib/accounts/investment-cash-routing';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  buildHoldingLedgerInsights,
} from '@/lib/portfolio/ux-insights';
import {
  buildAccountSummaries,
  formatActivityDate,
  getVenueMeta,
  type AccountHoldingSnapshot,
} from '@/lib/portfolio/account-overview';
import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  type CurrentFxRatesToEur,
} from '@/lib/portfolio/current-valuation';
import { fetchCurrentQuoteBatches } from '@/lib/financial-data/quotes/client';
import { calculateInvestmentTaxOverview } from '@/lib/tax/investment-tax';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_EVENT,
} from '@/lib/tax/tax-profile-store';
import { DEFAULT_TAX_PROFILE_SETTINGS } from '@/lib/tax/tax-profile';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  removeManualTransaction,
  type AppTransaction,
} from '@/lib/transactions/manual-store';

interface MarketPrice {
  price: number;
  change24h: number | null;
  changePeriod?: '24h' | 'session' | 'unavailable';
}

type AccountViewTab = 'overview' | 'transactions';
type ChartMode = 'value' | 'performance';
type ChartRange = '7D' | '1M' | '3M' | '1Y' | 'ALL';
type AccountTransactionFilter = 'all' | AppTransaction['type'];
type AccountImportKind = 'pdf' | 'csv';

const CHART_RANGE_OPTIONS: Array<{ value: ChartRange; label: string; days: number | null }> = [
  { value: '7D', label: '7D', days: 7 },
  { value: '1M', label: '1M', days: 30 },
  { value: '3M', label: '3M', days: 90 },
  { value: '1Y', label: '1Y', days: 365 },
  { value: 'ALL', label: 'All', days: null },
];
const TRANSACTION_PAGE_SIZES = [25, 50, 100] as const;
const ALL_TRANSACTION_FILTER_OPTIONS: Array<{ value: AccountTransactionFilter; label: string }> = [
  { value: 'all', label: 'All entries' },
  { value: 'buy', label: 'Buys' },
  { value: 'sell', label: 'Sells' },
  { value: 'dividend', label: 'Dividends' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
  { value: 'fee', label: 'Fees' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'adjustment', label: 'Adjustments' },
];

const BANK_TRANSACTION_FILTER_OPTIONS: Array<{ value: AccountTransactionFilter; label: string }> = [
  { value: 'all', label: 'All entries' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
  { value: 'transfer', label: 'Transfers' },
];
type TranslateFn = (text: string) => string;

const getTransactionTypeLabels = (t: TranslateFn): Record<AppTransaction['type'], string> => ({
  buy: t('Buy'),
  sell: t('Sell'),
  deposit: t('Deposit'),
  withdrawal: t('Withdrawal'),
  dividend: t('Dividend'),
  fee: t('Fee'),
  transfer: t('Transfer'),
  adjustment: t('Adjustment'),
});

const getTaxTypeLabels = (t: TranslateFn): Record<AppTransaction['taxType'], string> => ({
  acquisition: t('Acquisition'),
  disposal: t('Disposal'),
  transfer_in: t('Transfer In'),
  transfer_out: t('Transfer Out'),
  dividend_income: t('Dividend'),
  fee_expense: t('Fee Expense'),
  adjustment: t('Adjustment'),
  cash_in: t('Cash In'),
  cash_out: t('Cash Out'),
});
// formatPct moved inside component to access language

const getCurrencySymbol = (quote: string) => {
  switch (quote) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default: return quote;
  }
};

function formatLedgerDate(value: string, language: string) {
  const parsed = new Date(value);

  const ledgerDateFormatter = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });

  const ledgerTimeFormatter = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: language !== 'de',
  });

  return {
    date: ledgerDateFormatter.format(parsed),
    time: ledgerTimeFormatter.format(parsed),
  };
}

const formatQuoteMoney = (value: number, quote: string, language: string) => {
  const locale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  return `${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${quote}`;
};

const escapeCsvCell = (value: string | number) => {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

export default function AccountDetailPage() {
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
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
  const params = useParams<{ venue: string }>();
  const venueParam = Array.isArray(params?.venue) ? params.venue[0] : params?.venue;
  const venue = decodeURIComponent(venueParam ?? '');
  const tradeEntry = useTradeEntry();
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ReturnType<typeof getAllManualAccounts>>([]);
  const [hiddenAccountVenues, setHiddenAccountVenues] = useState<string[]>([]);
  const [taxProfileSettings, setTaxProfileSettings] = useState(DEFAULT_TAX_PROFILE_SETTINGS);
  const [tab, setTab] = useState<AccountViewTab>('overview');
  const [chartMode, setChartMode] = useState<ChartMode>('value');
  const [selectedRange, setSelectedRange] = useState<ChartRange>('1Y');
  const [currentPrices, setCurrentPrices] = useState<Record<string, MarketPrice>>({});
  const [priceHistory, setPriceHistory] = useState<Record<string, AccountHistoryPricePoint[]>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<AccountTransactionFilter>('all');
  const [showDetailedTransactionColumns, setShowDetailedTransactionColumns] = useState(false);
  const [transactionPageSize, setTransactionPageSize] =
    useState<(typeof TRANSACTION_PAGE_SIZES)[number]>(25);
  const [transactionPage, setTransactionPage] = useState(1);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedImportKind, setSelectedImportKind] = useState<AccountImportKind>('pdf');
  const [selectedImportFileName, setSelectedImportFileName] = useState('');
  const [isGlobalAddModalOpen, setIsGlobalAddModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<AppTransaction | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [renameLabel, setRenameLabel] = useState('');
  const [renameCashRoutes, setRenameCashRoutes] = useState<ManualAccountCashRoute[]>([]);
  const [allowHardDeleteWithData, setAllowHardDeleteWithData] = useState(false);
  const [accountMutationError, setAccountMutationError] = useState<string | null>(null);
  const [isMutatingAccount, setIsMutatingAccount] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>('value');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [txSortColumn, setTxSortColumn] = useState<string>('date');
  const [txSortDirection, setTxSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setIsAddMenuOpen(false);
    setIsGlobalAddModalOpen(false);
    setEditingTransaction(null);
    setIsImportModalOpen(false);
    setIsRenameModalOpen(false);
    setIsDeleteModalOpen(false);
  }, [tradeEntry.workspace, venue]);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Hydrate state from localStorage on client mount
    setTransactions(getAllTransactions());
    setManualAccounts(getAllManualAccounts());
    setHiddenAccountVenues(readHiddenAccountVenues());
    setTaxProfileSettings(readTaxProfileSettings());

    const syncTransactions = () => {
      setTransactions(getAllTransactions());
    };
    const syncManualAccounts = () => {
      setManualAccounts(getAllManualAccounts());
    };
    const syncHiddenAccounts = () => {
      setHiddenAccountVenues(readHiddenAccountVenues());
    };
    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
    window.addEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncManualAccounts);
    window.addEventListener('storage', syncHiddenAccounts);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts as EventListener);
      window.removeEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncManualAccounts);
      window.removeEventListener('storage', syncHiddenAccounts);
      window.removeEventListener('storage', syncTaxProfile);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const accountTransactions = useMemo(
    () =>
      transactions
        .filter((transaction) => transaction.venue === venue || transaction.settlementVenue === venue)
        .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime()),
    [transactions, venue],
  );
  const displayAccountTransactions = useMemo(
    () =>
      [...accountTransactions].sort(
        (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
      ),
    [accountTransactions],
  );
  const accountMeta = useMemo(() => getVenueMeta(venue, manualAccounts), [manualAccounts, venue]);
  const manualAccount = useMemo(
    () => manualAccounts.find((account) => account.venue === venue) ?? null,
    [manualAccounts, venue],
  );
  const isCashAccount = accountMeta.kind === 'Bank Account' || accountMeta.kind === 'Savings Account';
  const isHidden = hiddenAccountVenues.includes(venue);
  const taxOverview = useMemo(
    () => calculateInvestmentTaxOverview(accountTransactions, taxProfileSettings),
    [accountTransactions, taxProfileSettings],
  );
  const holdingInsights = useMemo(
    () => buildHoldingLedgerInsights(accountTransactions, taxOverview),
    [accountTransactions, taxOverview],
  );
  const baseHoldings = useMemo(
    () => deriveHoldingsFromTransactions(transactions).filter((holding) => holding.venue === venue),
    [transactions, venue],
  );
  const openAssetHoldings = useMemo(
    () => baseHoldings.filter((holding) => holding.assetClass !== 'cash' && holding.amount > 0.0000001),
    [baseHoldings],
  );
  const openCashBalances = useMemo(
    () => listPositiveOpenCashBalances(baseHoldings),
    [baseHoldings],
  );
  const hasOpenCash = openCashBalances.length > 0;
  useEffect(() => {
    let isCancelled = false;

    async function loadPriceData() {
      if (baseHoldings.length === 0) {
        setCurrentPrices({});
        setPriceHistory({});
        setPriceError(null);
        return;
      }

      setLoadingPrices(true);
      setPriceError(null);

      try {
        const symbols = [...new Set(baseHoldings.filter((holding) => holding.assetClass !== 'cash').map((holding) => holding.symbol))];
        if (symbols.length === 0) {
          if (!isCancelled) {
            setCurrentPrices({});
            setPriceHistory({});
          }
          return;
        }
        const currentData = await fetchCurrentQuoteBatches(symbols, 'eur');
        if (currentData.status === 'unavailable') {
          throw new Error('Current price fetch failed');
        }

        const historyPairs = await Promise.all(
          symbols.map(async (symbol) => {
            const response = await fetchFinancialData(`/api/prices/history?symbol=${symbol}&currency=eur&interval=1d`);
            const data = await response.json();

            if (!response.ok || !isHistoryUsableForDerivedPerformance(data)) {
              throw new Error(data.error || `History fetch failed for ${symbol}`);
            }

            return [
              symbol,
              (data.prices as Array<{ date: string; close: number }>).map((point) => ({
                date: point.date,
                close: point.close,
              })),
            ] as const;
          }),
        );

        if (!isCancelled) {
          setCurrentPrices(currentData.prices ?? {});
          setPriceHistory(Object.fromEntries(historyPairs));
        }
      } catch (error) {
        if (!isCancelled) {
          setCurrentPrices({});
          setPriceHistory({});
          setPriceError(error instanceof Error ? error.message : 'Failed to load account price data');
        }
      } finally {
        if (!isCancelled) {
          setLoadingPrices(false);
        }
      }
    }

    void loadPriceData();

    return () => {
      isCancelled = true;
    };
  }, [baseHoldings]);

  const holdingsTable = useMemo(
    () => {
      const base = buildCurrentHoldingValuations(
        baseHoldings.filter((holding) => holding.assetClass !== 'cash'),
        currentPrices,
      )
        .map((holding) => {
          const invested = holding.amount * holding.avgCost;
          const realizedPnl = holdingInsights[holding.symbol]?.realizedPnl ?? 0;
          const financialMetricsAvailable =
            holding.valuationAvailable
            &&
            holding.costBasisAvailable
            && (holdingInsights[holding.symbol]?.financialMetricsAvailable ?? false);
          const totalReturn = financialMetricsAvailable
            ? realizedPnl + holding.pnl
            : 0;
          const returnPct =
            financialMetricsAvailable && invested > 0
              ? (totalReturn / invested) * 100
              : 0;
          const tradeCount = holdingInsights[holding.symbol]?.tradeCount ?? 0;
          const assetDividends = accountTransactions.filter(
            (tx) =>
              tx.asset.trim().toUpperCase() === holding.symbol
              && tx.type === 'dividend',
          );
          const dividendTotalAvailable = assetDividends.every(
            (tx) => tx.quote.trim().toUpperCase() === 'EUR',
          );
          const dividendTotal = assetDividends
            .reduce((sum, tx) => sum + tx.total, 0);

          return {
            ...holding,
            price: holding.currentPrice,
            realizedPnl,
            invested,
            totalReturn,
            returnPct,
            tradeCount,
            dividendTotal,
            dividendTotalAvailable,
            financialMetricsAvailable,
          };
        });

      return base.sort((left, right) => {
        const valA = left[sortColumn as keyof typeof left];
        const valB = right[sortColumn as keyof typeof right];

        if (valA === undefined || valB === undefined) return 0;
        if (valA === valB) return 0;
        
        const direction = sortDirection === 'asc' ? 1 : -1;
        
        if (typeof valA === 'string' && typeof valB === 'string') {
          return valA.localeCompare(valB) * direction;
        }
        
        return ((valA as number) - (valB as number)) * direction;
      });
    },
    [baseHoldings, currentPrices, holdingInsights, sortColumn, sortDirection, accountTransactions],
  );

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const renderSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ChevronsUpDown size={14} style={{ color: 'var(--text-muted)', marginLeft: 4 }} />;
    }
    return sortDirection === 'asc' ? <ChevronUp size={14} style={{ marginLeft: 4 }} /> : <ChevronDown size={14} style={{ marginLeft: 4 }} />;
  };

  const handleTxSort = (column: string) => {
    if (txSortColumn === column) {
      setTxSortDirection(txSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setTxSortColumn(column);
      setTxSortDirection('desc');
    }
  };

  const renderTxSortIcon = (column: string) => {
    if (txSortColumn !== column) {
      return <ChevronsUpDown size={14} style={{ color: 'var(--text-muted)', marginLeft: 4 }} />;
    }
    return txSortDirection === 'asc' ? <ChevronUp size={14} style={{ marginLeft: 4 }} /> : <ChevronDown size={14} style={{ marginLeft: 4 }} />;
  };

  const accountHoldingSnapshots = useMemo<AccountHoldingSnapshot[]>(
    () => {
      const valuations = buildCurrentHoldingValuations(
        baseHoldings,
        currentPrices,
        fxRatesToEur,
      );
      return valuations.map((holding) => {
        return {
          symbol: holding.symbol,
          assetClass: holding.assetClass,
          amount: holding.amount,
          avgCost: holding.avgCost,
          value: holding.value,
          valuationAvailable: holding.valuationAvailable,
          change24h: holding.change24h,
          changePeriod: holding.changePeriod,
          totalFeesEur: holdingInsights[holding.symbol]?.totalFeesEur ?? 0,
          primaryVenue: venue,
          costBasisAvailable: holding.costBasisAvailable,
          financialMetricsAvailable:
            holding.valuationAvailable
            && (holdingInsights[holding.symbol]?.financialMetricsAvailable ?? false),
        };
      });
    },
    [baseHoldings, currentPrices, fxRatesToEur, venue, holdingInsights],
  );
  const accountSummary = useMemo(() => {
    const totalValue = isCurrentValuationComplete(accountHoldingSnapshots)
      ? accountHoldingSnapshots.reduce((sum, holding) => sum + holding.value, 0)
      : 0;
    return (
      buildAccountSummaries(accountHoldingSnapshots, totalValue, accountTransactions, manualAccounts).find(
        (account) => account.venue === venue,
      ) ?? null
    );
  }, [accountHoldingSnapshots, accountTransactions, manualAccounts, venue]);

  const monitorSeries = useMemo(
    () =>
      buildAccountMonitorSeries(
        accountTransactions,
        priceHistory,
        Object.fromEntries(
          Object.entries(currentPrices).map(([symbol, market]) => [symbol, market.price]),
        ),
        numberLocale,
      ),
    [accountTransactions, currentPrices, numberLocale, priceHistory],
  );

  const chartData = useMemo(() => {
    const selectedConfig = CHART_RANGE_OPTIONS.find((option) => option.value === selectedRange);
    let baseData = monitorSeries;
    let cutoffTime: number | null = null;

    if (selectedConfig && selectedConfig.days !== null) {
      const cutoffDate = new Date();
      cutoffDate.setUTCHours(0, 0, 0, 0);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - selectedConfig.days);
      cutoffTime = cutoffDate.getTime();
      baseData = monitorSeries.filter((point) => new Date(point.date).getTime() >= cutoffTime!);
    }

      if (baseData.length > 0) {
        const firstVisiblePoint = baseData[0];
        const isFirstPointInFullSeries = monitorSeries[0]?.date === firstVisiblePoint.date;

        // Bank accounts: if balance starts > 0 within the visible window (without padding),
      // prepend a same-date zero point so the line steps up vertically instead of starting mid-air.
      if (
        isCashAccount &&
        firstVisiblePoint.marketValue > 0 &&
        isFirstPointInFullSeries
      ) {
        const dummyPoint = {
          ...firstVisiblePoint,
          marketValue: 0,
          invested: 0,
          cashBalance: 0,
          cumulativeDividends: 0,
          shortDate: '',
        };
        return [dummyPoint, ...baseData];
      }
    }

    return baseData;
  }, [monitorSeries, selectedRange, accountMeta.kind]);

  const chartDisplayData = useMemo(() => {
    return chartData.map((point) => {
      const marketValuePct =
        point.invested > 0 ? ((point.marketValue - point.invested) / point.invested) * 100 : 0;
      const investedPct = 0; // Baseline is 0% for performance mode

      return {
        ...point,
        chartMarketValue: chartMode === 'performance' ? Number(marketValuePct.toFixed(2)) : point.marketValue,
        chartInvested: chartMode === 'performance' ? 0 : point.invested,
        marketValuePct: Number(marketValuePct.toFixed(2)),
        investedPct: Number(investedPct.toFixed(2)),
      };
    });
  }, [chartData, chartMode]);

  const chartDomain = getChartDomain(chartDisplayData.map(point => point.chartMarketValue));
  const chartAxisOptions = { suffix: chartMode === 'performance' ? '%' : '' };

  const accountValuationAvailable = accountSummary?.valuationAvailable ?? false;
  const currentValue = accountValuationAvailable ? accountSummary?.value ?? 0 : 0;
  const currentInvested = accountSummary?.invested ?? 0;
  const accountFinancialMetricsAvailable =
    accountValuationAvailable
    && (accountSummary?.financialMetricsAvailable ?? false);
  const currentPnl = accountFinancialMetricsAvailable
    ? currentValue - currentInvested
    : 0;
  const currentReturnPct =
    accountFinancialMetricsAvailable && currentInvested > 0
      ? (currentPnl / currentInvested) * 100
      : 0;

  const periodChangePct = useMemo(() => {
    if (!accountValuationAvailable) {
      return null;
    }

    const selectedConfig = CHART_RANGE_OPTIONS.find((option) => option.value === selectedRange);

    let baselineSource: typeof monitorSeries;
    if (selectedConfig && selectedConfig.days !== null) {
      const cutoffTime = Date.now() - selectedConfig.days * 24 * 60 * 60 * 1000;
      baselineSource = monitorSeries.filter((point) => new Date(point.date).getTime() >= cutoffTime);
    } else {
      baselineSource = monitorSeries;
    }

    const baselinePoint = baselineSource.find((point) => point.marketValue > 0) ?? baselineSource[0];
    const baseline = baselinePoint?.marketValue ?? 0;

    if (baseline <= 0) {
      return null;
    }

    return ((currentValue - baseline) / baseline) * 100;
  }, [accountValuationAvailable, monitorSeries, selectedRange, currentValue]);
  const lastActivity = accountSummary?.lastActivityAt ?? displayAccountTransactions[0]?.date ?? null;
  const transactionSummary = useMemo(
    () => ({
      buys: displayAccountTransactions.filter((transaction) => transaction.type === 'buy').length,
      sells: displayAccountTransactions.filter((transaction) => transaction.type === 'sell').length,
      dividends: displayAccountTransactions.filter((transaction) => transaction.type === 'dividend').length,
      deposits: displayAccountTransactions.filter((transaction) => transaction.type === 'deposit').length,
      withdrawals: displayAccountTransactions.filter((transaction) => transaction.type === 'withdrawal').length,
    }),
    [displayAccountTransactions],
  );
  const filteredAccountTransactions = useMemo(() => {
    const search = transactionSearch.trim().toLowerCase();

    const filtered = displayAccountTransactions.filter((transaction) => {
      if (transactionTypeFilter !== 'all' && transaction.type !== transactionTypeFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        transaction.asset,
        transaction.assetName ?? '',
        transaction.type,
        transaction.source,
        transaction.notes ?? '',
        getTaxTypeLabels(t)[transaction.taxType],
        transaction.quote,
        transaction.assetClass === 'cash' ? 'cash' : ASSET_CLASS_LABELS[transaction.assetClass],
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });

    return filtered.sort((left, right) => {
      const valA = left[txSortColumn as keyof typeof left];
      const valB = right[txSortColumn as keyof typeof right];

      if (valA === undefined || valB === undefined) return 0;
      if (valA === valB) return 0;
      
      const direction = txSortDirection === 'asc' ? 1 : -1;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        if (txSortColumn === 'date') {
          return (new Date(valA).getTime() - new Date(valB).getTime()) * direction;
        }
        return valA.localeCompare(valB) * direction;
      }
      
      return ((valA as number) - (valB as number)) * direction;
    });
  }, [displayAccountTransactions, transactionSearch, transactionTypeFilter, txSortColumn, txSortDirection]);
  const totalTransactionPages = Math.max(
    1,
    Math.ceil(filteredAccountTransactions.length / transactionPageSize),
  );
  const currentTransactionPage = Math.min(transactionPage, totalTransactionPages);
  const pagedAccountTransactions = useMemo(() => {
    const start = (currentTransactionPage - 1) * transactionPageSize;
    return filteredAccountTransactions.slice(start, start + transactionPageSize);
  }, [currentTransactionPage, filteredAccountTransactions, transactionPageSize]);
  const transactionRangeStart =
    filteredAccountTransactions.length === 0 ? 0 : (currentTransactionPage - 1) * transactionPageSize + 1;
  const transactionRangeEnd =
    filteredAccountTransactions.length === 0
      ? 0
      : Math.min(currentTransactionPage * transactionPageSize, filteredAccountTransactions.length);
  const hasLocalLedgerWarning =
    accountSummary?.isManualAccount ||
    displayAccountTransactions.some((transaction) => transaction.source === 'manual');
  const selectedImportLabel = selectedImportKind === 'pdf' ? 'PDF' : 'CSV';
  const selectedImportDescription =
    selectedImportKind === 'pdf'
      ? t('A native broker or bank PDF parser is not yet connected in this app. You can prepare the import and then proceed to the manual ledger.')
      : t('An account-specific CSV transaction import is not yet connected. You can select the file and then continue with manual transactions.');
  const selectedImportAccept =
    selectedImportKind === 'pdf' ? '.pdf,application/pdf' : '.csv,text/csv,.txt';

  const handleExportTransactions = () => {
    if (filteredAccountTransactions.length === 0) {
      return;
    }

    const header = [
      'Date',
      'Type',
      'Asset',
      'Asset Name',
      'Category',
      'Amount',
      'Price',
      'Quote',
      'Total',
      'Fee',
      'Tax Type',
      'Source',
      'Notes',
    ];
    const rows = filteredAccountTransactions.map((transaction) => [
      transaction.date,
      getTransactionTypeLabels(t)[transaction.type],
      transaction.asset,
      transaction.assetName ?? '',
      transaction.assetClass === 'cash' ? t('Cash') : ASSET_CLASS_LABELS[transaction.assetClass],
      transaction.amount,
      transaction.price,
      transaction.quote,
      transaction.total,
      transaction.fee,
      getTaxTypeLabels(t)[transaction.taxType],
      transaction.source,
      transaction.notes ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${venue.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-transactions.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };
  const toggleRenameCashRoute = (route: ManualAccountCashRoute) => {
    setRenameCashRoutes((current) =>
      current.includes(route) ? current.filter((item) => item !== route) : [...current, route],
    );
  };
  const archiveAccount = async () => {
    if (!manualAccount) return;
    if (openAssetHoldings.length > 0) return;
    setAccountMutationError(null);
    setIsMutatingAccount(true);
    try {
      await updateManualAccount(venue, { archivedAt: new Date().toISOString() });
      setIsDeleteModalOpen(false);
    } catch {
      setAccountMutationError('Failed to save');
    } finally {
      setIsMutatingAccount(false);
    }
  };
  const hardDeleteAccount = async () => {
    if (!manualAccount) return;
    if ((openAssetHoldings.length > 0 || hasOpenCash) && !allowHardDeleteWithData) return;
    const transactionsToDelete = accountTransactions.filter(
      (transaction) =>
        transaction.source === 'manual' &&
        (transaction.venue === venue || transaction.settlementVenue === venue),
    );

    setAccountMutationError(null);
    setIsMutatingAccount(true);
    try {
      await Promise.all(
        transactionsToDelete.map((transaction) => removeManualTransaction(transaction.id)),
      );
      await removeManualAccount(venue);
      window.location.href = '/accounts';
    } catch {
      setAccountMutationError('Failed to delete account. Please try again.');
    } finally {
      setIsMutatingAccount(false);
    }
  };
  const openImportModal = (kind: AccountImportKind) => {
    setSelectedImportKind(kind);
    setSelectedImportFileName('');
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
    setIsImportModalOpen(true);
    setIsAddMenuOpen(false);
  };
  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setSelectedImportFileName('');
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  };

  if (!accountSummary && accountTransactions.length === 0 && manualAccounts.every((account) => account.venue !== venue)) {
    return (
      <AppShell>
        <div className="page-content animate-in">
          <div className="card">
            <div className="section-title">{t('Account not found')}</div>
            <div className="panel-subtitle" style={{ marginBottom: 16 }}>
              {t('This account does not exist anymore or the local data was cleared.')}
            </div>
            <Link href="/accounts" className="btn btn-secondary">
              <ArrowLeft size={16} />
              {t('Back to Accounts')}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <div style={{ marginBottom: 6 }}>
              <Link
                href="/accounts"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <ArrowLeft size={14} />
                {t('Portfolios & Accounts')}
              </Link>
            </div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WalletCards size={24} />
              {accountMeta.label}
              {tradeEntry.canEdit && manualAccount && (
                <button
                  type="button"
                  className="btn btn-icon btn-sm"
                  onClick={() => {
                    setRenameLabel(accountMeta.label);
                    setRenameCashRoutes(manualAccount?.cashRoutes ?? []);
                    setAccountMutationError(null);
                    setIsRenameModalOpen(true);
                  }}
                  aria-label={t('Rename Account')}
                  style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  <Pencil size={14} />
                </button>
              )}
            </h1>
            <div className="page-header-meta">
              <span className="status-pill neutral">{accountMeta.kind}</span>
              {isHidden ? <span className="status-pill warn">{t('Hidden on dashboard')}</span> : null}
              <span className="status-pill neutral">
                <Clock3 size={13} />
                {formatActivityDate(lastActivity, numberLocale, t('No recent activity'))}
              </span>
            </div>
          </div>

          <div className="page-header-actions">
            {tradeEntry.canEdit && !isCashAccount && !accountMeta.archivedAt &&
              <TradeEntryActions launchTrade={tradeEntry.launchTrade} context={{ venue }} />}
            {tradeEntry.isDemo && <span className="status-pill neutral">{t('Demo snapshot is read-only.')}</span>}
            {tradeEntry.canEdit && <div className="account-add-menu account-detail-add-menu" ref={addMenuRef}>
              <button
                type="button"
                className={isCashAccount ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={() => setIsAddMenuOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={isAddMenuOpen}
              >
                <Plus size={16} />
                {t('Add')}
                <ChevronDown size={14} />
              </button>

              {isAddMenuOpen ? (
                <div className="account-add-dropdown account-detail-add-dropdown" role="menu">
                  <button
                    type="button"
                    className="account-add-option"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsGlobalAddModalOpen(true);
                    }}
                  >
                    <span className="account-add-option-label">{t('Add Manual Entry')}</span>
                    <span className="account-add-option-copy">
                      {t('Opens the ledger to add a transaction manually to this account.')}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>}

            <Link href="/transactions" className="btn btn-secondary">
              {t('Open Ledger')}
            </Link>
            {tradeEntry.canEdit && manualAccount ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAllowHardDeleteWithData(false);
                  setAccountMutationError(null);
                  setIsDeleteModalOpen(true);
                }}
              >
                {t('Archivieren / Löschen')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label={t('Account detail tabs')}>
          <button
            type="button"
            className={`tab ${tab === 'overview' ? 'active' : ''}`}
            onClick={() => setTab('overview')}
            aria-pressed={tab === 'overview'}
          >
            {t('Overview')}
          </button>
          <button
            type="button"
            className={`tab ${tab === 'transactions' ? 'active' : ''}`}
            onClick={() => setTab('transactions')}
            aria-pressed={tab === 'transactions'}
          >
            {t('Transactions')}
          </button>
        </div>
      </div>

      <div className="page-content animate-in">
        {priceError && !isCashAccount ? (
          <div className="callout warn">
            <Landmark size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Account prices are partially stale.')}</strong> {priceError}
            </div>
          </div>
        ) : null}

        {tab === 'overview' ? (
          <>
            <div className="card hero-card hero-card-primary">
              <div className="panel-header">
                <div>
                  <div className="section-title">
                    {isCashAccount ? t('Cash balance') : t('Account Overview')}
                  </div>
                  <div className="panel-subtitle">
                    {isCashAccount 
                      ? t('Current cash held in this account.') 
                      : t('Booked account value, invested basis, and current holdings in one view.')}
                  </div>
                </div>
                <span className="badge badge-blue">
                  {isCashAccount 
                    ? t('Cash only') 
                    : loadingPrices ? t('Loading prices…') : t(`${holdingsTable.length} holdings`)}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 18,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div className="card-value" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      {accountValuationAvailable
                        ? formatMoney(currentValue)
                        : t('Unavailable')}
                    </span>
                    {isCashAccount ? (
                      periodChangePct !== null && (
                        <span
                          style={{
                            fontSize: '0.45em',
                            fontWeight: 600,
                            color: periodChangePct >= 0 ? 'var(--green)' : 'var(--red)',
                          }}
                        >
                          ({formatPct(periodChangePct)})
                        </span>
                      )
                    ) : (
                      <span
                        style={{
                          fontSize: '0.45em',
                          fontWeight: 600,
                          color: accountFinancialMetricsAvailable
                            ? currentPnl >= 0
                              ? 'var(--green)'
                              : 'var(--red)'
                            : 'var(--text-muted)',
                        }}
                      >
                        {accountFinancialMetricsAvailable
                          ? `(${formatPct(currentReturnPct)})`
                          : `(${t('P&L unavailable')})`}
                      </span>
                    )}
                  </div>
                  {!isCashAccount && (
                    <div className="panel-subtitle" style={{ marginTop: 8 }}>
                      {t('Cost basis')}{' '}
                      {accountFinancialMetricsAvailable
                        ? formatMoney(currentInvested)
                        : t('Unavailable')}
                    </div>
                  )}
                </div>

              </div>

              <div className="dashboard-range-row">
                <div className="dashboard-range-controls">
                  <div className="dashboard-range-tabs" role="group" aria-label={t('Period')}>
                    {CHART_RANGE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`range-chip ${selectedRange === option.value ? 'active' : ''}`}
                        onClick={() => setSelectedRange(option.value)}
                        aria-pressed={selectedRange === option.value}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {!isCashAccount && (
                    <div className="dashboard-view-tabs">
                      <button
                        type="button"
                        className={`range-chip ${chartMode === 'value' ? 'active' : ''}`}
                        onClick={() => setChartMode('value')}
                        aria-pressed={chartMode === 'value'}
                      >
                        {displayCurrency.toUpperCase()}
                      </button>
                      <button
                        type="button"
                        className={`range-chip ${chartMode === 'performance' ? 'active' : ''}`}
                        onClick={() => setChartMode('performance')}
                        aria-pressed={chartMode === 'performance'}
                      >
                        %
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div
                className="dashboard-chart-shell"
                style={{ minHeight: 360, marginTop: 14 }}
              >
                {chartDisplayData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ComposedChart data={chartDisplayData} margin={{ top: 0, right: 0, left: -5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="accountDetailFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8ab4ff" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#8ab4ff" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.6} />
                      <XAxis
                        dataKey="shortDate"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        minTickGap={24}
                      />
                      <YAxis
                        domain={chartDomain}
                        width={getChartAxisWidth(chartDomain, numberLocale, chartAxisOptions)}
                        tickLine={false}
                        axisLine={false}
                        tick={(props: any) => {
                          const { x, y, payload } = props;
                          const val = Number(payload.value);
                          const formattedValue = formatChartAxis(val, chartDomain, numberLocale, chartAxisOptions);
                          return (
                            <g transform={`translate(${x},${y})`}>
                              <text x={language === 'ar' ? 10 : -10} y={4} textAnchor={language === 'ar' ? 'start' : 'end'} fill="none" stroke="var(--bg-card)" strokeWidth={2} fontSize={11} fontWeight="bold">
                                {formattedValue}
                              </text>
                              <text x={language === 'ar' ? 10 : -10} y={4} textAnchor={language === 'ar' ? 'start' : 'end'} fill="var(--text-muted)" fontSize={11}>
                                {formattedValue}
                              </text>
                            </g>
                          );
                        }}
                        orientation={language === 'ar' ? 'right' : 'left'}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) {
                            return null;
                          }

                          const point = payload[0]?.payload as (typeof chartDisplayData)[number] | undefined;
                          if (!point) {
                            return null;
                          }

                          return (
                            <div
                              style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border)',
                                borderRadius: 14,
                                color: 'var(--text-primary)',
                                padding: 14,
                                minWidth: 220,
                                display: 'grid',
                                gap: 8,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</div>
                              {!isCashAccount && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
                                  <span>{t('Account value')}</span>
                                  <strong>{formatMoney(point.marketValue)}</strong>
                                </div>
                              )}
                              {!isCashAccount && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
                                  <span>{t('Invested')}</span>
                                  <strong>{formatMoney(point.invested)}</strong>
                                </div>
                              )}
                              {!isCashAccount && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
                                  <span>{t('Profit/Loss')}</span>
                                  <strong style={{ color: (point.marketValue - point.invested) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {formatPct(((point.marketValue - point.invested) / (point.invested || 1)) * 100)}
                                  </strong>
                                </div>
                              )}
                              {isCashAccount && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
                                  <span>{t('Cash balance')}</span>
                                  <strong>{formatMoney(point.cashBalance)}</strong>
                                </div>
                              )}
                              {!isCashAccount && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
                                  <span>{t('Dividends')}</span>
                                  <strong>{formatMoney(point.cumulativeDividends)}</strong>
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Area
                        type={isCashAccount ? 'stepAfter' : 'monotone'}
                        dataKey="chartMarketValue"
                        stroke="#8ab4ff"
                        fill="url(#accountDetailFill)"
                        strokeWidth={2.3}
                        isAnimationActive={false}
                      />

                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state" style={{ height: '100%' }}>
                    {t('No history exists for this account yet. Add deposits, buys, or transfers and the account curve will start here.')}
                  </div>
                )}
              </div>

            </div>

            {!isCashAccount && (
            <div className="card">
              <div className="panel-header">
                <div>
                  <div className="section-title">{t('Investments')}</div>
                  <div className="panel-subtitle">
                    {t('Current positions booked against this account.')}
                  </div>
                </div>
                <span className="badge badge-teal">{accountMeta.kind}</span>
              </div>

              {holdingsTable.length > 0 ? (
                <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('symbol')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Asset')} {renderSortIcon('symbol')}
                          </div>
                        </th>
                        <th onClick={() => handleSort('price')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Latest available price')} {renderSortIcon('price')}
                          </div>
                        </th>
                        <th onClick={() => handleSort('value')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Current Value')} {renderSortIcon('value')}
                          </div>
                        </th>
                        <th onClick={() => handleSort('invested')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Cost Basis')} {renderSortIcon('invested')}
                          </div>
                        </th>
                        <th onClick={() => handleSort('totalReturn')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Return')} {renderSortIcon('totalReturn')}
                          </div>
                        </th>
                        <th onClick={() => handleSort('realizedPnl')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Realized')} {renderSortIcon('realizedPnl')}
                          </div>
                        </th>
                        {!isCashAccount && (
                          <th onClick={() => handleSort('tradeCount')} style={{ cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {t('Transactions')} {renderSortIcon('tradeCount')}
                            </div>
                          </th>
                        )}
                        {!isCashAccount && (
                          <th onClick={() => handleSort('dividendTotal')} style={{ cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {t('Dividends')} {renderSortIcon('dividendTotal')}
                            </div>
                          </th>
                        )}
                        <th onClick={() => handleSort('allocation')} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Allocation')} {renderSortIcon('allocation')}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdingsTable.map((asset) => {
                        const invested = asset.amount * asset.avgCost;
                        const tradeCount = holdingInsights[asset.symbol]?.tradeCount ?? 0;
                        const dividendTotal = accountTransactions
                          .filter((tx) => tx.asset.trim().toUpperCase() === asset.symbol && tx.type === 'dividend')
                          .reduce((sum, tx) => sum + tx.total, 0);

                        return (
                          <tr key={asset.symbol}>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <strong>{asset.symbol}</strong>
                                <span className={`badge ${ASSET_CLASS_BADGE_CLASSES[asset.assetClass as AssetClass]}`}>
                                  {ASSET_CLASS_LABELS[asset.assetClass as AssetClass]}
                                </span>
                              </div>
                            </td>
                            <td className="mono">
                              {asset.valuationAvailable
                                ? formatMoney(asset.price)
                                : t('Unavailable')}
                            </td>
                            <td className="mono">
                              <div>
                                {asset.valuationAvailable
                                  ? formatMoney(asset.value)
                                  : t('Unavailable')}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                {asset.amount}
                              </div>
                            </td>
                            <td className="mono">
                              <div>
                                {asset.costBasisAvailable
                                  ? formatMoney(invested)
                                  : t('Unavailable')}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                {asset.costBasisAvailable
                                  ? `⌀ ${formatMoney(asset.avgCost)}`
                                  : t('Historical FX data required')}
                              </div>
                            </td>
                            <td>
                              {asset.financialMetricsAvailable ? (() => {
                                const totalReturn = asset.totalReturn;
                                const returnPct = asset.returnPct;
                                return (
                                  <div
                                    className="mono"
                                    style={{ 
                                      color: totalReturn >= 0.01 
                                        ? 'var(--green)' 
                                        : totalReturn <= -0.01 
                                          ? 'var(--red)' 
                                          : 'var(--text-primary)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 4
                                    }}
                                  >
                                    <span>
                                      {Math.abs(totalReturn) < 0.01 
                                        ? formatMoney(0) 
                                        : formatSignedMoney(totalReturn)}
                                    </span>
                                    {invested > 0 && (
                                      <div style={{ 
                                        color: returnPct >= 0 ? 'var(--green)' : 'var(--red)',
                                        fontSize: '0.85em'
                                      }}>
                                        ({formatPct(returnPct)})
                                      </div>
                                    )}
                                  </div>
                                );
                              })() : t('Unavailable')}
                            </td>
                            <td>
                              <div
                                className="mono"
                                style={{ 
                                  color: asset.realizedPnl >= 0.01 
                                    ? 'var(--green)' 
                                    : asset.realizedPnl <= -0.01 
                                      ? 'var(--red)' 
                                      : 'var(--text-primary)' 
                                }}
                              >
                                {asset.financialMetricsAvailable
                                  ? Math.abs(asset.realizedPnl) < 0.01
                                    ? formatMoney(0)
                                    : formatSignedMoney(asset.realizedPnl)
                                  : t('Unavailable')}
                              </div>
                            </td>
                            <td>
                              {tradeCount > 0 ? (
                                <button
                                  onClick={() => {
                                    setTransactionSearch(asset.symbol);
                                    setTab('transactions');
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--accent)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    padding: 0,
                                    textDecoration: 'underline',
                                    textUnderlineOffset: 3,
                                  }}
                                >
                                  {tradeCount}
                                </button>
                              ) : (
                                <span className="mono" style={{ color: 'var(--text-muted)' }}>—</span>
                              )}
                            </td>
                            <td>
                              <div
                                className="mono"
                                style={{
                                  color: dividendTotal > 0.01 ? 'var(--green)' : 'var(--text-primary)',
                                }}
                              >
                                {asset.dividendTotalAvailable
                                  ? dividendTotal > 0.01
                                    ? `+${formatMoney(dividendTotal)}`
                                    : '—'
                                  : t('Unavailable')}
                              </div>
                            </td>
                            <td className="mono">
                              {asset.valuationAvailable && accountValuationAvailable
                                ? `${asset.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                                : t('Unavailable')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  {t('No holdings are booked in this account yet. Add a buy, deposit, or transfer to start filling the detail view.')}
                </div>
              )}
            </div>
            )}
          </>
        ) : (
          <>
            {hasLocalLedgerWarning ? (
              <div className="callout warn">
                <TriangleAlert size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{t('This account view is built from local ledger entries.')}</strong> {t('Check deposits, fees, and transfers if the balance looks off.')}
                </div>
              </div>
            ) : null}

            <div className="card" style={{ padding: 0 }}>
              <div className="table-toolbar">
                <div>
                  <div className="section-title">{t('Transactions')}</div>
                  <div className="panel-subtitle">
                    {isCashAccount ? (
                      <>{transactionSummary.deposits} {t('deposits')} · {transactionSummary.withdrawals} {t('withdrawals')}</>
                    ) : (
                      <>{transactionSummary.buys} {t('buys')} · {transactionSummary.sells} {t('sells')} · {transactionSummary.dividends} {t('dividends')}</>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportTransactions}>
                    <Download size={14} />
                    {t('Export')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-secondary btn-sm ${showDetailedTransactionColumns ? 'is-active' : ''}`}
                    onClick={() => setShowDetailedTransactionColumns((current) => !current)}
                  >
                    <Columns3 size={14} />
                    {t('Columns')}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '18px 18px 0',
                }}
              >
                <div style={{ position: 'relative', minWidth: 190 }}>
                  <SlidersHorizontal
                    size={15}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 14,
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <select
                    className="select"
                    value={transactionTypeFilter}
                    onChange={(event) => {
                      setTransactionTypeFilter(event.target.value as AccountTransactionFilter);
                      setTransactionPage(1);
                    }}
                    style={{ minWidth: 190, paddingLeft: 40 }}
                  >
                    {(isCashAccount ? BANK_TRANSACTION_FILTER_OPTIONS : ALL_TRANSACTION_FILTER_OPTIONS).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ position: 'relative', flex: '1 1 320px' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 14,
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="search"
                    className="input"
                    value={transactionSearch}
                    onChange={(event) => {
                      setTransactionSearch(event.target.value);
                      setTransactionPage(1);
                    }}
                    placeholder={t('Search transactions...')}
                    style={{ paddingLeft: 42 }}
                  />
                </div>
              </div>

              {filteredAccountTransactions.length > 0 ? (
                                <>
                  <div className="table-container" style={{ border: 'none', borderRadius: 0, marginTop: 18 }}>
                  <table className="ledger-table">
                      <thead>
                        <tr>
                        <th onClick={() => handleTxSort('date')} style={{ cursor: 'pointer', width: '15%' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Date')} {renderTxSortIcon('date')}
                          </div>
                        </th>
                        <th onClick={() => handleTxSort('asset')} style={{ cursor: 'pointer', width: '25%' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Asset')} {renderTxSortIcon('asset')}
                          </div>
                        </th>
                        <th onClick={() => handleTxSort('price')} style={{ cursor: 'pointer', width: '20%' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Price & Amount')} {renderTxSortIcon('price')}
                          </div>
                        </th>
                        <th onClick={() => handleTxSort('total')} style={{ cursor: 'pointer', width: '20%' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Total')} {renderTxSortIcon('total')}
                          </div>
                        </th>
                        <th onClick={() => handleTxSort('taxType')} style={{ cursor: 'pointer', width: '15%' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {t('Taxes')} {renderTxSortIcon('taxType')}
                          </div>
                        </th>
                          <th style={{ width: '5%' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {pagedAccountTransactions.map((transaction) => {
                          const formatted = formatLedgerDate(transaction.date, language);
                          const transactionLabel = getTransactionTypeLabels(t)[transaction.type];
                          const assetClassLabel =
                            transaction.assetClass === 'cash'
                              ? t('Cash')
                              : ASSET_CLASS_LABELS[transaction.assetClass];
                          const priceLabel =
                            transaction.type === 'deposit' ||
                            transaction.type === 'withdrawal' ||
                            transaction.type === 'fee'
                              ? t('Direct cash flow')
                              : formatQuoteMoney(transaction.price, transaction.quote, language);
                          const totalLabel = formatQuoteMoney(transaction.total, transaction.quote, language);

                          return (
                            <tr key={transaction.id}>
                              <td style={{ verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span
                                    className={`badge ledger-badge ${
                                      transaction.type === 'buy'
                                        ? 'badge-green'
                                        : transaction.type === 'sell'
                                        ? 'badge-red'
                                        : 'badge-teal'
                                    }`}
                                  >
                                    {transactionLabel}
                                    </span>
                                </div>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatted.date}</div>
                                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{formatted.time}</div>
                              </td>
                              <td style={{ whiteSpace: 'normal', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45 }}>
                                  {transaction.assetName ?? transaction.asset}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                                  <span>{transaction.asset}</span>
                                  <span>{assetClassLabel}</span>
                                </div>
                              </td>
                              <td className="mono" style={{ verticalAlign: 'top' }}>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                                  {transaction.type === 'deposit' || transaction.type === 'withdrawal' || transaction.type === 'fee'
                                    ? t('Direct cash flow')
                                    : transaction.quote === 'EUR'
                                    ? `${transaction.price.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`
                                    : `${getCurrencySymbol(transaction.quote)}${transaction.price.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                                  {transaction.amount.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 })}
                                </div>
                              </td>
                              <td className="mono" style={{ verticalAlign: 'top' }}>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                                  {transaction.quote === 'EUR'
                                    ? `${transaction.total.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`
                                    : `${getCurrencySymbol(transaction.quote)}${transaction.total.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                </div>
                                {transaction.quote !== 'EUR' && (
                                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                    {t('FX conversion unavailable')}
                                  </div>
                                )}
                              </td>
                              <td style={{ verticalAlign: 'top' }}>
                                <div style={{ color: 'var(--text-primary)' }}>
                                  {transaction.type === 'sell' || transaction.type === 'dividend'
                                    ? t('Unavailable')
                                    : '—'}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                  {getTaxTypeLabels(t)[transaction.taxType]}
                                </div>
                              </td>
                              <td style={{ width: 60, textAlign: 'right' }}>
                                {tradeEntry.canEdit && transaction.source === 'manual' ? (
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setEditingTransaction(transaction)}
                                    title={t('Edit entry')}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--text-faint)' }}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: 18,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {TRANSACTION_PAGE_SIZES.map((pageSize) => (
                        <button
                          key={pageSize}
                          type="button"
                          className={`range-chip ${transactionPageSize === pageSize ? 'active' : ''}`}
                          onClick={() => {
                            setTransactionPageSize(pageSize);
                            setTransactionPage(1);
                          }}
                        >
                          {pageSize}
                        </button>
                      ))}
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('Rows per page')}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        <bdi dir="auto">{transactionRangeStart.toLocaleString(numberLocale)}–{transactionRangeEnd.toLocaleString(numberLocale)}</bdi>{' '}
                        {t('of')}{' '}
                        <bdi dir="auto">{filteredAccountTransactions.length.toLocaleString(numberLocale)}</bdi>
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setTransactionPage((page) => Math.max(1, page - 1))}
                          disabled={currentTransactionPage <= 1}
                          aria-label={t('Previous page')}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setTransactionPage((page) => Math.min(totalTransactionPages, page + 1))
                          }
                          disabled={currentTransactionPage >= totalTransactionPages}
                          aria-label={t('Next page')}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  {t('No transactions match the current filter. Adjust the search or type filter.')}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {tradeEntry.canEdit && isImportModalOpen ? (
        <Dialog open onClose={closeImportModal} labelledBy="account-import-title">
            <div className="account-create-header">
              <div>
                <div id="account-import-title" className="account-create-title">
                  {selectedImportLabel} {t('for')} {accountMeta.label}
                </div>
                <div className="account-create-subtitle">{selectedImportDescription}</div>
              </div>

              <button
                type="button"
                className="account-create-close"
                onClick={closeImportModal}
                aria-label={t('Close import dialog')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="account-create-meta">
              <span className="status-pill neutral">{accountMeta.kind}</span>
              <span className="status-pill neutral">
                {selectedImportKind === 'pdf' ? <FileText size={13} /> : <FileSpreadsheet size={13} />}
                {selectedImportLabel} {t('Import')}
              </span>
            </div>

            <div className="account-create-form">
              <div>
                <label className="label">{t('Select')} {selectedImportLabel} {t('File')}</label>
                <input
                  ref={importInputRef}
                  className="input"
                  type="file"
                  accept={selectedImportAccept}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setSelectedImportFileName(file?.name ?? '');
                  }}
                />
                {selectedImportFileName ? (
                  <div className="account-create-helper" style={{ marginTop: 10 }}>
                    {t('Selected')}: {selectedImportFileName}
                  </div>
                ) : null}
              </div>

              <div className="callout warn">
                <TriangleAlert size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{t('No active parser.')}</strong> {t('The file is not yet automatically converted into transactions. The next logical step is therefore the manual ledger with account pre-selection.')}
                </div>
              </div>
            </div>

            <div className="account-create-footer">
              <button type="button" className="btn btn-secondary" onClick={closeImportModal}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  closeImportModal();
                  setIsGlobalAddModalOpen(true);
                }}
              >
                {t('Continue Manually')}
              </button>
            </div>
        </Dialog>
      ) : null}
      {tradeEntry.dialog}
      {tradeEntry.canEdit && isGlobalAddModalOpen ? (
        <GlobalAddModal
          onClose={() => setIsGlobalAddModalOpen(false)}
          initialVenue={venue}
        />
      ) : null}
      {tradeEntry.canEdit && isRenameModalOpen ? (
        <Dialog open onClose={() => setIsRenameModalOpen(false)} labelledBy="account-rename-title">
          <div className="account-create-header">
            <div>
              <div id="account-rename-title" className="account-create-title">
                {t('Rename Account')}
              </div>
              <div className="account-create-subtitle">
                {t('Change the label for this manual account. Transactions will stay linked.')}
              </div>
            </div>
            <button
              type="button"
              className="account-create-close"
              onClick={() => setIsRenameModalOpen(false)}
              aria-label={t('Close dialog')}
            >
              <X size={18} />
            </button>
          </div>

          <div className="account-create-form">
            <div>
              <label className="label">{t('Account Name')}</label>
              <input
                className="input"
                type="text"
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                placeholder={t('e.g. My New Account Name')}
              />
            </div>
            {manualAccount?.kind === 'Bank Account' && manualAccount.cashCategory === 'investment_cash' ? (
              <div>
                <label className="label">{t('Use this Investment-Cash for')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  {[
                    { route: 'stock' as const, label: 'Aktien' },
                    { route: 'etf' as const, label: 'ETF' },
                    { route: 'crypto' as const, label: 'Krypto' },
                    { route: 'metal' as const, label: 'Gold / Metalle' },
                  ].map((option) => {
                    const active = renameCashRoutes.includes(option.route);
                    return (
                      <button
                        key={option.route}
                        type="button"
                        className={`range-chip ${active ? 'active' : ''}`}
                        onClick={() => toggleRenameCashRoute(option.route)}
                      >
                        {t(option.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {accountMutationError ? (
            <div className="callout warn">{t(accountMutationError)}</div>
          ) : null}

          <div className="account-create-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setIsRenameModalOpen(false)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (renameLabel.trim()) {
                  setAccountMutationError(null);
                  setIsMutatingAccount(true);
                  try {
                    await updateManualAccount(venue, {
                      label: renameLabel.trim(),
                      cashRoutes:
                        manualAccount?.kind === 'Bank Account' && manualAccount.cashCategory === 'investment_cash'
                          ? renameCashRoutes
                          : manualAccount?.cashRoutes ?? [],
                    });
                    setIsRenameModalOpen(false);
                  } catch {
                    setAccountMutationError('Failed to save');
                  } finally {
                    setIsMutatingAccount(false);
                  }
                }
              }}
              disabled={!renameLabel.trim() || isMutatingAccount}
            >
              {isMutatingAccount ? t('Saving...') : t('Save')}
            </button>
          </div>
        </Dialog>
      ) : null}
      {tradeEntry.canEdit && isDeleteModalOpen && manualAccount ? (
        <Dialog open onClose={() => setIsDeleteModalOpen(false)} labelledBy="account-delete-title">
          <div className="account-create-header">
            <div>
              <div id="account-delete-title" className="account-create-title">
                {t('Archivieren / Löschen')}
              </div>
              <div className="account-create-subtitle">
                {t('Archivieren blendet das Konto aus, behält aber Historie für Steuer, Performance und Export.')}
              </div>
            </div>
            <button
              type="button"
              className="account-create-close"
              onClick={() => setIsDeleteModalOpen(false)}
              aria-label={t('Close dialog')}
            >
              <X size={18} />
            </button>
          </div>

          <div className="account-create-form">
            {openAssetHoldings.length > 0 ? (
              <div className="callout warn">
                <TriangleAlert size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{t('Offene Positionen vorhanden')}:</strong>{' '}
                  {openAssetHoldings.map((holding) => `${holding.symbol} ${holding.amount}`).join(' · ')}.
                  <div style={{ marginTop: 6 }}>
                    {t('Übertrage die Positionen zuerst auf ein anderes Konto oder verkaufe sie, damit der Erlös ins Investment-Cash gebucht wird.')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setIsDeleteModalOpen(false);
                        setIsGlobalAddModalOpen(true);
                      }}
                    >
                      {t('Transfer oder Verkauf buchen')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {hasOpenCash ? (
              <div className="callout warn">
                <TriangleAlert size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{t('Cash vorhanden')}:</strong>{' '}
                  {openCashBalances
                    .map(
                      (balance) =>
                        `${balance.amount.toLocaleString(
                          language === 'de'
                            ? 'de-DE'
                            : language === 'ar'
                              ? 'ar-SA'
                              : 'en-US',
                          { maximumFractionDigits: 8 },
                        )} ${balance.symbol}`,
                    )
                    .join(' · ')}
                  .{' '}
                  {t('Bitte auszahlen, übertragen oder bewusst endgültig löschen.')}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportTransactions}>
                      {t('Export')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={allowHardDeleteWithData}
                onChange={(event) => setAllowHardDeleteWithData(event.target.checked)}
              />
              <span>{t('Ich verstehe, dass endgültiges Löschen Konto und manuelle Transaktionen entfernt. Export vorher empfohlen.')}</span>
            </label>
          </div>

          {accountMutationError ? (
            <div className="callout warn">{t(accountMutationError)}</div>
          ) : null}

          <div className="account-create-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setIsDeleteModalOpen(false)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={archiveAccount}
              disabled={openAssetHoldings.length > 0 || isMutatingAccount}
            >
              {t('Archivieren')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={hardDeleteAccount}
              disabled={
                isMutatingAccount ||
                ((openAssetHoldings.length > 0 || hasOpenCash) && !allowHardDeleteWithData)
              }
            >
              {t('Endgültig löschen')}
            </button>
          </div>
        </Dialog>
      ) : null}
      {tradeEntry.canEdit && editingTransaction && (
        <GlobalAddModal
          onClose={() => setEditingTransaction(null)}
          editTransaction={editingTransaction}
        />
      )}
    </AppShell>
  );
}
