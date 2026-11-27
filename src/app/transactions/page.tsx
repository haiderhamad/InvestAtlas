'use client';

import AppShell from '@/components/layout/app-shell';
import {
  getAllManualAccounts,
  MANUAL_ACCOUNTS_EVENT,
} from '@/lib/accounts/manual-accounts-store';
import { getVenueMeta } from '@/lib/portfolio/account-overview';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import {
  ASSET_CLASS_BADGE_CLASSES,
  type AssetClass,
} from '@/lib/config/supported-assets';
import type { InvestmentTaxType, InvestmentTransactionType } from '@/lib/tax/investment-tax';
import GlobalAddModal from '@/components/layout/global-add-modal';
import { TradeEntryActions, useTradeEntry } from '@/components/layout/trade-entry-actions';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Activity,
  ArrowLeftRight,
  Download,
  Eraser,
  Filter,
  Pencil,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

type LedgerAssetClass = AssetClass | 'cash';
type TranslateFn = (text: string) => string;

const categoryLabel = (t: TranslateFn): Record<LedgerAssetClass, string> => ({
  crypto: t('Crypto'),
  stock: t('Stocks'),
  etf: t('ETFs'),
  metal: t('Metals'),
  cash: t('Cash'),
});

const transactionTypeLabel = (t: TranslateFn): Record<InvestmentTransactionType, string> => ({
  buy: t('Buy'),
  sell: t('Sell'),
  deposit: t('Deposit'),
  withdrawal: t('Withdrawal'),
  dividend: t('Dividend'),
  fee: t('Fee'),
  transfer: t('Transfer'),
  adjustment: t('Adjustment'),
});

const taxTypeLabel = (t: TranslateFn): Record<InvestmentTaxType, string> => ({
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

const BUILTIN_VENUE_OPTIONS = [
  { value: 'bitvavo', label: 'Bitvavo' },
  { value: 'gateio', label: 'Gate.io' },
  { value: 'ibkr', label: 'Interactive Brokers' },
  { value: 'trade-republic', label: 'Trade Republic' },
  { value: 'bullion-vault', label: 'BullionVault' },
] as const;

const getLedgerDateFormatter = (language: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});

const getLedgerTimeFormatter = (language: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: language !== 'de',
});

const formatLedgerDate = (value: string, language: string) => {
  const parsed = new Date(value);

  return {
    date: getLedgerDateFormatter(language).format(parsed),
    time: getLedgerTimeFormatter(language).format(parsed),
  };
};

const formatLedgerNumber = (value: number, language: string, maximumFractionDigits = 8) =>
  value.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });

const formatLedgerMoney = (value: number, language: string) =>
  value.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const getCurrencySymbol = (quote: string) => {
  switch (quote) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default: return quote;
  }
};

const formatLedgerCurrency = (value: number, quote: string, language: string) =>
  quote === 'EUR'
    ? `${formatLedgerMoney(value, language)}€`
    : `${getCurrencySymbol(quote)}${formatLedgerMoney(value, language)}`;

const getLedgerFeeValue = (transaction: AppTransaction) => {
  const feeValue = transaction.type === 'fee' ? transaction.total : transaction.fee;
  return feeValue > 0 ? feeValue : null;
};

