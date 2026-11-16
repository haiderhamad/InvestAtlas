'use client';

import AppShell from '@/components/layout/app-shell';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import {
  ASSET_CLASS_LABELS,
  ASSET_CLASS_ORDER,
  ASSET_CLASS_OPTIONS,
  isCapitalIncomeAssetClass,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  calculateInvestmentTaxOverview,
  type CategoryTaxSummary,
  type RegimeTaxSummary,
  type YearlyTaxOverview,
} from '@/lib/tax/investment-tax';
import {
  DEFAULT_TAX_PROFILE_SETTINGS,
  type EffectiveTaxProfile,
  getEffectiveTaxProfile,
  getTaxProfileSummaryLabel,
  type TaxProfileSettings,
} from '@/lib/tax/tax-profile';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_EVENT,
  writeTaxProfileSettings,
} from '@/lib/tax/tax-profile-store';
import { calculatePurification } from '@/lib/tax/purification';
import {
  DEFAULT_PURIFICATION_SETTINGS,
  PURIFICATION_SETTINGS_EVENT,
  readPurificationSettings,
  type PurificationSettings,
} from '@/lib/purification/purification-store';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Coins,
  Droplet,
  ExternalLink,
  HelpCircle,
  Info,
  Landmark,
  Settings,
  ShieldCheck,
  LayoutGrid,
  TrendingUp,
  UserRound,
  Receipt,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import PurificationPanel from '@/components/settings/purification-panel';
import TaxProfileSettingsComp from '@/components/settings/tax-profile-settings';
import SalesLedger from '@/components/tax/sales-ledger';

type TaxTab = 'overview' | 'purification' | 'profile';

const PERSONAL_TAX_OPTIONS = [
  { label: '25%', value: 0.25 },
  { label: '32%', value: 0.32 },
  { label: '42%', value: 0.42 },
];

function buildEmptyRegimeSummary(
  regime: RegimeTaxSummary['regime'],
  label: string,
  allowance: number,
): RegimeTaxSummary {
  return {
    regime,
    label,
    allowance,
    allowanceRemaining: allowance,
    taxFreeCapacity: allowance,
    taxablePositiveGains: 0,
    taxableLosses: 0,
    netBeforeAllowance: 0,
    lossOffsetApplied: 0,
    lossCarryforwardPotential: 0,
    taxableBase: 0,
    estimatedTax: 0,
  };
}

function buildEmptyYearlyTaxOverview(
  year: number,
  taxProfile: EffectiveTaxProfile,
): YearlyTaxOverview {
  const categories: CategoryTaxSummary[] = ASSET_CLASS_ORDER.map((assetClass) => ({
    assetClass,
    label: ASSET_CLASS_LABELS[assetClass],
    regime: isCapitalIncomeAssetClass(assetClass) ? 'capital_income' : 'private_sale',
    realizedNet: 0,
    taxFreeGains: 0,
    taxablePositiveGains: 0,
    taxableLosses: 0,
    netTaxableBeforeAllowance: 0,
    allowanceApplied: 0,
    taxableBase: 0,
    estimatedTax: 0,
    effectiveTaxRate: isCapitalIncomeAssetClass(assetClass)
      ? taxProfile.capitalIncomeTaxRate
      : taxProfile.personalIncomeTaxRate,
  }));

  return {
    year,
    categories,
    privateSale: buildEmptyRegimeSummary('private_sale', 'Private Sales Pool', taxProfile.privateSaleAllowance),
    capitalIncome: buildEmptyRegimeSummary('capital_income', 'Capital Income Pool', taxProfile.capitalIncomeAllowance),
    totalEstimatedTax: 0,
  };
}

