import {
  ASSET_CLASS_OPTIONS,
  type AssetClass,
} from '@/lib/config/supported-assets';
import type {
  ManualAccount,
  ManualAccountCashCategory,
  ManualAccountPortfolioScope,
} from '@/lib/accounts/manual-accounts-store';
import type { AppTransaction } from '@/lib/transactions/manual-store';

export interface AccountHoldingSnapshot {
  symbol: string;
  assetClass: AssetClass | 'cash';
  amount: number;
  avgCost: number;
  value: number;
  valuationAvailable: boolean;
  change24h: number | null;
  changePeriod: '24h' | 'session' | 'unavailable';
  totalFeesEur: number;
  primaryVenue: string;
  costBasisAvailable: boolean;
  financialMetricsAvailable: boolean;
}

export interface AccountOverview {
  venue: string;
  label: string;
  kind: string;
  notes?: string;
  portfolioScope: ManualAccountPortfolioScope;
  cashCategory: ManualAccountCashCategory;
  needsPortfolioScopeReview: boolean;
  archivedAt?: string;
  allocation: number;
  value: number;
  invested: number;
  pnl: number;
  dayMove: number | null;
  positions: number;
  transactionCount: number;
  totalFeesEur: number;
  negativeCashValue: number;
  lastActivityAt: string | null;
  topSymbols: string[];
  assetMix: AssetClass[];
  isManualAccount: boolean;
  valuationAvailable: boolean;
  financialMetricsAvailable: boolean;
}

export interface AccountGroupOverview {
  kind: string;
  label: string;
  accounts: AccountOverview[];
  allocation: number;
  value: number;
  invested: number;
  pnl: number;
  dayMove: number | null;
  positions: number;
  transactionCount: number;
  negativeCashValue: number;
  topSymbols: string[];
  assetMix: AssetClass[];
  valuationAvailable: boolean;
  financialMetricsAvailable: boolean;
}

interface VenueMeta {
  label: string;
  kind: string;
  notes?: string;
  portfolioScope: ManualAccountPortfolioScope;
  cashCategory: ManualAccountCashCategory;
  needsPortfolioScopeReview: boolean;
  archivedAt?: string;
}

const ACCOUNT_GROUP_ORDER = ['Brokerage', 'Bank Account', 'Savings Account', 'Exchange', 'Vault', 'Other', 'Manual Portfolio'];

const ACCOUNT_GROUP_LABELS: Record<string, string> = {
  Brokerage: 'Brokerage',
  'Bank Account': 'Bank Account',
  'Savings Account': 'Savings Account',
  Exchange: 'Crypto',
  Vault: 'Precious Metals',
  Other: 'Other',
  'Manual Portfolio': 'Manual Portfolio',
};