const escapeCsvCell = (value: string | number) => {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

export default function TransactionsPage() {
  const { t, language } = useAppTranslation();
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ReturnType<typeof getAllManualAccounts>>([]);
  const [filterType, setFilterType] = useState('all');
  const [filterVenue, setFilterVenue] = useState('all');
  const [filterClass, setFilterClass] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [editingTransaction, setEditingTransaction] = useState<AppTransaction | null>(null);
  const [mounted, setMounted] = useState(false);
  const tradeEntry = useTradeEntry();

  useEffect(() => {
    setEditingTransaction(null);
  }, [tradeEntry.workspace]);

  useEffect(() => {
    setMounted(true);
    setTransactions(getAllTransactions());
    setManualAccounts(getAllManualAccounts());
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

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
    window.addEventListener('storage', syncTransactions);
    window.addEventListener('storage', syncManualAccounts);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncManualAccounts);
      window.removeEventListener('storage', syncTransactions);
      window.removeEventListener('storage', syncManualAccounts);
    };
  }, []);

  const venueOptions = useMemo(() => {
    const byValue = new Map<string, { value: string; label: string; kind: string }>();

    for (const venue of BUILTIN_VENUE_OPTIONS) {
      byValue.set(venue.value, {
        value: venue.value,
        label: venue.label,
        kind: getVenueMeta(venue.value, manualAccounts).kind,
      });
    }

    for (const account of manualAccounts) {
      byValue.set(account.venue, {
        value: account.venue,
        label: account.label,
        kind: account.kind,
      });
    }

    for (const transaction of transactions) {
      if (!byValue.has(transaction.venue)) {
        const venueMeta = getVenueMeta(transaction.venue, manualAccounts);
        byValue.set(transaction.venue, {
          value: transaction.venue,
          label: venueMeta.label,
          kind: venueMeta.kind,
        });
      }
    }

    return [...byValue.values()];
  }, [manualAccounts, transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((transaction) => {
      if (filterType !== 'all' && transaction.type !== filterType) return false;
      if (filterVenue !== 'all' && transaction.venue !== filterVenue) return false;
      if (filterClass !== 'all' && transaction.assetClass !== filterClass) return false;
      if (filterSource !== 'all' && transaction.source !== filterSource) return false;
      return true;
    });
  }, [filterClass, filterSource, filterType, filterVenue, transactions]);

  const availableRealVenues = useMemo(
    () =>
      venueOptions.filter(
        (option) =>
          manualAccounts.some((account) => account.venue === option.value) ||
          transactions.some((transaction) => transaction.venue === option.value),
      ),
    [manualAccounts, transactions, venueOptions],
  );

  const manualCount = transactions.filter((transaction) => transaction.source === 'manual').length;

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      return;
    }

    const rows = [
      [t('Date'), t('Venue'), t('Source'), t('Type'), t('Category'), t('Asset'), t('Asset Name'), t('Amount'), t('Price'), t('Quote'), t('Total'), t('Fee'), t('Tax Type'), t('Notes')],
      ...filtered.map((transaction) => [
        transaction.date,
        getVenueMeta(transaction.venue, manualAccounts).label,
        transaction.source,
        transactionTypeLabel(t)[transaction.type],
        categoryLabel(t)[transaction.assetClass],
        transaction.asset,
        transaction.assetName ?? '',
        transaction.amount,
        transaction.price,
        transaction.quote,
        transaction.total,
        transaction.fee,
        taxTypeLabel(t)[transaction.taxType],
        transaction.notes ?? '',
      ]),
    ];

    const csv = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  if (!mounted) {
    return (
      <AppShell>
        <div className="page-header">
          <div className="page-header-row">
            <div className="page-header-main">
              <h1 className="page-title">
                <ArrowLeftRight size={24} style={{ display: 'inline', marginRight: 8 }} />
                {t('Transactions')}
              </h1>
            </div>
          </div>
        </div>
        <div className="page-content" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <ArrowLeftRight size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Transactions')}
            </h1>
          </div>
          <div className="page-header-actions">
            {tradeEntry.canEdit && <TradeEntryActions launchTrade={tradeEntry.launchTrade} />}
            {tradeEntry.isDemo && <span className="status-pill neutral">{t('Demo snapshot is read-only.')}</span>}
            <button className="btn btn-secondary btn-sm mobile-app-secondary" onClick={handleExportCsv}>
              <Download size={14} /> {t('Export')}
            </button>
          </div>
        </div>
      </div>

      <div className="page-content animate-in">
        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Ledger Filters')}</div>
              <div className="panel-subtitle">
                {t('Review the transaction book by type, venue, category, and origin.')}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div className="grid-2">
              <div>
                <label className="label">
                  <Filter size={12} style={{ display: 'inline' }} /> {t('Type')}
                </label>
                <select className="select" value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                  <option value="all">{t('All Types')}</option>
                  {Object.entries(transactionTypeLabel(t)).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('Category')}</label>
                <select className="select" value={filterClass} onChange={(event) => setFilterClass(event.target.value)}>
                  <option value="all">{t('All Categories')}</option>
                  <option value="crypto">{t('Crypto')}</option>
                  <option value="stock">{t('Stocks')}</option>
                  <option value="etf">{t('ETFs')}</option>
                  <option value="metal">{t('Metals')}</option>
                  <option value="cash">{t('Cash')}</option>
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label className="label">{t('Account')}</label>
                <select className="select" value={filterVenue} onChange={(event) => setFilterVenue(event.target.value)}>
                  <option value="all">{t('All Venues')}</option>
                  {availableRealVenues.map((venue) => (
                    <option key={venue.value} value={venue.value}>
                      {venue.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('Source')}</label>
                <select className="select" value={filterSource} onChange={(event) => setFilterSource(event.target.value)}>
                  <option value="all">{t('All Sources')}</option>
                  <option value="demo">{t('Demo Seed')}</option>
                  <option value="manual">{t('Manual')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="card desktop-only" style={{ padding: 0 }}>
          <div className="table-toolbar">
            <div>
              <div className="section-title">{t('Ledger Detail')}</div>
              <div className="panel-subtitle">
                {t('Demo and manual entries stay in one view, with manual rows removable individually.')}
              </div>
            </div>
            {mounted && <span className="badge badge-teal">{filtered.length} {t('rows')}</span>}
          </div>

          <div className="table-container" style={{ border: 'none' }}>
            <table className="ledger-table ledger-transactions-table">

              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Category')}</th>
                  <th>{t('Account')}</th>
                  <th>{t('Asset')}</th>
                  <th>{t('Price & Amount')}</th>
                  <th>{t('Fees')}</th>
                  <th>{t('Total')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '64px 0' }}>
                      <EmptyState
                        icon={Activity}
                        title={t('No transactions found')}
                        description={t('Adjust your filters or add a new entry to see your ledger activity here.')}
                        className="border-none bg-transparent"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((transaction) => {
                    const formattedDate = formatLedgerDate(transaction.date, language);
                    const venueLabel = getVenueMeta(transaction.venue, manualAccounts).label;
                    const feeValue = getLedgerFeeValue(transaction);

                    return (
                      <tr key={transaction.id}>
                        <td className="mono ledger-cell-date">
                          <span className="ledger-date-primary">{formattedDate.date}</span>
                          <span className="ledger-date-secondary">{formattedDate.time}</span>
                        </td>
                        <td>
                          <span
                            className={`badge ledger-badge ${
                              transaction.type === 'buy'
                                ? 'badge-green'
                                : transaction.type === 'sell'
                                ? 'badge-red'
                                : 'badge-teal'
                            }`}
                          >
                            {transactionTypeLabel(t)[transaction.type]}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ledger-badge ${
                              transaction.assetClass === 'cash'
                                ? 'badge-green'
                                : ASSET_CLASS_BADGE_CLASSES[transaction.assetClass]
                            }`}
                            style={{ maxWidth: 'none', textOverflow: 'unset' }}
                          >
                            {categoryLabel(t)[transaction.assetClass]}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-blue ledger-badge ledger-account-badge" title={venueLabel}>
                            {venueLabel}
                          </span>
                        </td>
                        <td className="ledger-cell-asset">
                          <span className="ledger-asset-symbol">{transaction.asset}</span>
                          {transaction.assetName && (
                            <div className="ledger-asset-name" title={transaction.assetName}>
                              {transaction.assetName}
                            </div>
                          )}
                        </td>
                        <td className="mono ledger-cell-money">
                          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {formatLedgerCurrency(transaction.price, transaction.quote, language)}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {formatLedgerNumber(transaction.amount, language)}
                          </div>
                        </td>
                        <td className="mono ledger-cell-money ledger-cell-fee">
                          {feeValue === null ? (
                            <span className="ledger-money-quote">—</span>
                          ) : (
                            <span className="ledger-money-value">
                              {formatLedgerCurrency(feeValue, transaction.quote, language)}
                            </span>
                          )}
                        </td>
                        <td className="mono ledger-cell-money ledger-cell-money-strong">
                          <span className="ledger-money-value">
                            {formatLedgerCurrency(transaction.total, transaction.quote, language)}
                          </span>
                        </td>
                        <td className="ledger-action-cell">
                          {tradeEntry.canEdit && transaction.source === 'manual' ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setEditingTransaction(transaction)}
                                title={t('Edit')}
                              >
                                <Pencil size={13} />
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-faint)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mobile-card-list">
          {filtered.length === 0 ? (
            <div className="card" style={{ padding: '32px 16px', textAlign: 'center' }}>
              <EmptyState
                icon={Activity}
                title={t('No transactions found')}
                description={t('Adjust your filters or add a new entry to see your ledger activity here.')}
                className="border-none bg-transparent"
              />
            </div>
          ) : (
            filtered.map((transaction) => {
              const formattedDate = formatLedgerDate(transaction.date, language);
              const venueLabel = getVenueMeta(transaction.venue, manualAccounts).label;
              const feeValue = getLedgerFeeValue(transaction);

              return (
                <div key={transaction.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="ledger-date-primary" style={{ fontWeight: 600 }}>{formattedDate.date}</span>
                      <span className="ledger-date-secondary" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formattedDate.time}</span>
                    </div>
                    <span
                      className={`badge ledger-badge ${
                        transaction.type === 'buy'
                          ? 'badge-green'
                          : transaction.type === 'sell'
                          ? 'badge-red'
                          : 'badge-teal'
                      }`}
                    >
                      {transactionTypeLabel(t)[transaction.type]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{transaction.asset}</div>
                      {transaction.assetName && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{transaction.assetName}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>{formatLedgerCurrency(transaction.total, transaction.quote, language)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatLedgerNumber(transaction.amount, language)} @ {formatLedgerCurrency(transaction.price, transaction.quote, language)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span className="badge badge-blue">{venueLabel}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {feeValue !== null && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {t('Fee')}: {formatLedgerCurrency(feeValue, transaction.quote, language)}
                        </span>
                      )}
                      {tradeEntry.canEdit && transaction.source === 'manual' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingTransaction(transaction)}
                          title={t('Edit')}
                          style={{ padding: '4px 8px' }}
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {tradeEntry.dialog}
      {tradeEntry.canEdit && editingTransaction && (
        <GlobalAddModal
          onClose={() => setEditingTransaction(null)}
          editTransaction={editingTransaction}
        />
      )}
    </AppShell>
  );
}
