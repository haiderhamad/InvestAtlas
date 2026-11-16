'use client';

import Link from 'next/link';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { updateManualAccount } from '@/lib/accounts/manual-accounts-store';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
} from '@/lib/config/supported-assets';
import {
  formatActivityDate,
  type AccountGroupOverview,
} from '@/lib/portfolio/account-overview';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

export default function AccountGroupsList({
  groups,
  showAllAccounts = true,
  showAdvancedDetails = false,
  collapsible = false,
  collapsedGroups = [],
  onToggleGroup,
}: {
  groups: AccountGroupOverview[];
  showAllAccounts?: boolean;
  showAdvancedDetails?: boolean;
  collapsible?: boolean;
  collapsedGroups?: string[];
  onToggleGroup?: (groupKind: string) => void;
}) {
  const { formatMoney, formatSignedMoney } = useDisplayCurrencyPreference();
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';

  if (groups.length === 0) {
    return (
      <div className="dashboard-helper-text">
        {t('No accounts are visible yet. Add transactions first so the app can derive brokers, exchanges, and vaults.')}
      </div>
    );
  }

  return (
    <div className="account-group-list">
      {groups.map((group) => {
        const isCollapsed = collapsedGroups.includes(group.kind);
        const visibleAccounts = showAllAccounts ? group.accounts : group.accounts.slice(0, 1);
        const hiddenCount = Math.max(group.accounts.length - visibleAccounts.length, 0);

        return (
          <div key={group.kind} className="account-group-card">
            <div className="account-group-header">
              <div className="account-group-main">
                {collapsible ? (
                  <button
                    type="button"
                    className="account-group-trigger"
                    onClick={() => onToggleGroup?.(group.kind)}
                    aria-expanded={!isCollapsed}
                  >
                    <div className="account-group-top">
                      <div className="account-group-title">{t(group.label)}</div>
                      <span className="status-pill neutral">
                        <bdi dir="auto">{group.accounts.length.toLocaleString(numberLocale)}</bdi>{' '}
                        {t(group.accounts.length === 1 ? 'account' : 'accounts')}
                      </span>
                    </div>
                    <span className="account-group-toggle-icon">
                      {isCollapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
                    </span>
                  </button>
                ) : (
                  <div className="account-group-top">
                    <div className="account-group-title">{t(group.label)}</div>
                    <span className="status-pill neutral">
                      <bdi dir="auto">{group.accounts.length.toLocaleString(numberLocale)}</bdi>{' '}
                      {t(group.accounts.length === 1 ? 'account' : 'accounts')}
                    </span>
                  </div>
                )}

                <div className="account-group-meta">
                  <bdi dir="auto">{group.positions.toLocaleString(numberLocale)}</bdi> {t('positions')} ·{' '}
                  <bdi dir="auto">{group.transactionCount.toLocaleString(numberLocale)}</bdi> {t('ledger events')} ·{' '}
                  {group.valuationAvailable
                    ? `${group.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                    : t('Unavailable')}
                </div>
                {group.negativeCashValue < 0 ? (
                  <div className="callout warn" style={{ marginTop: 10, padding: '8px 10px', fontSize: 12 }}>
                    {t('Cash correction required')}: {formatMoney(group.negativeCashValue)}
                  </div>
                ) : null}

                <div className="account-tag-row">
                  <div className="account-symbols">
                    {group.topSymbols.map((symbol) => (
                      <span key={`${group.kind}-${symbol}`} className="account-symbol-chip">
                        <bdi dir="ltr">{symbol}</bdi>
                      </span>
                    ))}
                  </div>
                  <div className="account-mix">
                    {group.assetMix.map((assetClass) => (
                      <span
                        key={`${group.kind}-${assetClass}`}
                        className={`badge ${ASSET_CLASS_BADGE_CLASSES[assetClass]}`}
                      >
                        {t(ASSET_CLASS_LABELS[assetClass])}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="account-group-side">
                <div className="account-value mono">
                  {group.valuationAvailable ? formatMoney(group.value) : t('Unavailable')}
                </div>
                <div className={`account-delta ${group.financialMetricsAvailable && group.pnl >= 0 ? 'positive' : 'negative'}`}>
                  {group.financialMetricsAvailable
                    ? `${formatSignedMoney(group.pnl)} ${t('total return')}`
                    : `${t('Total return')}: ${t('Unavailable')}`}
                </div>
                <div className="account-stats">
                  {group.dayMove === null
                    ? `${t('Day move')}: ${t('Unavailable')}`
                    : `${formatSignedMoney(group.dayMove)} ${t('day move')}`}
                </div>
              </div>
            </div>

            {!isCollapsed ? (
              <>
                <div className="account-group-rows">
                  {visibleAccounts.map((account) => (
                    <Link
                      key={account.venue}
                      href={`/accounts/${encodeURIComponent(account.venue)}`}
                      className="account-row account-row-link"
                    >
                      <div className="account-row-main">
                        <div className="account-row-top" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="account-name"><bdi dir="auto">{account.label}</bdi></div>
                          <span className="status-pill neutral">{t(account.kind)}</span>
                          {account.cashCategory === 'savings_cash' ? (
                            <span className="status-pill live">{t('Saving Cash')}</span>
                          ) : account.cashCategory === 'investment_cash' ? (
                            <span className="status-pill neutral">{t('Investment-Cash')}</span>
                          ) : null}
                          {account.needsPortfolioScopeReview ? (
                            <span className="status-pill warn">{t('Review purpose')}</span>
                          ) : null}
                          {account.venue.startsWith('manual-') && (
                            <button
                              type="button"
                              style={{ 
                                background: 'none', 
                                border: 'none', 
                                cursor: 'pointer', 
                                color: 'var(--text-muted)',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px'
                              }}
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const newName = prompt(t('Enter new account name'), account.label);
                                if (newName && newName.trim()) {
                                  try {
                                    await updateManualAccount(account.venue, { label: newName.trim() });
                                  } catch {
                                    alert(t('Failed to save'));
                                  }
                                }
                              }}
                              title={t('Rename account')}
                              aria-label={t('Rename account')}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                          )}
                        </div>

                    <div className="account-meta">
                      <bdi dir="auto">{account.positions.toLocaleString(numberLocale)}</bdi> {t('positions')} ·{' '}
                      <bdi dir="auto">{account.transactionCount.toLocaleString(numberLocale)}</bdi> {t('ledger events')}
                      {showAdvancedDetails ? (
                        <> · {t('Last activity')} {formatActivityDate(account.lastActivityAt, numberLocale, t('No recent activity'))}</>
                      ) : null}
                    </div>
                    {account.notes ? (
                      <div className="account-stats" style={{ marginTop: 6 }}>
                        <bdi dir="auto">{account.notes}</bdi>
                      </div>
                    ) : null}
                    {account.negativeCashValue < 0 ? (
                      <div className="callout warn" style={{ marginTop: 8, padding: '8px 10px', fontSize: 12 }}>
                        {t('Cash correction required')}: {formatMoney(account.negativeCashValue)}
                      </div>
                    ) : null}

                    <div className="account-tag-row">
                          <div className="account-symbols">
                            {account.topSymbols.map((symbol) => (
                              <span key={`${account.venue}-${symbol}`} className="account-symbol-chip">
                                {symbol}
                              </span>
                            ))}
                          </div>
                          {showAdvancedDetails ? (
                            <div className="account-mix">
                              {account.assetMix.map((assetClass) => (
                                <span
                                  key={`${account.venue}-${assetClass}`}
                                  className={`badge ${ASSET_CLASS_BADGE_CLASSES[assetClass]}`}
                                >
                                  {t(ASSET_CLASS_LABELS[assetClass])}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="account-row-side">
                        <div className="account-value mono">
                          {account.valuationAvailable ? formatMoney(account.value) : t('Unavailable')}
                        </div>
                        <div className={`account-delta ${account.financialMetricsAvailable && account.pnl >= 0 ? 'positive' : 'negative'}`}>
                          {account.financialMetricsAvailable
                            ? `${formatSignedMoney(account.pnl)} ${t('total return')}`
                            : `${t('Total return')}: ${t('Unavailable')}`}
                        </div>
                        <div className="account-stats">
                          {account.valuationAvailable
                            ? `${account.allocation.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                            : t('Unavailable')}{' '}
                          · <bdi dir="auto">{account.positions.toLocaleString(numberLocale)}</bdi> {t('open positions')}
                        </div>
                        {showAdvancedDetails ? (
                          <div className="account-stats">
                            {t('Fees')} {formatMoney(account.totalFeesEur)} ·{' '}
                            {account.dayMove === null
                              ? `${t('Day move')}: ${t('Unavailable')}`
                              : `${t('Day move')} ${formatSignedMoney(account.dayMove)}`}
                          </div>
                        ) : null}
                      </div>
                    </Link>
                  ))}
                </div>

                {!showAllAccounts && hiddenCount > 0 ? (
                  <div className="account-group-footer">
                    {t(hiddenCount === 1
                      ? '{count} more account appears on the dedicated Accounts page.'
                      : '{count} more accounts appear on the dedicated Accounts page.')
                      .replace('{count}', hiddenCount.toLocaleString(numberLocale))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="account-group-footer">
                {t('Group collapsed. Open it when you want the individual accounts in this section.')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