function TaxPageContent() {
  const { t, language } = useAppTranslation();
  const { formatMoney: formatDisplayMoney } = useDisplayCurrencyPreference();
  const formatMoney = (value: number) => formatDisplayMoney(value, 0, 2);
  const formatPurificationValue = (value: number | null) =>
    value === null ? t('Unavailable — insufficient data') : formatMoney(value);
  
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TaxTab) ?? 'overview';
  
  const [activeTab, setActiveTab] = useState<TaxTab>(initialTab);

  useEffect(() => {
    const tab = searchParams.get('tab') as TaxTab;
    if (tab && (tab === 'overview' || tab === 'purification' || tab === 'profile')) {
      setActiveTab(tab);
    }
  }, [searchParams]);
  const [hideDemoData, setHideDemoData] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [assetClassFilter, setAssetClassFilter] = useState<'all' | AssetClass>('all');
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [purificationSettings, setPurificationSettings] = useState<PurificationSettings>(DEFAULT_PURIFICATION_SETTINGS);
  const [taxProfileSettings, setTaxProfileSettings] = useState<TaxProfileSettings>(DEFAULT_TAX_PROFILE_SETTINGS);
  const [ioMessage, setIoMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const handleUpdateProfile = (next: TaxProfileSettings) => {
    writeTaxProfileSettings(next);
    setTaxProfileSettings(next);
  };

  useEffect(() => {
    let allTx = getAllTransactions();
    if (hideDemoData) {
      allTx = allTx.filter(tx => tx.source !== 'demo');
    }
    setTransactions(allTx);
  }, [hideDemoData]);

  useEffect(() => {
    setMounted(true);
    setTransactions(getAllTransactions());
    setPurificationSettings(readPurificationSettings());
    setTaxProfileSettings(readTaxProfileSettings());

    const syncTransactions = () => {
      setTransactions(getAllTransactions());
    };
    const syncPurification = () => {
      setPurificationSettings(readPurificationSettings());
    };
    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener(PURIFICATION_SETTINGS_EVENT, syncPurification as EventListener);
    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncPurification);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener(PURIFICATION_SETTINGS_EVENT, syncPurification as EventListener);
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncPurification);
      window.removeEventListener('storage', syncTaxProfile);
    };
  }, []);

  const activeTaxProfile = useMemo(
    () => getEffectiveTaxProfile(taxProfileSettings, selectedYear),
    [taxProfileSettings, selectedYear],
  );
  const overview = useMemo(
    () => calculateInvestmentTaxOverview(transactions, taxProfileSettings),
    [taxProfileSettings, transactions],
  );
  const taxYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const dataYears = overview.yearly.map((entry) => entry.year);
    const rangeYears = Array.from({ length: 6 }, (_, i) => currentYear - 3 + i);
    const allYears = Array.from(new Set([...dataYears, ...rangeYears]));
    return allYears.sort((a, b) => b - a);
  }, [overview.yearly]);
  const purification = useMemo(
    () => calculatePurification(transactions, purificationSettings, selectedYear),
    [purificationSettings, selectedYear, transactions],
  );
  const selectedYearSummary = useMemo(
    () =>
      overview.yearly.find((entry) => entry.year === selectedYear) ??
      buildEmptyYearlyTaxOverview(selectedYear, activeTaxProfile),
    [activeTaxProfile, overview.yearly, selectedYear],
  );
  const filteredOpenLots = overview.openLots.filter((lot) =>
    assetClassFilter === 'all' ? true : lot.assetClass === assetClassFilter,
  );
  const taxFreeOpenLots = filteredOpenLots.filter((lot) => lot.isTaxFreeIfSoldToday).length;
  const stillTaxableOpenLots = filteredOpenLots.length - taxFreeOpenLots;
  const cryptoCategory = selectedYearSummary?.categories.find((category) => category.assetClass === 'crypto');
  const stockCategory = selectedYearSummary?.categories.find((category) => category.assetClass === 'stock');
  const etfCategory = selectedYearSummary?.categories.find((category) => category.assetClass === 'etf');
  const metalCategory = selectedYearSummary?.categories.find((category) => category.assetClass === 'metal');
  const taxableLedgerEvents = transactions.filter(
    (transaction) => transaction.type === 'buy' || transaction.type === 'sell',
  ).length;
  const taxProfileSummary = getTaxProfileSummaryLabel(taxProfileSettings);
  const isGermanyPreset = taxProfileSettings.mode === 'preset';
  const selectedYearTaxableBase =
    selectedYearSummary.capitalIncome.taxableBase + selectedYearSummary.privateSale.taxableBase;
  const selectedYearTaxFreeRoom =
    selectedYearSummary.capitalIncome.allowanceRemaining + 
    selectedYearSummary.capitalIncome.lossCarryforwardPotential +
    selectedYearSummary.privateSale.allowanceRemaining +
    selectedYearSummary.privateSale.lossCarryforwardPotential;
  const privateSaleLossOffset = selectedYearSummary.privateSale.lossOffsetApplied;
  const privateSalePotentialLossCarryforward = selectedYearSummary.privateSale.lossCarryforwardPotential;
  const privateSalePositiveNet = Math.max(0, selectedYearSummary.privateSale.netBeforeAllowance);
  const capitalIncomePositiveNet = Math.max(0, selectedYearSummary.capitalIncome.netBeforeAllowance);
  const privateSaleAllowanceIsThreshold =
    activeTaxProfile.privateSaleAllowanceMode === 'all_or_nothing';
  const privateSaleThresholdExceeded =
    privateSaleAllowanceIsThreshold && privateSalePositiveNet > activeTaxProfile.privateSaleAllowance;
  const taxCalculationAvailable = overview.calculationStatus === 'calculated';
  const taxUnavailableCopy =
    overview.calculationStatus === 'invalid_ledger'
      ? t('The transaction ledger is inconsistent. Correct oversells, sale-before-buy entries, or missing acquisition records before calculating tax.')
      : t('A reliable historical FX conversion is required before non-EUR transactions can be included.');
  const taxAction = !taxCalculationAvailable
    ? {
        tone: 'warn',
        title: t('Tax estimate unavailable'),
        copy: taxUnavailableCopy,
      }
    : activeTaxProfile.needsUserConfirmation
    ? {
        tone: 'warn',
        title: t('Confirm profile first'),
        copy: t('The AI-assisted tax profile must be checked before you rely on this estimate.'),
      }
    : selectedYearSummary.totalEstimatedTax > 0
    ? {
        tone: 'warn',
        title: t('Review before filing'),
        copy: t('There is estimated tax for this year. Verify transactions, rates, and allowances first.'),
      }
    : {
        tone: 'success',
        title: t('No tax due in estimate'),
        copy: t('Based on current entries, this year has no estimated tax. Still verify missing sales or dividends.'),
      };
  const updateActivePersonalTaxRate = (nextRate: number) => {
    if (taxProfileSettings.mode === 'preset') {
      writeTaxProfileSettings({
        ...taxProfileSettings,
        presetPersonalIncomeTaxRatePct: Math.round(nextRate * 100),
      });
      return;
    }

    if (taxProfileSettings.mode === 'manual') {
      writeTaxProfileSettings({
        ...taxProfileSettings,
        manual: {
          ...taxProfileSettings.manual,
          personalIncomeTaxRatePct: Math.round(nextRate * 100),
        },
      });
      return;
    }

    writeTaxProfileSettings({
      ...taxProfileSettings,
      aiAssisted: {
        ...taxProfileSettings.aiAssisted,
        personalIncomeTaxRatePct: Math.round(nextRate * 100),
      },
    });
  };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <Receipt size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Tax & Purification')}
            </h1>
          </div>
        </div>

        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <LayoutGrid size={14} />
            <span>{t('Overview')}</span>
          </button>
          <button 
            className={`tab ${activeTab === 'purification' ? 'active' : ''}`}
            onClick={() => setActiveTab('purification')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Droplet size={14} />
            <span>{t('Purification Settings')}</span>
          </button>
          <button 
            className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <UserRound size={14} />
            <span>{t('Tax Profile')}</span>
          </button>
        </div>
      </div>

      <div className="page-content animate-in">
        {!mounted ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 100 }}>
            <div className="loading-spin" style={{ opacity: 0.5 }}>
              <LayoutGrid size={32} />
            </div>
          </div>
        ) : (
          <>
            {ioMessage && (
              <div className="login-alert success" style={{ marginBottom: 16 }}>
                <ShieldCheck size={16} />
                <span>{ioMessage}</span>
              </div>
            )}

        {activeTab === 'purification' && (
          <div className="animate-in">
            <PurificationPanel />
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="animate-in">
            <TaxProfileSettingsComp 
              settings={taxProfileSettings}
              onUpdate={handleUpdateProfile}
              ioMessage={ioMessage}
            />
          </div>
        )}

        {activeTab === 'overview' && !taxCalculationAvailable && (
          <div className="callout warn">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>{t('Tax estimate unavailable')}</strong>
              <div style={{ marginTop: 4 }}>
                {taxUnavailableCopy}
                {overview.calculationStatus === 'insufficient_fx_data' && (
                  <>
                    {' '}
                    {t('Missing FX quotes')}: {overview.missingFxQuotes.join(', ')}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'overview' && taxCalculationAvailable && (
          <>
            <div className="card tax-command-center">
            <div className="tax-snapshot-top">
              <div className="tax-snapshot-header">
                <div className="tax-snapshot-title-group">
                  <div className="section-title">{t('Tax snapshot')}</div>
                  <div className="panel-subtitle">{t(`Estimate for ${selectedYear}. Review the profile before filing.`)}</div>
                </div>

                <div className={`tax-status-pill ${taxAction.tone}`}>
                  <AlertTriangle size={15} />
                  <div>
                    <strong>{taxAction.title}</strong>
                    <span>{taxAction.copy}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="tax-snapshot-controls">
              <div className="tax-control-group">
                <label className="tax-control-field tax-year-field">
                  <span className="tax-control-label">
                    <Calendar size={13} />
                    {t('Tax year')}
                  </span>
                  <div className="tax-select-shell">
                    <select
                      className="select tax-year-select"
                      value={selectedYear}
                      onChange={(event) => setSelectedYear(Number(event.target.value))}
                    >
                      {taxYearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year === new Date().getFullYear() ? `${year} (${t('current')})` : year}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <div className="tax-control-field tax-control-rate">
                  <span className="tax-control-label">
                    <TrendingUp size={13} />
                    {t('Private-sale tax rate')}
                  </span>
                  <div className="tax-rate-row">
                    {PERSONAL_TAX_OPTIONS.map((option) => (
                      <button
                        key={option.label}
                        className={`btn tax-rate-button ${Math.abs(activeTaxProfile.personalIncomeTaxRate - option.value) < 0.0001 ? 'is-active' : ''}`}
                        onClick={() => updateActivePersonalTaxRate(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setActiveTab('profile')}
                className="btn btn-secondary tax-profile-link"
                style={{ cursor: 'pointer', border: 'none' }}
              >
                <Settings size={15} /> 
                <div style={{ textAlign: 'left' }}>
                  <strong>{t('Edit profile')}</strong>
                  <span style={{ fontSize: 10, display: 'block', opacity: 0.6, marginTop: 2 }}>{t('Adjust limits & residency')}</span>
                </div>
              </button>
            </div>

            <div className="tax-profile-strip">
              <span>
                <ShieldCheck size={14} />
                <strong>{t(taxProfileSummary)}</strong>
              </span>
              <span>{t(activeTaxProfile.sourceLabel)}</span>
              <span>
                {taxableLedgerEvents} {t('buys/sells tracked')}
              </span>
              <span>{t('Estimate only')}</span>
            </div>
            </div>
            <div className="callout info" style={{ marginTop: 16, marginBottom: 16 }}>
              <Info size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>{t('Understanding the two tax "pots":')}</strong>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, lineHeight: 1.5 }}>
                  <p>
                    {t('1. Securities (Stocks & ETFs): Real allowance (Freibetrag) of 1,000€. Only the amount above this limit is taxed. No tax-free holding period.')}
                  </p>
                  <p style={{ marginTop: 4 }}>
                    {t('2. Other Assets (Crypto & Gold): Exemption limit (Freigrenze) of 1,000€. If exceeded, the whole amount is taxed. Tax-free after 1 year holding duration.')}
                  </p>
                </div>
              </div>
            </div>

            <div className="tax-regime-map">
          <div className="tax-regime-card tax-regime-private">
            <div className="tax-regime-head">
              <div className="tax-regime-icon">
                <Coins size={18} />
              </div>
              <div>
                <h2>{t('Crypto & Metals')}</h2>
                <p>{t('Short-term private sales are checked separately from stocks and ETFs. After 1 year, these are tax-free.')}</p>
              </div>
            </div>

            <div className="tax-rule-chips">
              <span>{privateSaleAllowanceIsThreshold ? t('Freigrenze, not Freibetrag') : t('Allowance exemption')}</span>
              <span>
                {activeTaxProfile.privateSaleHoldingPeriodDays > 0
                  ? `${t('Holding period')} > ${activeTaxProfile.privateSaleHoldingPeriodDays} ${t('days')}`
                  : t('No holding-period rule')}
              </span>
              <span>{t('Personal tax rate')}</span>
            </div>

            <div className="tax-regime-metrics">
              <div>
                <span>{t('Short-term gains')}</span>
                <strong>{formatMoney(selectedYearSummary.privateSale.taxablePositiveGains)}</strong>
              </div>
              <div>
                <span>{t('Loss offset')}</span>
                <strong>{formatMoney(selectedYearSummary.privateSale.lossOffsetApplied)}</strong>
              </div>
              <div>
                <span>{t('Net before threshold')}</span>
                <strong>{formatMoney(privateSalePositiveNet)}</strong>
              </div>
              <div>
                <span>{t('Est. tax')}</span>
                <strong>{formatMoney(selectedYearSummary.privateSale.estimatedTax)}</strong>
              </div>
            </div>

            <div className={`tax-regime-note ${privateSaleThresholdExceeded ? 'warn' : 'success'}`}>
              <strong>
                {privateSaleThresholdExceeded
                  ? t('Freigrenze exceeded')
                  : t('Inside the private-sale limit')}
              </strong>
              <span>
                {privateSaleThresholdExceeded
                  ? t('Because this is a Freigrenze, the full net gain is taxable once the limit is exceeded.')
                  : t('Losses reduce gains in this bucket first; unused losses are tracked separately from the Freigrenze.')}
              </span>
            </div>
          </div>

          <div className="tax-regime-card tax-regime-capital">
            <div className="tax-regime-head">
              <div className="tax-regime-icon">
                <Landmark size={18} />
              </div>
              <div>
                <h2>{t('Stocks & ETFs')}</h2>
                <p>{t('Here the Sparerpauschbetrag applies (real allowance). There is no tax-free holding period.')}</p>
              </div>
            </div>

            <div className="tax-rule-chips">
              <span>{t('Sparer-Pauschbetrag')}</span>
              <span>{formatMoney(activeTaxProfile.capitalIncomeAllowance)}</span>
              <span>{t('No 1-year rule')}</span>
            </div>

            <div className="tax-regime-metrics">
              <div>
                <span>{t('Taxable gains')}</span>
                <strong>{formatMoney(selectedYearSummary.capitalIncome.taxablePositiveGains)}</strong>
              </div>
              <div>
                <span>{t('Loss offset')}</span>
                <strong>{formatMoney(selectedYearSummary.capitalIncome.lossOffsetApplied)}</strong>
              </div>
              <div>
                <span>{t('Allowance left')}</span>
                <strong>{formatMoney(selectedYearSummary.capitalIncome.allowanceRemaining)}</strong>
              </div>
              <div>
                <span>{t('Taxable base')}</span>
                <strong>{formatMoney(selectedYearSummary.capitalIncome.taxableBase)}</strong>
              </div>
            </div>

            <div className="tax-regime-note info">
              <strong>{t('Separate from crypto')}</strong>
              <span>{t('Capital-income losses do not fill the crypto Freigrenze, and crypto losses do not reduce this allowance.')}</span>
            </div>
          </div>

        </div>

        <div className="tax-loss-explainer">
          <Info size={18} />
          <div>
            <strong>{t('How crypto losses are handled')}</strong>
            <span>
              {t('A short-term crypto loss does not increase the Freigrenze. It first offsets gains inside the private-sale bucket; any remaining loss is shown as a potential private-sale loss carryforward.')}
            </span>
          </div>
          <div className="tax-loss-explainer-metrics">
            <div>
              <span>{t('Offset this year')}</span>
              <strong>{formatMoney(privateSaleLossOffset)}</strong>
            </div>
            <div>
              <span>{t('Potential carryforward')}</span>
              <strong>{formatMoney(privateSalePotentialLossCarryforward)}</strong>
            </div>
          </div>
        </div>

      {selectedYearSummary && (
          <>
            <div className="hero-grid">
              <div className="card hero-card">
                <div className="card-title">{t('Your estimated total tax')}</div>
                <div className="card-value">{formatMoney(selectedYearSummary.totalEstimatedTax)}</div>
                <div className="card-change" style={{ color: 'var(--text-secondary)' }}>
                  {t('Taxable base after allowances and loss offsets:')} {formatMoney(selectedYearTaxableBase)}
                </div>
              </div>

              <div className="card hero-card">
                <div className="card-title">
                  <Landmark size={14} style={{ display: 'inline', marginRight: 6 }} />
                  {t('Stocks & ETFs — taxable amount')}
                </div>
                <div className="card-value" style={{ fontSize: 26 }}>
                  {formatMoney(selectedYearSummary.capitalIncome.taxableBase)}
                </div>
                <div className="card-change" style={{ color: 'var(--text-secondary)' }}>
                  {t('Net capital income before allowance:')} {formatMoney(capitalIncomePositiveNet)}
                </div>
              </div>

              <div className="card hero-card">
                <div className="card-title">
                  <Coins size={14} style={{ display: 'inline', marginRight: 6 }} />
                  {t('Crypto & Metals — taxable amount')}
                </div>
                <div className="card-value" style={{ fontSize: 26 }}>
                  {formatMoney(selectedYearSummary.privateSale.taxableBase)}
                </div>
                <div className="card-change" style={{ color: 'var(--text-secondary)' }}>
                  {privateSaleAllowanceIsThreshold
                    ? t('Freigrenze logic: above the limit, the full net gain is taxable.')
                    : t('Allowance logic: only the amount above the allowance is taxable.')}
                </div>
              </div>

              <div className="card hero-card">
                <div className="card-title">
                  <BarChart3 size={14} style={{ display: 'inline', marginRight: 6 }} />
                  {t('Total tax-free capacity')}
                </div>
                <div className="card-value" style={{ fontSize: 26 }}>
                  {formatMoney(selectedYearTaxFreeRoom)}
                </div>
                <div className="card-change" style={{ color: 'var(--text-secondary)' }}>
                  {t('Losses are shown separately so they do not look like extra allowance.')}
                </div>
              </div>
            </div>

            <div className="tax-flow-stack">
              <div className="card tax-flow-card">
                <div className="panel-header tax-flow-header">
                  <div>
                    <div className="section-title">{t('Tax by asset type')}</div>
                    <div className="panel-subtitle">
                      {t('Read each card the same way: total profit first, then what is already safe, then what still creates tax.')}
                    </div>
                  </div>
                </div>

                <div className="tax-category-grid">
                  {selectedYearSummary.categories.map((category) => {
                    const usesCapitalIncomeRule = category.regime === 'capital_income';
                    const ruleLabel = usesCapitalIncomeRule
                      ? t('Capital-income rule')
                      : activeTaxProfile.privateSaleHoldingPeriodDays > 0
                      ? t('Private-sale holding rule')
                      : t('Private-sale rule');
                    const ruleCopy = usesCapitalIncomeRule
                      ? t('Losses are netted first, then the saver allowance is applied to the remaining capital income.')
                      : privateSaleAllowanceIsThreshold
                      ? t('Short-term gains and losses are netted first. If the net gain exceeds the Freigrenze, the full net gain is taxable.')
                      : t('Short-term gains and losses are netted first. Then the configured allowance is applied.');
                    const categoryHasOpenLoss = category.taxableLosses > category.taxablePositiveGains;

                    return (
                      <div key={category.assetClass} className="tax-category-card">
                        <div className="tax-category-top">
                          <div>
                            <strong>{t(category.label)}</strong>
                            <span>{ruleLabel}</span>
                          </div>
                          <span className={`badge ${category.estimatedTax > 0 ? 'badge-yellow' : categoryHasOpenLoss ? 'badge-blue' : 'badge-green'}`}>
                            {category.estimatedTax > 0
                              ? t('Creates tax')
                              : categoryHasOpenLoss
                              ? t('Loss available')
                              : t('No tax due')}
                          </span>
                        </div>

                        <p className="tax-category-copy">{ruleCopy}</p>

                        <div className="tax-category-metrics">
                          <div className="tax-category-metric">
                            <span>{t('Tax-window gains')}</span>
                            <strong>{formatMoney(category.taxablePositiveGains)}</strong>
                          </div>
                          <div className="tax-category-metric">
                            <span>{t('Tax-window losses')}</span>
                            <strong>{formatMoney(category.taxableLosses)}</strong>
                          </div>
                          <div className="tax-category-metric">
                            <span>{t('Net before allowance')}</span>
                            <strong>{formatMoney(category.netTaxableBeforeAllowance)}</strong>
                          </div>
                          <div className="tax-category-metric">
                            <span>{t('Tax-free by holding')}</span>
                            <strong>{formatMoney(category.taxFreeGains)}</strong>
                          </div>
                          <div className="tax-category-metric">
                            <span>{t('Taxable base')}</span>
                            <strong>{formatMoney(category.taxableBase)}</strong>
                          </div>
                          <div className="tax-category-metric">
                            <span>{t('Est. tax')}</span>
                            <strong>{formatMoney(category.estimatedTax)}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card tax-flow-card">
                <div className="panel-header tax-flow-header">
                  <div>
                    <div className="section-title">{t('Your two tax buckets')}</div>
                    <div className="panel-subtitle">
                      {t('Stocks and ETFs use one allowance bucket. Crypto and metals use the private-sale rules.')}
                    </div>
                  </div>
                </div>

                <div className="tax-bucket-grid">
                  <div className="tax-bucket-card">
                    <div className="tax-bucket-title">
                      <Landmark size={16} />
                      <div>
                        <strong>{t('Stocks & ETFs')}</strong>
                        <span>{t('Capital-income assets')}</span>
                      </div>
                    </div>
                    <p className="tax-bucket-copy">
                      {isGermanyPreset
                        ? t('This bucket nets capital gains and losses, uses the yearly saver allowance, then applies capital-income tax.')
                        : t('This bucket uses your configured annual allowance first, then applies capital-income tax.')}
                    </p>
                    <div className="summary-strip">
                      <div className="summary-item">
                        <span>{t('Net before allowance')}</span>
                        <strong>{formatMoney(selectedYearSummary.capitalIncome.netBeforeAllowance)}</strong>
                      </div>
                      <div className="summary-item">
                        <span>{t('Allowance')}</span>
                        <strong>{formatMoney(selectedYearSummary.capitalIncome.allowance)}</strong>
                      </div>
                      <div className="summary-item success">
                        <span>{t('Tax-free capacity')}</span>
                        <strong>{formatMoney(selectedYearSummary.capitalIncome.allowanceRemaining + selectedYearSummary.capitalIncome.lossCarryforwardPotential)}</strong>
                      </div>
                      <div className="summary-item">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t('Loss offset')}
                          <HelpCircle size={10} style={{ opacity: 0.5 }} aria-label={t('Losses from this year used to reduce taxable gains in this same category.')} />
                        </span>
                        <strong>{formatMoney(selectedYearSummary.capitalIncome.lossOffsetApplied)}</strong>
                      </div>
                      <div className="summary-item">
                        <span>{t('Est. tax')}</span>
                        <strong>{formatMoney(selectedYearSummary.capitalIncome.estimatedTax)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="tax-bucket-card">
                    <div className="tax-bucket-title">
                      <Coins size={16} />
                      <div>
                        <strong>{t('Crypto & Metals')}</strong>
                        <span>{t('Private-sale assets')}</span>
                      </div>
                    </div>
                    <p className="tax-bucket-copy">
                      {privateSaleAllowanceIsThreshold
                        ? t('This bucket uses a Freigrenze. Once the net gain is above the limit, the full net gain is taxable.')
                        : t('This bucket nets short-term private-sale gains and losses, then applies the configured allowance.')}
                    </p>
                    <div className="summary-strip">
                      <div className="summary-item">
                        <span>{t('Net before threshold')}</span>
                        <strong>{formatMoney(selectedYearSummary.privateSale.netBeforeAllowance)}</strong>
                      </div>
                      <div className="summary-item">
                        <span>{privateSaleAllowanceIsThreshold ? t('Freigrenze') : t('Allowance')}</span>
                        <strong>{formatMoney(selectedYearSummary.privateSale.allowance)}</strong>
                      </div>
                      <div className="summary-item success">
                        <span>{t('Tax-free capacity')}</span>
                        <strong>{formatMoney(selectedYearSummary.privateSale.allowanceRemaining + selectedYearSummary.privateSale.lossCarryforwardPotential)}</strong>
                      </div>
                      <div className="summary-item">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t('Potential carryforward')}
                          <HelpCircle size={10} style={{ opacity: 0.5 }} aria-label={t('Losses that exceed this years gains. You can "carry" these into future years to offset future profits.')} />
                        </span>
                        <strong>{formatMoney(selectedYearSummary.privateSale.lossCarryforwardPotential)}</strong>
                      </div>
                      <div className="summary-item">
                        <span>{t('Est. tax')}</span>
                        <strong>{formatMoney(selectedYearSummary.privateSale.estimatedTax)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card tax-flow-card">
                <div className="panel-header tax-flow-header">
                  <div>
                    <div className="section-title">{t('Sales history & impact')}</div>
                    <div className="panel-subtitle">
                      {t('Every sale is matched with its oldest corresponding buy (FIFO). Here you see exactly which trades created profit or loss.')}
                    </div>
                  </div>
                </div>
                <div style={{ padding: '0 16px 16px' }}>
                  <SalesLedger 
                    disposals={overview.disposals} 
                    selectedYear={selectedYear} 
                  />
                </div>
              </div>

              <div className="card tax-flow-card tax-open-lots-card" style={{ padding: 0 }}>
                <div className="table-toolbar tax-open-lots-toolbar">
                  <div>
                    <div className="section-title">{t('Positions you still hold')}</div>
                    <div className="panel-subtitle">
                      {t('If you plan to sell, start here. The status shows whether a sale today would likely be tax-free.')}
                    </div>
                  </div>
                  <div className="tax-open-lots-toolbar-side">
                    <label className="tax-control-field tax-open-lots-filter">
                      <span>{t('Asset type')}</span>
                      <select
                        className="select"
                        value={assetClassFilter}
                        onChange={(event) => setAssetClassFilter(event.target.value as typeof assetClassFilter)}
                      >
                        <option value="all">{t('All categories')}</option>
                        {ASSET_CLASS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="badge badge-blue">{t(`${filteredOpenLots.length} unsold positions`)}</span>
                  </div>
                </div>

                <div className="tax-open-lots-summary">
                  <div className="tax-open-lots-stat">
                    <span>{t('Open lots')}</span>
                    <strong>{filteredOpenLots.length}</strong>
                    <small>{t('Buys not fully sold yet')}</small>
                  </div>
                  <div className="tax-open-lots-stat success">
                    <span>{t('Tax-free today')}</span>
                    <strong>{taxFreeOpenLots}</strong>
                    <small>{t('Likely safe to sell now')}</small>
                  </div>
                  <div className="tax-open-lots-stat warn">
                    <span>{t('Still taxable')}</span>
                    <strong>{stillTaxableOpenLots}</strong>
                    <small>{t('Would still create tax today')}</small>
                  </div>
                </div>

                {filteredOpenLots.length === 0 ? (
                  <div style={{ padding: '0 18px 18px' }}>
                    <div className="empty-state">{t('No open positions match this filter right now.')}</div>
                  </div>
                ) : (
                  <>
                    <div className="table-container desktop-only" style={{ border: 'none', borderRadius: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>{t('Asset')}</th>
                            <th>{t('Type')}</th>
                            <th>{t('Buy date')}</th>
                            <th>{t('Amount')}</th>
                            <th>{t('Cost / unit')}</th>
                            <th>{t('Days held')}</th>
                            <th>{t('Tax status today')}</th>
                            <th>{t('Account')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOpenLots.map((lot) => (
                            <tr key={`${lot.asset}-${lot.acquisitionDate}-${lot.venue}`}>
                              <td style={{ fontWeight: 700 }}>{lot.asset}</td>
                              <td>{t(ASSET_CLASS_LABELS[lot.assetClass])}</td>
                              <td className="mono">{lot.acquisitionDate.slice(0, 10)}</td>
                              <td className="mono">{lot.remainingAmount}</td>
                              <td className="mono">{formatMoney(lot.costBasisPerUnit)}</td>
                              <td className="mono">{lot.holdingDays}</td>
                              <td>
                                <span className={`badge ${lot.isTaxFreeIfSoldToday ? 'badge-green' : 'badge-yellow'}`}>
                                  {isCapitalIncomeAssetClass(lot.assetClass)
                                    ? t('Always taxable')
                                    : lot.isTaxFreeIfSoldToday
                                    ? activeTaxProfile.privateSaleHoldingPeriodDays > 0
                                      ? t(`Tax-free (> ${activeTaxProfile.privateSaleHoldingPeriodDays}d)`)
                                      : t('Tax-free')
                                    : t('Still taxable')}
                                </span>
                              </td>
                              <td className="mono" style={{ fontSize: 12 }}>
                                {lot.venue}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mobile-only" style={{ padding: '0 16px 16px' }}>
                      <div className="mobile-card-list">
                        {filteredOpenLots.map((lot) => (
                          <div key={`${lot.asset}-${lot.acquisitionDate}-${lot.venue}-mobile`} className="mobile-data-card">
                            <div className="mobile-data-card-header">
                              <div>
                                <div className="mobile-data-title">{lot.asset}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                  {t(ASSET_CLASS_LABELS[lot.assetClass])} · {lot.venue}
                                </div>
                              </div>
                              <span className={`badge ${lot.isTaxFreeIfSoldToday ? 'badge-green' : 'badge-yellow'}`}>
                                {isCapitalIncomeAssetClass(lot.assetClass)
                                  ? t('Taxable')
                                  : lot.isTaxFreeIfSoldToday
                                  ? t('Tax-free')
                                  : t('Still taxable')}
                              </span>
                            </div>
                            <div className="mobile-data-grid">
                              <div className="mobile-data-row">
                                <span className="mobile-data-label">{t('Buy date')}</span>
                                <span className="mobile-data-value mono">{lot.acquisitionDate.slice(0, 10)}</span>
                              </div>
                              <div className="mobile-data-row">
                                <span className="mobile-data-label">{t('Held')}</span>
                                <span className="mobile-data-value mono">{t(`${lot.holdingDays} days`)}</span>
                              </div>
                              <div className="mobile-data-row">
                                <span className="mobile-data-label">{t('Amount')}</span>
                                <span className="mobile-data-value mono">{lot.remainingAmount}</span>
                              </div>
                              <div className="mobile-data-row">
                                <span className="mobile-data-label">{t('Cost / unit')}</span>
                                <span className="mobile-data-value mono">{formatMoney(lot.costBasisPerUnit)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>



            <div className="card mobile-app-secondary">
              <div className="panel-header">
                <div>
                  <div className="section-title">
                    <Droplet size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--accent-blue)' }} />
                    {t('Interest purification')}
                  </div>
                  <div className="panel-subtitle">
                    {t('This is an informational purification calculation under the configured methodology, not a religious ruling. It is separate from taxes and does not change the values above.')}
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('purification')}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Settings size={13} /> {t('Configure')}
                </button>
              </div>

              <div className="callout info" style={{ marginBottom: 16 }}>
                <ShieldCheck size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{t('In plain English:')}</strong> {t('even Shariah-screened ETFs & stocks hold a tiny amount of interest income you\'re supposed to give away. Some ETFs (Wahed, SP Funds) do this for you. For the others, this card tells you roughly how much to donate.')}
                  <a
                    href="https://halal-investieren.de/etf/einnahmen-bereinigen/"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-blue)' }}
                  >
                    {t('Read more')}
                    <ExternalLink size={11} style={{ display: 'inline', marginLeft: 3 }} />
                  </a>
                </div>
              </div>

              <div className="hero-grid" style={{ marginBottom: 16 }}>
                <div className="card" style={{ background: 'var(--bg-primary)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t('ETFs to purify')} · {selectedYear}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatPurificationValue(purification.etfTotalEur)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t(`${purification.etfRows.filter((row) => row.status !== 'self_purified').length} position(s) need manual action`)}
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--bg-primary)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    {t('Stocks to purify')} · {selectedYear}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatPurificationValue(purification.stocks.purificationEur)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t(`${purification.stocks.method === 'dividends' ? 'Dividends' : 'Holdings'} \u00d7 ${(purification.stocks.ratio * 100).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`)}
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--bg-primary)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t('Total purification')} · {selectedYear}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-blue)' }}>
                    {formatPurificationValue(purification.grandTotalEur)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('Suggested donation total')}</div>
                </div>
              </div>
              {purification.grandTotalEur === null && (
                <div className="callout warn" style={{ marginBottom: 16 }}>
                  {t('A precise purification total is unavailable because required evidence, cost basis, ledger integrity, or FX data is missing.')}
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('ETF breakdown')}</div>
                  {purification.etfRows.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                      {t(`No ETF holdings at end of ${selectedYear}.`)}
                    </div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('Symbol')}</th>
                          <th>{t('Name')}</th>
                          <th style={{ textAlign: 'center' }}>{t('Status')}</th>
                          <th style={{ textAlign: 'right' }}>{t('Shares held')}</th>
                          <th style={{ textAlign: 'right' }}>{t('Rate / share')}</th>
                          <th style={{ textAlign: 'right', paddingRight: 16 }}>{t('Purification')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purification.etfRows.map((row) => (
                          <tr key={row.symbol}>
                            <td className="mono" style={{ fontWeight: 700 }}>{row.symbol}</td>
                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.name}</td>
                            <td style={{ textAlign: 'center' }}>
                              {row.status === 'self_purified' ? (
                                <span className="badge badge-green">{t('Handled by issuer')}</span>
                              ) : row.status === 'calculated' ? (
                                <span className="badge badge-yellow">{t('You donate manually')}</span>
                              ) : (
                                <span className="badge badge-blue">{t('Insufficient data')}</span>
                              )}
                            </td>
                            <td className="mono" style={{ textAlign: 'right' }}>
                              {row.unitsHeld.toFixed(4)}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                              {row.status === 'self_purified' || !row.hasRate
                                ? '—'
                                : `${row.perSharePurificationNative?.toFixed(5)} ${row.nativeCurrency.toUpperCase()}`}
                            </td>
                            <td
                              className="mono"
                              style={{
                                textAlign: 'right',
                                paddingRight: 16,
                                fontWeight: 600,
                                color: (row.purificationEur ?? 0) > 0 ? 'var(--accent-blue)' : 'var(--text-muted)',
                              }}
                            >
                              {formatPurificationValue(row.purificationEur)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('Stocks summary')}</div>
                <div
                  className="card"
                  style={{ background: 'var(--bg-primary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('Method')}</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {purification.stocks.method === 'dividends'
                        ? t('Dividends received')
                        : t('Year-end holdings value')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {purification.stocks.method === 'dividends'
                        ? t('Dividends basis')
                        : t('Holdings basis')}
                    </div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                      {formatPurificationValue(purification.stocks.basisEur)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {t('Non-compliant share')}
                    </div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                      {(purification.stocks.ratio * 100).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {t('Stocks purification')}
                    </div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-blue)' }}>
                      {formatPurificationValue(purification.stocks.purificationEur)}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  {t('Change the method (dividends vs. holdings) or ratio in the')} <strong>{t('Purification Settings')}</strong> {t('tab above')}.
                </div>
              </div>
            </div>
          </>
        )}
      </>
    )}
  </>
)}
</div>
</AppShell>
  );
}

export default function TaxPage() {
  return (
    <Suspense>
      <TaxPageContent />
    </Suspense>
  );
}