const VENUE_META: Record<string, VenueMeta> = {
  binance: { label: 'Binance', kind: 'Exchange', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  bitvavo: { label: 'Bitvavo', kind: 'Exchange', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  gateio: { label: 'Gate.io', kind: 'Exchange', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  ibkr: { label: 'Interactive Brokers', kind: 'Brokerage', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  kraken: { label: 'Kraken', kind: 'Exchange', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  'scalable-capital': { label: 'Scalable Capital', kind: 'Brokerage', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  'trade-republic': { label: 'Trade Republic', kind: 'Brokerage', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  'bullion-vault': { label: 'BullionVault', kind: 'Vault', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
  'manual-entry': { label: 'Manual Entry', kind: 'Manual Portfolio', portfolioScope: 'portfolio', cashCategory: 'investment_cash', needsPortfolioScopeReview: false },
};

export function getVenueMeta(venue: string | null | undefined, manualAccounts: ManualAccount[] = []): VenueMeta {
  const safeVenue = venue?.trim() || 'manual-entry';
  const normalizedVenue = safeVenue.toLowerCase();
  const manualMatch = manualAccounts.find((account) => account.venue === safeVenue);
  if (manualMatch) {
    return {
      label: manualMatch.label,
      kind: manualMatch.kind,
      notes: manualMatch.notes,
      portfolioScope: manualMatch.portfolioScope ?? 'portfolio',
      cashCategory: manualMatch.cashCategory ?? (manualMatch.kind === 'Savings Account' ? 'savings_cash' : 'investment_cash'),
      needsPortfolioScopeReview: manualMatch.needsPortfolioScopeReview ?? false,
      archivedAt: manualMatch.archivedAt,
    };
  }

  const matched = VENUE_META[safeVenue];
  if (matched) {
    return matched;
  }

  const normalizedMatch = VENUE_META[normalizedVenue];
  if (normalizedMatch) {
    return normalizedMatch;
  }

  const labelMatch = Object.values(VENUE_META).find(
    (meta) => meta.label.trim().toLowerCase() === normalizedVenue,
  );
  if (labelMatch) {
    return labelMatch;
  }

  return {
    label: safeVenue
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    kind: 'Manual Portfolio',
    portfolioScope: 'portfolio',
    cashCategory: 'investment_cash',
    needsPortfolioScopeReview: false,
  };
}

export function formatActivityDate(
  value: string | null,
  locale = 'en-US',
  emptyLabel = 'No recent activity',
) {
  if (!value) {
    return emptyLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function getAccountGroupLabel(kind: string) {
  return ACCOUNT_GROUP_LABELS[kind] ?? kind;
}

export function buildAccountSummaries(
  holdings: AccountHoldingSnapshot[],
  totalValue: number,
  transactions: AppTransaction[],
  manualAccounts: ManualAccount[] = [],
) {
  const grouped = new Map<
    string,
    {
      assets: AccountHoldingSnapshot[];
      transactionCount: number;
      totalFeesEur: number;
      lastActivityAt: string | null;
      isManualAccount: boolean;
    }
  >();

  for (const account of manualAccounts) {
    if (account.archivedAt) continue;
    grouped.set(account.venue, {
      assets: [],
      transactionCount: 0,
      totalFeesEur: 0,
      lastActivityAt: null,
      isManualAccount: true,
    });
  }

  for (const asset of holdings) {
    const primaryVenue = asset.primaryVenue?.trim() || asset.primaryVenue || 'manual-entry';
    const current = grouped.get(primaryVenue) ?? {
      assets: [],
      transactionCount: 0,
      totalFeesEur: 0,
      lastActivityAt: null,
      isManualAccount: false,
    };

    current.assets.push(asset);
    current.totalFeesEur += asset.totalFeesEur;
    grouped.set(primaryVenue, current);
  }

  for (const transaction of transactions) {
    const venue = transaction.venue?.trim() || 'manual-entry';
    const current = grouped.get(venue) ?? {
      assets: [],
      transactionCount: 0,
      totalFeesEur: 0,
      lastActivityAt: null,
      isManualAccount: false,
    };

    current.transactionCount += 1;
    if (
      !current.lastActivityAt ||
      new Date(transaction.date).getTime() > new Date(current.lastActivityAt).getTime()
    ) {
      current.lastActivityAt = transaction.date;
    }
    grouped.set(venue, current);
  }

  const accountSummaries = [...grouped.entries()]
    .map(([venue, current]) => {
      const venueInfo = getVenueMeta(venue, manualAccounts);
      const sortedAssets = [...current.assets].sort((left, right) => right.value - left.value);
      const valuationAssets = sortedAssets.filter((asset) => asset.assetClass !== 'cash' || asset.amount > 0);
      const negativeCashValue = sortedAssets
        .filter((asset) => asset.assetClass === 'cash' && asset.amount < 0)
        .reduce((sum, asset) => sum + asset.value, 0);
      const valuationAvailable = valuationAssets.every(
        (asset) => asset.valuationAvailable,
      );
      const value = valuationAvailable
        ? valuationAssets.reduce((sum, asset) => sum + asset.value, 0)
        : 0;
      const financialMetricsAvailable = valuationAvailable && valuationAssets.every(
        (asset) => asset.costBasisAvailable && asset.financialMetricsAvailable,
      );
      const invested = financialMetricsAvailable
        ? valuationAssets.reduce((sum, asset) => sum + asset.amount * asset.avgCost, 0)
        : 0;
      const dayMove = sortedAssets.every(
        (asset) =>
          asset.valuationAvailable
          && asset.change24h !== null
          && asset.changePeriod === '24h',
      )
        ? sortedAssets.reduce(
            (sum, asset) => sum + (asset.value * (asset.change24h ?? 0)) / 100,
            0,
          )
        : null;
      const assetMix = ASSET_CLASS_OPTIONS.filter((option) =>
        valuationAssets.some((asset) => asset.assetClass === option.value),
      ).map((option) => option.value);

      return {
        venue,
        label: venueInfo.label,
        kind: venueInfo.kind,
        notes: venueInfo.notes,
        portfolioScope: venueInfo.portfolioScope,
        cashCategory: venueInfo.cashCategory,
        needsPortfolioScopeReview: venueInfo.needsPortfolioScopeReview,
        archivedAt: venueInfo.archivedAt,
        allocation: 0,
        value,
        invested,
        pnl: financialMetricsAvailable ? value - invested : 0,
        dayMove,
        positions: sortedAssets.length,
        transactionCount: current.transactionCount,
        totalFeesEur: Number(current.totalFeesEur.toFixed(2)),
        negativeCashValue: Number(negativeCashValue.toFixed(2)),
        lastActivityAt: current.lastActivityAt,
        topSymbols: valuationAssets.slice(0, 3).map((asset) => asset.symbol),
        assetMix,
        isManualAccount: current.isManualAccount,
        valuationAvailable,
        financialMetricsAvailable,
      } satisfies AccountOverview;
    });

  const portfolioValuationAvailable = accountSummaries.every(
    (account) => account.valuationAvailable,
  );
  const totalTrackedValue = portfolioValuationAvailable
    ? accountSummaries.reduce((sum, account) => sum + account.value, 0) || totalValue
    : 0;

  return accountSummaries
    .map((account) => ({
      ...account,
      allocation:
        portfolioValuationAvailable && totalTrackedValue > 0
          ? (account.value / totalTrackedValue) * 100
          : 0,
    }))
    .filter(
      (account) =>
        !account.archivedAt
        && (
          account.value > 0
          || account.positions > 0
          || account.transactionCount > 0
          || account.isManualAccount
        ),
    )
    .sort((left, right) => right.value - left.value);
}

export function buildAccountGroups(accountSummaries: AccountOverview[]) {
  const grouped = new Map<string, AccountOverview[]>();
  const portfolioValuationAvailable = accountSummaries.every(
    (account) => account.valuationAvailable,
  );
  const totalTrackedValue = portfolioValuationAvailable
    ? accountSummaries.reduce((sum, account) => sum + account.value, 0)
    : 0;

  for (const account of accountSummaries) {
    const current = grouped.get(account.kind) ?? [];
    current.push(account);
    grouped.set(account.kind, current);
  }

  return [...grouped.entries()]
    .map(([kind, accounts]) => {
      const topSymbols = [...new Set(accounts.flatMap((account) => account.topSymbols))].slice(0, 4);
      const assetMix = ASSET_CLASS_OPTIONS.filter((option) =>
        accounts.some((account) => account.assetMix.includes(option.value)),
      ).map((option) => option.value);
      const valuationAvailable = accounts.every(
        (account) => account.valuationAvailable,
      );
      const value = valuationAvailable
        ? accounts.reduce((sum, account) => sum + account.value, 0)
        : 0;
      const invested = accounts.reduce((sum, account) => sum + account.invested, 0);
      const dayMove = accounts.every((account) => account.dayMove !== null)
        ? accounts.reduce(
            (sum, account) => sum + (account.dayMove ?? 0),
            0,
          )
        : null;
      const positions = accounts.reduce((sum, account) => sum + account.positions, 0);
      const transactionCount = accounts.reduce((sum, account) => sum + account.transactionCount, 0);
      const negativeCashValue = accounts.reduce((sum, account) => sum + account.negativeCashValue, 0);
      const financialMetricsAvailable = valuationAvailable && accounts.every(
        (account) => account.financialMetricsAvailable,
      );

      return {
        kind,
        label: getAccountGroupLabel(kind),
        accounts,
        allocation:
          portfolioValuationAvailable && totalTrackedValue > 0
            ? (value / totalTrackedValue) * 100
            : 0,
        value,
        invested,
        pnl: financialMetricsAvailable ? value - invested : 0,
        dayMove,
        positions,
        transactionCount,
        negativeCashValue: Number(negativeCashValue.toFixed(2)),
        topSymbols,
        assetMix,
        valuationAvailable,
        financialMetricsAvailable,
      } satisfies AccountGroupOverview;
    })
    .sort((left, right) => {
      const leftOrder = ACCOUNT_GROUP_ORDER.indexOf(left.kind);
      const rightOrder = ACCOUNT_GROUP_ORDER.indexOf(right.kind);

      if (leftOrder !== rightOrder) {
        return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder) - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
      }

      return right.value - left.value;
    });
}
