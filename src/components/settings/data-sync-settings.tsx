'use client';

import { 
  Database, 
  AlertTriangle,
  Activity
} from 'lucide-react';
import { useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface CoinMeta {
  symbol: string;
  name: string;
  source: string;
  isComplete: boolean | null;
  dataPoints: number | null;
  warnings: string[];
}

interface DataSyncSettingsProps {
  coinData: CoinMeta[];
}

export default function DataSyncSettings({
  coinData,
}: DataSyncSettingsProps) {
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const measuredHistories = coinData.filter(
    (asset) => asset.isComplete !== null && asset.dataPoints !== null,
  );
  const completeHistories = measuredHistories.filter((asset) => asset.isComplete === true).length;
  const historyWarnings = coinData.reduce((total, asset) => total + asset.warnings.length, 0);
  // Unknown and incomplete histories cannot count as fully covered.
  const hasIncompleteHistory = coinData.some((asset) => asset.isComplete !== true || asset.dataPoints === null);
  const isHealthy = coinData.length > 0 && !hasIncompleteHistory && historyWarnings === 0;
  const historyCoverage = coinData.length > 0
    ? Math.round((completeHistories / coinData.length) * 100)
    : null;
  const storedPointCount = measuredHistories.reduce(
    (total, asset) => total + (asset.dataPoints ?? 0),
    0,
  );

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="panel-header">
          <div>
            <div className="section-title">{t('Market Data & Sync')}</div>
            <div className="panel-subtitle">
              {t('Manage pricing sources and history synchronization.')}
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: 20, marginBottom: 20, gap: 16 }}>
          <div style={{ background: 'var(--surface-accent-soft)', padding: '20px 16px', borderRadius: 16, border: '1px solid var(--surface-border-soft)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{t('Coverage')}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-blue)', lineHeight: 1 }}>
              {historyCoverage === null ? t('Unavailable') : `${historyCoverage}%`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{t('Assets with full history')}</div>
          </div>
          <div style={{ background: 'var(--surface-soft)', padding: '20px 16px', borderRadius: 16, border: '1px solid var(--surface-border-soft)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{t('Data Points')}</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
              {measuredHistories.length === 0
                ? t('Unavailable')
                : storedPointCount.toLocaleString(numberLocale)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{t('Total stored points')}</div>
          </div>
          <div style={{ background: 'var(--surface-soft)', padding: '20px 16px', borderRadius: 16, border: '1px solid var(--surface-border-soft)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{t('Health')}</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: isHealthy ? 'var(--green)' : 'var(--yellow)' }}>
              {measuredHistories.length === 0
                ? t('Review required')
                : historyWarnings > 0
                  ? `${historyWarnings} ${t('Issues')}`
                  : hasIncompleteHistory
                    ? t('Review required')
                    : t('Optimal')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{t('Integrity check status')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div 
            className="card" 
            style={{ 
              padding: '12px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              background: 'var(--surface-soft)',
              border: '1px solid var(--surface-border-soft)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ color: 'var(--accent-blue)' }}><Activity size={18} /></div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t('Sync Integrity & Diagnostics')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Deep dive into specific asset sync errors.')}</div>
              </div>
            </div>
            <button 
              type="button"
              className="btn btn-secondary btn-sm"
              aria-expanded={showDiagnostics}
              aria-controls="data-sync-diagnostics"
              onClick={() => setShowDiagnostics((current) => !current)}
              style={{ minWidth: 80 }}
            >
              {showDiagnostics ? t('Hide') : t('Inspect')}
            </button>
          </div>
        </div>

        {showDiagnostics && (
          <div id="data-sync-diagnostics" className="animate-in" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ fontSize: 12, marginBottom: 12, opacity: 0.8 }}>{t('Detailed Asset Health')}</div>
            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Asset')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Sources')}</th>
                    <th style={{ width: '40%' }}>{t('Issues / Details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {coinData.map(asset => (
                    <tr key={asset.symbol}>
                      <td style={{ fontWeight: 700 }}>{asset.symbol}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: asset.isComplete !== true || asset.warnings.length > 0 ? 'var(--yellow)' : 'var(--green)' }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: asset.isComplete !== true || asset.warnings.length > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                            {asset.isComplete === null
                              ? t('Not measured')
                              : asset.isComplete === true && asset.warnings.length === 0
                                ? t('Healthy')
                                : t('Warning')}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t(asset.source)}
                      </td>
                      <td>
                        {asset.warnings.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {asset.warnings.map((w, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--text-primary)', fontSize: 11 }}>
                                <AlertTriangle size={12} style={{ color: 'var(--yellow)', marginTop: 2, flexShrink: 0 }} />
                                <span>{t(w)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.5 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="callout info">
        <Database size={18} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>{t('Market Data Privacy')}</strong>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {t('For Alpha Vantage BYOK, the requested symbol and session key are sent directly from this browser to Alpha Vantage. InvestAtlas servers do not receive that request.')}
          </p>
        </div>
      </div>
    </div>
  );
}
