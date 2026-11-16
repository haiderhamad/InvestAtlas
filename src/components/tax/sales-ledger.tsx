'use client';

import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import type { DisposalBreakdown } from '@/lib/tax/investment-tax';
import { ASSET_CLASS_LABELS } from '@/lib/config/supported-assets';
import {
  Clock,
  Receipt, 
  ShieldCheck, 
  Tag, 
  TrendingDown, 
  TrendingUp 
} from 'lucide-react';

interface SalesLedgerProps {
  disposals: DisposalBreakdown[];
  selectedYear: number;
}

export default function SalesLedger({ disposals, selectedYear }: SalesLedgerProps) {
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const { formatMoney: formatDisplayMoney } = useDisplayCurrencyPreference();
  const formatMoney = (value: number) => formatDisplayMoney(value, 0, 2);

  const yearDisposals = disposals
    .filter((d) => d.year === selectedYear)
    .sort((a, b) => new Date(b.disposalDate).getTime() - new Date(a.disposalDate).getTime());

  if (yearDisposals.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 0' }}>
        <Receipt size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
        <p>{t('No realized gains or losses for this year yet.')}</p>
      </div>
    );
  }

  return (
    <div className="sales-ledger-wrapper animate-in">
      <div className="sales-ledger-table-container">
        <table className="sales-ledger-table">
          <thead>
            <tr>
              <th>{t('Asset & Transaction')}</th>
              <th>{t('Holding Period')}</th>
              <th className="text-right">{t('Cost & Proceeds')}</th>
              <th className="text-right">{t('Realized G/L')}</th>
              <th>{t('Tax Status')}</th>
            </tr>
          </thead>
          <tbody>
            {yearDisposals.map((disposal) => {
              const isProfit = disposal.realizedGain >= 0;
              const isLoss = disposal.realizedGain < 0;
              const statusClass = disposal.isTaxFree ? 'free' : isLoss ? 'loss-offset' : 'taxable';
              const statusLabel = disposal.isTaxFree
                ? t('Outside tax window')
                : isLoss
                ? t('Offsets gains')
                : t('Taxable');
              const statusHint = disposal.regime === 'capital_income'
                ? t('Capital-income bucket')
                : disposal.isTaxFree
                ? t('Holding period passed')
                : isLoss
                ? t('Private-sale loss bucket')
                : t('Within private-sale window');
              return (
                <tr key={disposal.id}>
                  <td>
                    <div className="asset-cell">
                      <div className="asset-icon-box">
                        <Tag size={14} />
                      </div>
                      <div className="asset-details">
                        <div className="asset-symbol">{disposal.asset}</div>
                        <div className="asset-sub">
                          {t(ASSET_CLASS_LABELS[disposal.assetClass])} • <bdi dir="ltr">{disposal.disposedAmount.toLocaleString(numberLocale, { maximumFractionDigits: 8 })}</bdi> {t('units')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="holding-cell">
                      <div className="date-group">
                        <div className="date-item">
                          <span className="label">{t('Buy')}:</span>
                          <span className="value mono">{disposal.acquisitionDate.slice(0, 10)}</span>
                        </div>
                        <div className="date-item">
                          <span className="label">{t('Sell')}:</span>
                          <span className="value mono">{disposal.disposalDate.slice(0, 10)}</span>
                        </div>
                      </div>
                      <div className="holding-duration">
                        <Clock size={10} />
                        <span>{disposal.holdingDays} {t('days held')}</span>
                      </div>
                    </div>
                  </td>
                  <td className="text-right">
                    <div className="values-cell">
                      <div className="value-row">
                        <span className="label">{t('Cost')}:</span>
                        <span className="value mono">{formatMoney(disposal.costBasisUsed)}</span>
                      </div>
                      <div className="value-row">
                        <span className="label">{t('Proc')}:</span>
                        <span className="value mono">{formatMoney(disposal.proceedsUsed)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="text-right">
                    <div className={`pnl-badge ${isProfit ? 'profit' : 'loss'}`}>
                      {isProfit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      <span className="mono">{formatMoney(Math.abs(disposal.realizedGain))}</span>
                    </div>
                  </td>
                  <td>
                    <div className="status-cell">
                      <div className={`status-badge ${statusClass}`}>
                        {disposal.isTaxFree ? (
                          <ShieldCheck size={12} />
                        ) : isLoss ? (
                          <TrendingDown size={12} />
                        ) : (
                          <Receipt size={12} />
                        )}
                        <span>{statusLabel}</span>
                      </div>
                      <div className="status-hint">
                        <span>{statusHint}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .sales-ledger-wrapper {
          width: 100%;
          margin-top: 24px;
        }

        .sales-ledger-table-container {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }

        .sales-ledger-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .sales-ledger-table th {
          text-align: left;
          padding: 16px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          background: var(--bg-tertiary);
        }

        .sales-ledger-table td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-faint);
          vertical-align: middle;
        }

        .sales-ledger-table tr:last-child td {
          border-bottom: none;
        }

        .sales-ledger-table tr:hover td {
          background: var(--bg-secondary);
          opacity: 0.8;
        }

        .text-right {
          text-align: right;
        }

        .mono {
          font-family: var(--font-mono, monospace);
        }

        /* Asset Cell */
        .asset-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .asset-icon-box {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--accent-blue-dim);
          color: var(--accent-blue);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .asset-symbol {
          font-weight: 700;
          color: var(--text-primary);
        }
        .asset-sub {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 1px;
        }

        /* Holding Cell */
        .holding-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .date-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .date-item {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          column-gap: 10px;
          align-items: baseline;
        }
        .date-item .label {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .date-item .value {
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
        }
        .holding-duration {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--accent-blue);
          margin-top: 4px;
          font-weight: 500;
        }

        /* Values Cell */
        .values-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
          align-items: flex-end;
        }
        .value-row {
          display: grid;
          grid-template-columns: max-content max-content;
          column-gap: 12px;
          justify-content: end;
          align-items: baseline;
        }
        .value-row .label {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .value-row .value {
          font-size: 12px;
          color: var(--text-primary);
          white-space: nowrap;
          text-align: right;
        }

        /* PnL Badge */
        .pnl-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
        }
        .pnl-badge.profit {
          background: rgba(34, 197, 94, 0.1);
          color: rgb(34, 197, 94);
        }
        .pnl-badge.loss {
          background: rgba(239, 68, 68, 0.1);
          color: rgb(239, 68, 68);
        }

        /* Status Cell */
        .status-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .status-badge.free {
          color: rgb(34, 197, 94);
        }
        .status-badge.taxable {
          color: rgb(245, 158, 11);
        }
        .status-badge.loss-offset {
          color: rgb(96, 165, 250);
        }
        .status-hint {
          font-size: 10px;
          color: var(--text-muted);
        }

        @media (max-width: 1024px) {
          .sales-ledger-table-container {
            overflow-x: auto;
          }
          .sales-ledger-table {
            min-width: 800px;
          }
        }
      `}</style>
    </div>
  );
}
