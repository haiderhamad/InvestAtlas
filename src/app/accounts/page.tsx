'use client';

import Link from 'next/link';
import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import AccountGroupsList from '@/components/accounts/account-groups-list';
import AccountCreateModal from '@/components/accounts/account-create-modal';
import AccountVisibilityModal from '@/components/accounts/account-visibility-modal';
import {
  HIDDEN_ACCOUNTS_EVENT,
  readHiddenAccountVenues,
  resetHiddenAccountVenues,
  setHiddenAccountVenues,
  toggleHiddenAccountVenue,
} from '@/lib/accounts/account-visibility-store';
import {
  addManualAccount,
  getAllManualAccounts,
  MANUAL_ACCOUNTS_EVENT,
  readManualAccounts,
  type ManualAccountCashCategory,
  type ManualAccountCashRoute,
  type ManualAccountKind,
  type ManualAccountPortfolioScope,
} from '@/lib/accounts/manual-accounts-store';
import { DEMO_PORTFOLIO_GROWTH } from '@/lib/demo/investment-data';
import { getDemoSnapshotAsOfDay } from '@/lib/demo/showcase-snapshot';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  buildHoldingLedgerInsights,
  buildPortfolioMonitorSeries,
} from '@/lib/portfolio/ux-insights';
import {
  buildAccountGroups,
  buildAccountSummaries,
  getVenueMeta,
  type AccountHoldingSnapshot,
} from '@/lib/portfolio/account-overview';
import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  type CurrentFxRatesToEur,
} from '@/lib/portfolio/current-valuation';
import {
  createCurrentQuoteRequestCoordinator,
  fetchCurrentQuoteBatches,
  shouldRefreshCurrentQuotes,
  type CurrentQuoteRefreshPolicy,
} from '@/lib/financial-data/quotes/client';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import { calculateInvestmentTaxOverview } from '@/lib/tax/investment-tax';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_EVENT,
} from '@/lib/tax/tax-profile-store';
import { DEFAULT_TAX_PROFILE_SETTINGS } from '@/lib/tax/tax-profile';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import {
  deriveHoldingsFromTransactions,
} from '@/lib/transactions/holdings-engine';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import {
  ArrowRight,
  ChevronDown,
  Clock3,
  Landmark,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  WalletCards,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface MarketPrice {
  price: number;
  change24h: number | null;
  changePeriod?: '24h' | 'session' | 'unavailable';
  volume24h: number | null;
  marketCap: number | null;
}

type AssetHolding = ReturnType<typeof buildCurrentHoldingValuations>[number] & {
  price: number;
};

const ADD_ACCOUNT_PRESETS = [
  {
    id: 'depot',
    label: 'Brokerage',
    description: 'Create a brokerage or securities account for stocks and ETFs.',
    kind: 'Brokerage' as const,
    placeholder: 'e.g. Trade Republic Brokerage, IBKR Main',
    notesPlaceholder: 'Optional broker or account note',
  },
  {
    id: 'konto',
    label: 'Investment Cash',
    description: 'Create the central cash account used for buys and sale proceeds.',
    kind: 'Bank Account' as const,
    placeholder: 'e.g. ING Investment Cash, Trade Cash Hub',
    notesPlaceholder: 'Optional bank or routing note',
  },
  {
    id: 'sparkonto',
    label: 'Saving Cash',
    description: 'Create a separate saving cash account for reserves outside trading cash.',
    kind: 'Savings Account' as const,
    placeholder: 'e.g. ING Saving Cash, Sparkasse Sparkonto',
    notesPlaceholder: 'Optional saving purpose or bank note',
  },
  {
    id: 'kryptoportfolio',
    label: 'Crypto',
    description: 'Create an exchange or wallet bucket for crypto balances and trades.',
    kind: 'Exchange' as const,
    placeholder: 'e.g. Binance Spot, Kraken Main',
    notesPlaceholder: 'Optional exchange or wallet note',
  },
  {
    id: 'sonstige',
    label: 'Other',
    description: 'Create a flexible manual bucket for everything that does not fit elsewhere.',
    kind: 'Other' as const,
    placeholder: 'e.g. Family Pool, Special Account',
    notesPlaceholder: 'Optional internal description',
  },
  {
    id: 'edelmetalle',
    label: 'Precious Metals',
    description: 'Create a vault or bullion account for gold and silver positions.',
    kind: 'Vault' as const,
    placeholder: 'e.g. BullionVault, GoldSafe',
    notesPlaceholder: 'Optional vault or custody note',
  },
] as const;

type AddAccountPreset = (typeof ADD_ACCOUNT_PRESETS)[number];

export default function AccountsPage() {
  const { t, language } = useAppTranslation();
  const {
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
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const baseHoldings = useMemo(() => deriveHoldingsFromTransactions(transactions), [transactions]);
  const hasPriceableHoldings = baseHoldings.some(
    (holding) => holding.assetClass !== 'cash',
  );

  const [historicalPrices, setHistoricalPrices] = useState<Record<string, Array<{date: string, close: number}>>>({});
  
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

  const [syncing, setSyncing] = useState(false);
  const [assets, setAssets] = useState<AssetHolding[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [isEditViewOpen, setIsEditViewOpen] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editCollapsedGroups, setEditCollapsedGroups] = useState<string[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ReturnType<typeof getAllManualAccounts>>([]);
  const [hiddenAccountVenues, setHiddenAccountVenuesState] = useState<string[]>([]);
  const [taxProfileSettings, setTaxProfileSettings] = useState(DEFAULT_TAX_PROFILE_SETTINGS);
  const [selectedAddPresetId, setSelectedAddPresetId] = useState<string>('depot');
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [newAccountKind, setNewAccountKind] = useState<ManualAccountKind>('Brokerage');
  const [newAccountNotes, setNewAccountNotes] = useState('');
  const [newAccountPortfolioScope, setNewAccountPortfolioScope] =
    useState<ManualAccountPortfolioScope>('portfolio');
  const [newAccountCashCategory, setNewAccountCashCategory] =
    useState<ManualAccountCashCategory>('investment_cash');
  const [newAccountCashRoutes, setNewAccountCashRoutes] = useState<ManualAccountCashRoute[]>([
    'stock',
    'etf',
    'crypto',
    'metal',
  ]);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [isAccountSaving, setIsAccountSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const quoteRefreshPolicyRef = useRef<CurrentQuoteRefreshPolicy>('unknown');
  const quoteRequestCoordinatorRef = useRef<ReturnType<typeof createCurrentQuoteRequestCoordinator> | null>(null);
  if (!quoteRequestCoordinatorRef.current) {
    quoteRequestCoordinatorRef.current = createCurrentQuoteRequestCoordinator();
  }

  useEffect(() => {
    // Hydrate state from localStorage on client mount
    setTransactions(getAllTransactions());
    
    const syncTransactions = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setTransactions(event.detail);
      } else {
        setTransactions(getAllTransactions());
      }
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
    window.addEventListener('storage', syncTransactions);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
      window.removeEventListener('storage', syncTransactions);
    };
  }, []);

  useEffect(() => {
    // Hydrate state on client mount
    setManualAccounts(getAllManualAccounts());

    const syncManualAccounts = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setManualAccounts(event.detail);
      } else {
        setManualAccounts(getAllManualAccounts());
      }
    };

    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
    window.addEventListener('storage', syncManualAccounts);

    return () => {
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
      window.removeEventListener('storage', syncManualAccounts);
    };
  }, []);

  useEffect(() => {
    // Hydrate state from localStorage on client mount
    setHiddenAccountVenuesState(readHiddenAccountVenues());

    const syncHiddenAccounts = () => {
      setHiddenAccountVenuesState(readHiddenAccountVenues());
    };

    window.addEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
    window.addEventListener('storage', syncHiddenAccounts);

    return () => {
      window.removeEventListener(HIDDEN_ACCOUNTS_EVENT, syncHiddenAccounts as EventListener);
      window.removeEventListener('storage', syncHiddenAccounts);
    };
  }, []);

  useEffect(() => {
    // Hydrate state from localStorage on client mount
    setTaxProfileSettings(readTaxProfileSettings());

    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };

    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
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

  const fetchPrices = useCallback(async () => {
    let shouldFinalizeRequest = true;
    setSyncing(true);
    setError(null);

    try {
      if (baseHoldings.length === 0) {
        quoteRefreshPolicyRef.current = 'unknown';
        setAssets([]);
        setLastSync(null);
        setIsLive(false);
        return quoteRefreshPolicyRef.current;
      }

      const priceableHoldings = baseHoldings.filter((holding) => holding.assetClass !== 'cash');
      
      let prices: Record<string, MarketPrice> = {};
      let timestamp = new Date().toISOString();

      if (priceableHoldings.length > 0) {
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
        if (data.status === 'unavailable') throw new Error('Price fetch failed');
        prices = data.prices;
        timestamp = data.timestamp ?? timestamp;
      } else {
        quoteRefreshPolicyRef.current = 'unknown';
      }

      const enriched: AssetHolding[] = buildCurrentHoldingValuations(
        baseHoldings,
        prices,
        fxRatesToEur,
      ).map((holding) => ({
        ...holding,
        price: holding.currentPrice,
      }));

      setAssets(enriched);
      setLastSync(timestamp);
      setIsLive(isCurrentValuationComplete(enriched));
    } catch (fetchError) {
      setAssets(
        buildCurrentHoldingValuations(
          baseHoldings,
          undefined,
          fxRatesToEur,
        ).map((holding) => ({
          ...holding,
          price: holding.currentPrice,
        })),
      );
      setLastSync(null);
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
      buildCurrentHoldingValuations(
        baseHoldings,
        undefined,
        fxRatesToEur,
      ).map((holding) => ({
        ...holding,
        price: holding.currentPrice,
      })),
    );
    setLastSync(null);
    setIsLive(false);
    setSyncing(false);
    return () => quoteRequestCoordinatorRef.current?.cancel();
  }, [baseHoldings, fxRatesToEur]);

  useEffect(() => {
    if (
      transactions.length > 0
      && shouldRefreshCurrentQuotes(
        quoteRefreshPolicyRef.current,
        document.visibilityState,
      )
    ) {
      void fetchPrices();
    }
  }, [fetchPrices, transactions.length]);

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
    () => calculateInvestmentTaxOverview(transactions, taxProfileSettings),
    [taxProfileSettings, transactions],
  );
  const holdingInsights = useMemo(
    () => buildHoldingLedgerInsights(transactions, taxOverview),
    [taxOverview, transactions],
  );

  const valuationAssets = useMemo(
    () => assets.filter((asset) => asset.assetClass !== 'cash' || asset.amount > 0),
    [assets],
  );
  const accountValuationAvailable = isCurrentValuationComplete(valuationAssets);
  const chartAssets = useMemo(
    () =>
      valuationAssets.filter(
        (asset) =>
          asset.assetClass !== 'cash' ||
          getVenueMeta(asset.venue, manualAccounts).cashCategory === 'savings_cash',
      ),
    [manualAccounts, valuationAssets],
  );
  const chartValuationAvailable = isCurrentValuationComplete(chartAssets);
  const chartExcludedCashVenues = useMemo(() => {
    const venues = new Set<string>();
    manualAccounts.forEach((account) => venues.add(account.venue));
    transactions.forEach((transaction) => {
      venues.add(transaction.venue);
      if (transaction.settlementVenue) {
        venues.add(transaction.settlementVenue);
      }
    });

    return [...venues].filter(
      (venue) => getVenueMeta(venue, manualAccounts).cashCategory !== 'savings_cash',
    );
  }, [manualAccounts, transactions]);
  const totalValue = accountValuationAvailable
    ? valuationAssets.reduce((sum, asset) => sum + asset.value, 0)
    : 0;
  const chartValue = chartValuationAvailable
    ? chartAssets.reduce((sum, asset) => sum + asset.value, 0)
    : 0;
  const chartCost = chartAssets.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0);
  const portfolioMonitorData = useMemo(
    () => {
      if (!chartValuationAvailable) {
        return [];
      }

      return buildPortfolioMonitorSeries(transactions, DEMO_PORTFOLIO_GROWTH, {
        monthKey: new Date().toISOString().slice(0, 7),
        asOfDay: getDemoSnapshotAsOfDay(transactions),
        invested: chartCost,
        marketValue: chartValue,
        sleeves: {
          crypto: chartAssets.filter((asset) => asset.assetClass === 'crypto').reduce((sum, asset) => sum + asset.value, 0),
          stock: chartAssets.filter((asset) => asset.assetClass === 'stock').reduce((sum, asset) => sum + asset.value, 0),
          etf: chartAssets.filter((asset) => asset.assetClass === 'etf').reduce((sum, asset) => sum + asset.value, 0),
          metal: chartAssets.filter((asset) => asset.assetClass === 'metal').reduce((sum, asset) => sum + asset.value, 0),
        },
      }, historicalPrices, {
        excludedCashVenues: chartExcludedCashVenues,
        language,
      });
    },
    [chartAssets, chartCost, chartExcludedCashVenues, chartValue, chartValuationAvailable, historicalPrices, language, transactions],
  );

  const totalBookedDividends =
    portfolioMonitorData[portfolioMonitorData.length - 1]?.cumulativeDividends ?? null;
  const holdingsTable = useMemo(
    () =>
      assets
        .slice()
        .sort((left, right) => right.allocation - left.allocation)
        .map((asset) => ({
          ...asset,
          realizedPnl: holdingInsights[asset.symbol]?.realizedPnl ?? 0,
          primaryVenue: asset.venue,
          oldestOpenLotAt: holdingInsights[asset.symbol]?.oldestOpenLotAt ?? null,
          holdingDays: holdingInsights[asset.symbol]?.holdingDays ?? null,
          totalFeesEur: holdingInsights[asset.symbol]?.totalFeesEur ?? 0,
          financialMetricsAvailable:
            asset.valuationAvailable
            && (holdingInsights[asset.symbol]?.financialMetricsAvailable ?? false),
        })),
    [assets, holdingInsights],
  );

  const allAccountSummaries = useMemo(
    () => buildAccountSummaries(holdingsTable as AccountHoldingSnapshot[], totalValue, transactions, manualAccounts),
    [holdingsTable, manualAccounts, totalValue, transactions],
  );
  const totalNegativeCash = allAccountSummaries.reduce((sum, account) => sum + account.negativeCashValue, 0);
  const hiddenAccountSet = useMemo(() => new Set(hiddenAccountVenues), [hiddenAccountVenues]);
  const accountSummaries = useMemo(
    () => allAccountSummaries.filter((account) => !hiddenAccountSet.has(account.venue)),
    [allAccountSummaries, hiddenAccountSet],
  );
  const allAccountGroups = useMemo(
    () => buildAccountGroups(allAccountSummaries),
    [allAccountSummaries],
  );
  const accountGroups = useMemo(
    () => buildAccountGroups(accountSummaries),
    [accountSummaries],
  );
  const brokerages = accountGroups.find((group) => group.kind === 'Brokerage');
  const bankAccounts = accountGroups.find((group) => group.kind === 'Bank Account');
  const savingsAccounts = accountGroups.find((group) => group.kind === 'Savings Account');
  const exchanges = accountGroups.find((group) => group.kind === 'Exchange');
  const vaults = accountGroups.find((group) => group.kind === 'Vault');
  const allGroupsCollapsed = accountGroups.length > 0 && collapsedGroups.length === accountGroups.length;
  const hiddenAccountCount = allAccountSummaries.filter((account) => hiddenAccountSet.has(account.venue)).length;
  const visibleAccountValuationAvailable = accountSummaries.every(
    (account) => account.valuationAvailable,
  );
  const visibleAccountValue = visibleAccountValuationAvailable
    ? accountSummaries.reduce((sum, account) => sum + account.value, 0)
    : 0;
  const selectedAddPreset = useMemo(
    () => ADD_ACCOUNT_PRESETS.find((preset) => preset.id === selectedAddPresetId) ?? ADD_ACCOUNT_PRESETS[0],
    [selectedAddPresetId],
  );
  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: language !== 'de' 
      })
    : '—';

  const toggleGroup = (groupKind: string) => {
    setCollapsedGroups((current) =>
      current.includes(groupKind)
        ? current.filter((kind) => kind !== groupKind)
        : [...current, groupKind],
    );
  };

  const toggleAllGroups = () => {
    setCollapsedGroups((current) =>
      current.length === accountGroups.length ? [] : accountGroups.map((group) => group.kind),
    );
  };

  const toggleEditGroup = (groupKind: string) => {
    setEditCollapsedGroups((current) =>
      current.includes(groupKind)
        ? current.filter((kind) => kind !== groupKind)
        : [...current, groupKind],
    );
  };

  const toggleAllEditGroups = () => {
    setEditCollapsedGroups((current) =>
      current.length === allAccountGroups.length ? [] : allAccountGroups.map((group) => group.kind),
    );
  };

  const openCreateModal = (preset: AddAccountPreset) => {
    setSelectedAddPresetId(preset.id);
    setNewAccountKind(preset.kind);
    if (preset.kind === 'Savings Account') {
      setNewAccountPortfolioScope('portfolio');
      setNewAccountCashCategory('savings_cash');
      setNewAccountCashRoutes([]);
    } else if (preset.kind === 'Bank Account') {
      setNewAccountPortfolioScope('portfolio');
      setNewAccountCashCategory('investment_cash');
      setNewAccountCashRoutes(['stock', 'etf', 'crypto', 'metal']);
    } else {
      setNewAccountPortfolioScope('portfolio');
      setNewAccountCashCategory('investment_cash');
      setNewAccountCashRoutes([]);
    }
    setNewAccountLabel('');
    setNewAccountNotes('');
    setAccountFormError(null);
    setIsAddMenuOpen(false);
    setIsCreateModalOpen(true);
  };

  const handleAddManualAccount = async () => {
    setAccountFormError(null);

    if (!newAccountLabel.trim()) {
      setAccountFormError(t('Enter an account name first.'));
      return;
    }

    setIsAccountSaving(true);
    try {
      await addManualAccount({
        label: newAccountLabel,
        kind: newAccountKind,
        portfolioScope: newAccountPortfolioScope,
        cashCategory: newAccountCashCategory,
        cashRoutes: newAccountKind === 'Bank Account' && newAccountCashCategory === 'investment_cash'
          ? newAccountCashRoutes
          : [],
        notes: newAccountNotes,
      });

      setNewAccountLabel('');
      setNewAccountNotes('');
      setIsCreateModalOpen(false);
      setCollapsedGroups([]);
    } catch (error) {
      setAccountFormError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setIsAccountSaving(false);
    }
  };

  const handleToggleAccountVisibility = (venue: string) => {
    toggleHiddenAccountVenue(venue);
  };

  const handleHideAllAccounts = () => {
    setHiddenAccountVenues(allAccountSummaries.map((account) => account.venue));
  };

  const handleShowAllAccounts = () => {
    setHiddenAccountVenues([]);
  };

  const handleResetAccountVisibility = () => {
    resetHiddenAccountVenues();
  };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <WalletCards size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Portfolios & Accounts')}
            </h1>

            <div className="page-header-meta">
              <span className={`status-pill ${isLive ? 'live' : 'neutral'}`}>
                {isLive ? <Wifi size={13} /> : <WifiOff size={13} />}
                {isLive ? t('Latest EOD pricing available') : t('Unavailable')}
              </span>
              <span className="status-pill neutral">
                <Clock3 size={13} />
                {t('Last sync')} {syncLabel}
              </span>
              <span className="status-pill neutral">
                <Layers size={13} />
                {t(`${accountSummaries.length} visible accounts in ${accountGroups.length} groups`)}
              </span>
              {hiddenAccountCount > 0 ? (
                <span className="status-pill warn">
                  {t(`${hiddenAccountCount} hidden`)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="page-header-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsEditViewOpen(true)}
              disabled={allAccountSummaries.length === 0}
            >
              <Pencil size={16} />
              {t('Edit')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openCreateModal(ADD_ACCOUNT_PRESETS[0])}
            >
              <Plus size={16} />
              {t('Add')}
            </button>
            <button className="btn btn-secondary" onClick={fetchPrices} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'loading-spin' : undefined} />
              {syncing ? t('Refreshing…') : t('Refresh')}
            </button>
          </div>
        </div>
      </div>

      <div className="page-content animate-in">


        {error && error !== 'No valid symbols provided' ? (
          <div className="callout warn">
            <Landmark size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Account values are partially stale.')}</strong> {error}. {t('The page keeps the last local structure until pricing becomes available again.')}
            </div>
          </div>
        ) : null}
        {!syncing && valuationAssets.length > 0 && !accountValuationAvailable ? (
          <div className="callout warn">
            <Landmark size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Unavailable — insufficient data')}</strong>{' '}
              {t('Allocation appears once holdings have sourced market prices.')}
            </div>
          </div>
        ) : null}
        {totalNegativeCash < 0 ? (
          <div className="callout warn">
            <Landmark size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Cash correction required')}:</strong> {formatMoney(totalNegativeCash)}.{' '}
              {t('Book a deposit or transfer into the affected account before saving new buys.')}
            </div>
          </div>
        ) : null}
        {(bankAccounts?.accounts.length ?? 0) + (savingsAccounts?.accounts.length ?? 0) === 0 ? (
          <div className="callout" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{t('No cash account yet.')}</strong>{' '}
              {t('Create an Investment-Cash or Saving Cash account when you want cash outside a broker.')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreateModal(ADD_ACCOUNT_PRESETS[1])}>
                {t('Investment-Cash Konto anlegen')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreateModal(ADD_ACCOUNT_PRESETS[2])}>
                {t('Saving Cash / Sparkonto anlegen')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="summary-strip" style={{ marginBottom: 18 }}>
          <div className="summary-item">
            <span>{t('Brokerage')}</span>
            <strong>{brokerages?.accounts.length ?? 0}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {brokerages
                ? brokerages.valuationAvailable
                  ? formatMoney(brokerages.value)
                  : t('Unavailable')
                : formatMoney(0)}
            </div>
          </div>
          <div className="summary-item">
            <span>{t('Bank Accounts')}</span>
            <strong>{bankAccounts?.accounts.length ?? 0}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {bankAccounts
                ? bankAccounts.valuationAvailable
                  ? formatMoney(bankAccounts.value)
                  : t('Unavailable')
                : formatMoney(0)}
            </div>
          </div>
          <div className="summary-item">
            <span>{t('Saving Cash')}</span>
            <strong>{savingsAccounts?.accounts.length ?? 0}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {savingsAccounts
                ? savingsAccounts.valuationAvailable
                  ? formatMoney(savingsAccounts.value)
                  : t('Unavailable')
                : formatMoney(0)}
            </div>
          </div>
          <div className="summary-item">
            <span>{t('Crypto')}</span>
            <strong>{exchanges?.accounts.length ?? 0}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {exchanges
                ? exchanges.valuationAvailable
                  ? formatMoney(exchanges.value)
                  : t('Unavailable')
                : formatMoney(0)}
            </div>
          </div>
          <div className="summary-item">
            <span>{t('Precious Metals')}</span>
            <strong>{vaults?.accounts.length ?? 0}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {vaults
                ? vaults.valuationAvailable
                  ? formatMoney(vaults.value)
                  : t('Unavailable')
                : formatMoney(0)}
            </div>
          </div>
          <div className="summary-item">
            <span>{t('Total account value')}</span>
            <strong>
              {visibleAccountValuationAvailable
                ? formatMoney(visibleAccountValue)
                : t('Unavailable')}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {totalBookedDividends === null
                ? t('Unavailable')
                : formatMoney(totalBookedDividends)}{' '}
              {t('booked dividends all time')}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Account Breakdown')}</div>

            </div>
            <div className="panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={toggleAllGroups}
                disabled={accountGroups.length === 0}
              >
                {allGroupsCollapsed ? t('Expand all') : t('Collapse all')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${showAdvancedDetails ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setShowAdvancedDetails((current) => !current)}
              >
                {showAdvancedDetails ? t('Hide detail') : t('Show detail')}
              </button>
              <Link href="/" className="btn btn-secondary btn-sm">
                {t('Back to Dashboard')}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {accountGroups.length > 0 ? (
            <AccountGroupsList
              groups={accountGroups}
              showAllAccounts
              showAdvancedDetails={showAdvancedDetails}
              collapsible
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
            />
          ) : allAccountSummaries.length > 0 ? (
            <div className="dashboard-helper-text">
              {t('All tracked accounts are currently hidden. Open `Edit` to show them again.')}
            </div>
          ) : (
            <div className="dashboard-helper-text">
              {t('No accounts are visible yet. Add transactions first so the app can derive brokers, exchanges, and vaults.')}
            </div>
          )}
        </div>
      </div>

      {isEditViewOpen ? (
        <AccountVisibilityModal
          groups={allAccountGroups}
          hiddenVenues={hiddenAccountVenues}
          collapsedGroups={editCollapsedGroups}
          onClose={() => setIsEditViewOpen(false)}
          onToggleGroup={toggleEditGroup}
          onToggleAllGroups={toggleAllEditGroups}
          onToggleAccount={handleToggleAccountVisibility}
          onHideAll={handleHideAllAccounts}
          onShowAll={handleShowAllAccounts}
          onReset={handleResetAccountVisibility}
        />
      ) : null}

      {isCreateModalOpen ? (
        <AccountCreateModal
          presets={ADD_ACCOUNT_PRESETS}
          selectedPresetId={selectedAddPresetId}
          onSelectPreset={(id) => {
            setSelectedAddPresetId(id);
            const preset = ADD_ACCOUNT_PRESETS.find(p => p.id === id);
            if (preset) {
              setNewAccountKind(preset.kind);
              if (preset.kind === 'Savings Account') {
                setNewAccountPortfolioScope('portfolio');
                setNewAccountCashCategory('savings_cash');
                setNewAccountCashRoutes([]);
              } else if (preset.kind === 'Bank Account') {
                setNewAccountPortfolioScope('portfolio');
                setNewAccountCashCategory('investment_cash');
                setNewAccountCashRoutes(['stock', 'etf', 'crypto', 'metal']);
              } else {
                setNewAccountPortfolioScope('portfolio');
                setNewAccountCashCategory('investment_cash');
                setNewAccountCashRoutes([]);
              }
            }
          }}
          label={newAccountLabel}
          notes={newAccountNotes}
          portfolioScope={newAccountPortfolioScope}
          cashCategory={newAccountCashCategory}
          cashRoutes={newAccountCashRoutes}
          formError={accountFormError}
          isSubmitting={isAccountSaving}
          onChangeLabel={setNewAccountLabel}
          onChangeNotes={setNewAccountNotes}
          onChangeCashPurpose={(scope, category) => {
            setNewAccountPortfolioScope(scope);
            setNewAccountCashCategory(category);
          }}
          onChangeCashRoutes={setNewAccountCashRoutes}
          onClose={() => {
            setIsCreateModalOpen(false);
            setAccountFormError(null);
          }}
          onSubmit={handleAddManualAccount}
        />
      ) : null}
    </AppShell>
  );
}
