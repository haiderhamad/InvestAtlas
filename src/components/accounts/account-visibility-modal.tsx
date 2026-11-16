'use client';

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RotateCcw,
  X,
} from 'lucide-react';
import type { AccountGroupOverview } from '@/lib/portfolio/account-overview';
import Dialog from '@/components/ui/dialog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface AccountVisibilityModalProps {
  groups: AccountGroupOverview[];
  hiddenVenues: string[];
  collapsedGroups: string[];
  onClose: () => void;
  onToggleGroup: (groupKind: string) => void;
  onToggleAllGroups: () => void;
  onToggleAccount: (venue: string) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onReset: () => void;
}

export default function AccountVisibilityModal({
  groups,
  hiddenVenues,
  collapsedGroups,
  onClose,
  onToggleGroup,
  onToggleAllGroups,
  onToggleAccount,
  onHideAll,
  onShowAll,
  onReset,
}: AccountVisibilityModalProps) {
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const formatInteger = (value: number) => value.toLocaleString(numberLocale);
  const hiddenVenueSet = new Set(hiddenVenues);
  const totalAccounts = groups.reduce((sum, group) => sum + group.accounts.length, 0);
  const hiddenCount = groups.reduce(
    (sum, group) => sum + group.accounts.filter((account) => hiddenVenueSet.has(account.venue)).length,
    0,
  );
  const allGroupsCollapsed = groups.length > 0 && collapsedGroups.length === groups.length;
  const allAccountsHidden = totalAccounts > 0 && hiddenCount === totalAccounts;

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="account-visibility-title"
      className="account-visibility-overlay"
      contentClassName="account-visibility-modal"
    >
        <div className="account-visibility-header">
          <div>
            <h2 id="account-visibility-title" className="account-visibility-title">
              {t('Edit view')}
            </h2>
            <div className="account-visibility-subtitle">
              {t('Hidden accounts are removed from the Accounts page and dashboard calculations.')}
            </div>
          </div>
          <button type="button" className="account-visibility-close" onClick={onClose} aria-label={t('Close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="account-visibility-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onToggleAllGroups}>
            {t(allGroupsCollapsed ? 'Expand all' : 'Collapse all')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={allAccountsHidden ? onShowAll : onHideAll}
            disabled={totalAccounts === 0}
          >
            {t(allAccountsHidden ? 'Show all' : 'Hide all')}
          </button>
        </div>

        <div className="account-visibility-summary">
          <span className="status-pill neutral"><bdi dir="auto">{formatInteger(totalAccounts)}</bdi> {t('accounts tracked')}</span>
          <span className={`status-pill ${hiddenCount > 0 ? 'warn' : 'neutral'}`}>
            <bdi dir="auto">{formatInteger(hiddenCount)}</bdi> {t('hidden')}
          </span>
        </div>

        <div className="account-visibility-groups">
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.includes(group.kind);

            return (
              <div key={group.kind} className="account-visibility-group">
                <button
                  type="button"
                  className="account-visibility-group-trigger"
                  onClick={() => onToggleGroup(group.kind)}
                  aria-expanded={!isCollapsed}
                >
                  <div>
                    <div className="account-visibility-group-title">{t(group.label)}</div>
                    <div className="account-visibility-group-meta">
                      <bdi dir="auto">{formatInteger(group.accounts.length)}</bdi>{' '}
                      {t(group.accounts.length === 1 ? 'account' : 'accounts')}
                    </div>
                  </div>
                  {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>

                {!isCollapsed ? (
                  <div className="account-visibility-list">
                    {group.accounts.map((account) => {
                      const isHidden = hiddenVenueSet.has(account.venue);

                      return (
                        <div
                          key={account.venue}
                          className={`account-visibility-row ${isHidden ? 'is-hidden' : ''}`}
                        >
                          <div className="account-visibility-row-main">
                            <div className="account-visibility-row-title"><bdi dir="auto">{account.label}</bdi></div>
                            <div className="account-visibility-row-meta">
                              {t(account.kind)}
                              {account.notes ? <> · <bdi dir="auto">{account.notes}</bdi></> : null}
                            </div>
                          </div>

                          <button
                            type="button"
                            className={`account-visibility-toggle ${isHidden ? 'is-hidden' : ''}`}
                            onClick={() => onToggleAccount(account.venue)}
                          >
                            {isHidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                            {t(isHidden ? 'Hidden' : 'Visible')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="account-visibility-footer">
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            <RotateCcw size={15} aria-hidden="true" />
            {t('Reset changes')}
          </button>
        </div>
    </Dialog>
  );
}
