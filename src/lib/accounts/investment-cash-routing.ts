import type {
  ManualAccount,
  ManualAccountCashRoute,
} from '@/lib/accounts/manual-accounts-store';
import type { AssetClass } from '@/lib/config/supported-assets';

export interface InvestmentCashRouteResult {
  venue: string;
  label: string;
  route: ManualAccountCashRoute;
  account: ManualAccount;
  isFallback: boolean;
}

export function getCashRouteForAssetClass(assetClass: AssetClass | 'cash'): ManualAccountCashRoute | null {
  if (assetClass === 'cash') return null;
  return assetClass;
}

export function getInvestmentCashAccounts(manualAccounts: ManualAccount[]) {
  return manualAccounts.filter(
    (account) =>
      !account.archivedAt &&
      account.kind === 'Bank Account' &&
      account.cashCategory === 'investment_cash',
  );
}

export function resolveInvestmentCashRoute(
  manualAccounts: ManualAccount[],
  assetClass: AssetClass | 'cash',
): InvestmentCashRouteResult | null {
  const route = getCashRouteForAssetClass(assetClass);
  if (!route) return null;

  const investmentCashAccounts = getInvestmentCashAccounts(manualAccounts);
  const exactMatch = investmentCashAccounts.find((account) => account.cashRoutes?.includes(route));
  const fallback = investmentCashAccounts[0];
  const account = exactMatch ?? fallback;

  if (!account) return null;

  return {
    venue: account.venue,
    label: account.label,
    route,
    account,
    isFallback: !exactMatch,
  };
}

export function formatCashRouteLabel(route: ManualAccountCashRoute) {
  if (route === 'stock' || route === 'etf') return 'Aktien/ETF';
  if (route === 'crypto') return 'Krypto';
  return 'Gold/Metalle';
}
