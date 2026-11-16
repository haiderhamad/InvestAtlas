'use client';

import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { PlayCircle, Download, FlaskConical, TrendingUp, Database, AlertTriangle, Zap, Settings2, BarChart3, ChevronUp, ChevronDown, ChevronsUpDown, LayoutGrid, Info } from 'lucide-react';
import { runBacktest } from '@/lib/strategy/backtest-engine';
import {
  calculateBuyAndHoldMetrics,
  type BuyAndHoldMetrics,
} from '@/lib/strategy/buy-and-hold';
import { runMultiOptimization, estimateCombinations } from '@/lib/strategy/multi-optimizer';
import { runStabilityAnalysis } from '@/lib/strategy/stability-analyzer';
import { describeBacktestFeeModel } from '@/lib/strategy/fee-model';
import {
  isBacktestParameters,
  isBacktestSeries,
} from '@/lib/strategy/validation';
import { generatePineScript } from '@/lib/strategy/pine-export';
import { exportResultsToCSV, exportResultsToPDF, getTagLabel } from '@/lib/strategy/strategy-export';
import InteractiveEquityChart, { type InteractiveEquitySeries } from '@/components/charts/interactive-equity-chart';
import type { BacktestParameters } from '@/lib/strategy/models';
import type { BacktestResult, FullAnalysisResult, OptimizationProgress, CategoryTag } from '@/lib/strategy/types';
import type { StabilityReport } from '@/lib/strategy/stability-analyzer';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  ASSET_CLASS_OPTIONS,
  getAssetConfig,
  getTrackableAssetsByClass,
  getSupportedAssetsByClass,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  getHistoryTrustState,
  isHistoryUsableForDerivedPerformance,
  type HistoryTrustState,
} from '@/lib/financial-data/history/trust';

type TimePeriod = '1Y' | '2Y' | '5Y' | '10Y' | 'MAX';

interface HistoryResponse {
  symbol: string;
  prices: { close: number; date: string; volume: number | null }[];
  status?: 'complete' | 'partial' | 'unavailable';
  cache?: { status?: string };
}

function readThemeCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || fallback;
}

function getAssetFactorSummary(assetClass: AssetClass, t: (s: string) => string) {
  switch (assetClass) {
    case 'stock':
      return {
        label: t('Stock factors'),
        note: t('Stock assets remain trackable, but their current Shariah evidence must be reviewed separately.'),
        factors: [t('Earnings trend'), t('Valuation'), t('Dividend quality'), t('Volatility')],
      };
    case 'etf':
      return {
        label: t('ETF factors'),
        note: t('Issuer-declared Islamic ETFs remain trackable, but current source evidence must still be reviewed.'),
        factors: [t('Index rules'), t('Region mix'), t('Fee drag'), t('Tracking behavior')],
      };
    case 'metal':
      return {
        label: t('Metals factors'),
        note: t('Use Gold/Silver context before overreacting.'),
        factors: [t('Real yields'), t('USD strength'), t('Inflation demand'), t('Gold/Silver ratio')],
      };
    case 'crypto':
    default:
      return {
        label: t('Crypto factors'),
        note: t('Crypto assets remain trackable; missing or outdated Shariah evidence requires review.'),
        factors: [t('Momentum'), t('Liquidity'), t('Volatility'), t('Cycle leadership')],
      };
  }
}

function formatDuration(
  days: number | null | undefined,
  t: (s: string) => string,
): string {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    return '—';
  }
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = Math.round(days % 30);
  
  const parts = [];
  if (years > 0) parts.push(`${years}${t('y')}`);
  if (months > 0) parts.push(`${months}${t('m')}`);
  if (remainingDays > 0 || parts.length === 0) parts.push(`${remainingDays}${t('d')}`);
  
  return parts.join(' ');
}

function DetailedMetricsTable({ 
  result, 
  results,
  initialCapital, 
  currency = 'eur',
  strategyLabel,
  buyHoldMetrics,
  asset = 'BTC'
}: { 
  result?: BacktestResult; 
  results?: BacktestResult[];
  initialCapital: number; 
  currency?: 'eur' | 'usd';
  strategyLabel?: string;
  buyHoldMetrics?: BuyAndHoldMetrics | null;
  asset?: string;
}) {
  const { t, language } = useAppTranslation();
  const finalResults = results || (result ? [result] : []);
  if (finalResults.length === 0) return null;

  const m0 = finalResults[0].metrics;
  const bhm = buyHoldMetrics;
  
  const buyHoldFinal = initialCapital * (1 + m0.buyHoldReturnPct / 100);
  const sym = currency === 'usd' ? '$' : '€';

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const formatMoney = (val: number) => `${sym}${val.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatPct = (val: number) => `${val >= 0 ? '+' : ''}${val.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const formatRatio = (val: number | null | undefined) =>
    typeof val === 'number' && Number.isFinite(val)
      ? val.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  const formatOptionalPct = (val: number | null | undefined) =>
    typeof val === 'number' && Number.isFinite(val) ? formatPct(val) : '—';
  const formatUnsignedPct = (val: number | null | undefined) =>
    typeof val === 'number' && Number.isFinite(val)
      ? `${val.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
      : '—';
  
  const colSpan = finalResults.length + 2;

  return (
    <div className="card" style={{ padding: 0, marginTop: 16, border: '1px solid var(--surface-border-soft)', overflowX: 'auto' }}>
      <div className="table-container" style={{ border: 'none' }}>
        <table style={{ fontSize: 13, width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--surface-border-soft)' }}>
              <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, padding: '12px 16px', background: 'rgba(0,0,0,0.1)' }}>{t('Metric')}</th>
              {finalResults.map((r, i) => (
                <th key={i} style={{ textAlign: 'right', color: 'var(--accent-teal)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, padding: '12px 16px', background: 'rgba(0,0,0,0.1)' }}>
                  {results ? `${t('Rank')} #${i+1}` : (strategyLabel || t('Strategy'))}
                  {results && <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}>{`SMA(${r.parameters.fastPeriod}/${r.parameters.slowPeriod})`}</div>}
                </th>
              ))}
              <th style={{ textAlign: 'right', color: 'var(--text-secondary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, padding: '12px 16px', background: 'rgba(0,0,0,0.1)' }}>{t('Buy & Hold')}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={colSpan} style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '16px 16px 8px', textTransform: 'uppercase', letterSpacing: 1, borderBottom: 'none', opacity: 0.5 }}>{t('Performance')}</td></tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>{formatMoney(initialCapital)} {t('would be')}</td>
              {finalResults.map((r, i) => {
                const final = r.equityCurve[r.equityCurve.length - 1] ?? initialCapital;
                return (
                  <td key={i} style={{ textAlign: 'right', fontWeight: 600, color: final >= initialCapital ? 'var(--green)' : 'var(--red)', padding: '8px 16px' }}>
                    {formatMoney(final)}
                  </td>
                );
              })}
              <td style={{ textAlign: 'right', fontWeight: 600, color: buyHoldFinal >= initialCapital ? 'var(--green)' : 'var(--red)', padding: '8px 16px' }}>{formatMoney(buyHoldFinal)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Ann. Return')}
                  <span title={t('Average annual percentage return.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', color: r.metrics.annualizedReturnPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPct(r.metrics.annualizedReturnPct)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', color: bhm && bhm.annualizedReturnPct >= 0 ? 'var(--green)' : bhm ? 'var(--red)' : 'var(--text-muted)' }}>{formatOptionalPct(bhm?.annualizedReturnPct)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Sharpe Ratio')}
                  <span title={t('Measures risk-adjusted performance based on total volatility.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(r.metrics.sharpeRatio)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', color: 'var(--text-primary)' }}>{formatRatio(bhm?.sharpeRatio)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Sortino Ratio')}
                  <span title={t('Measures risk-adjusted performance, focusing on downside risk.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(r.metrics.sortinoRatio)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', color: 'var(--text-primary)' }}>{formatRatio(bhm?.sortinoRatio)}</td>
            </tr>

            <tr><td colSpan={colSpan} style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '20px 16px 8px', textTransform: 'uppercase', letterSpacing: 1, borderBottom: 'none', opacity: 0.5 }}>{t('Risk')}</td></tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Max Drawdown')}
                  <span title={t('The largest peak-to-trough decline in value.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, color: r.metrics.maxDrawdownPct > 0 ? 'var(--red)' : 'var(--green)', padding: '8px 16px' }}>-{r.metrics.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, color: bhm ? (bhm.maxDrawdownPct > 0 ? 'var(--red)' : 'var(--green)') : 'var(--text-muted)', padding: '8px 16px' }}>{bhm ? `-${formatUnsignedPct(bhm.maxDrawdownPct)}` : '—'}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Drawdown Duration')}
                  <span title={t('Longest time to recover to a new high.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatDuration(r.metrics.drawdownDurationDays, t)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatDuration(bhm?.drawdownDurationDays, t)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Volatility')}
                  <span title={t('Standard deviation of returns (annualized).')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{r.metrics.volatility.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatUnsignedPct(bhm?.volatility)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Beta')}
                  <span title={t('Strategy sensitivity compared to the market (Buy & Hold).')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(r.metrics.beta)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', color: 'var(--text-muted)' }}>{formatRatio(bhm?.beta)}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Calmar Ratio')}
                  <span title={t('Annualized return divided by maximum drawdown.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(r.metrics.calmarRatio)}</td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(bhm?.calmarRatio)}</td>
            </tr>

            <tr><td colSpan={colSpan} style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '20px 16px 8px', textTransform: 'uppercase', letterSpacing: 1, borderBottom: 'none', opacity: 0.5 }}>{t('Trades')}</td></tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>{t('Trades')}</td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{r.metrics.totalTrades}</td>
              ))}
              <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '8px 16px' }}>—</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Win Rate')}
                  <span title={t('Percentage of profitable trades.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{r.metrics.winRate.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              ))}
              <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '8px 16px' }}>—</td>
            </tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t('Profit Factor')}
                  <span title={t('Gross profit divided by gross loss.')} style={{ display: 'flex', alignItems: 'center' }}>
                    <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
                  </span>
                </div>
              </td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>{formatRatio(r.metrics.profitFactor)}</td>
              ))}
              <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '8px 16px' }}>—</td>
            </tr>

            <tr><td colSpan={colSpan} style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '20px 16px 8px', textTransform: 'uppercase', letterSpacing: 1, borderBottom: 'none', opacity: 0.5 }}>{t('Annual')}</td></tr>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px' }}>{t('Best Year')}</td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>
                  <span style={{ color: 'var(--green)' }}>{formatPct(r.metrics.bestYear.returnPct)}</span> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({r.metrics.bestYear.year})</span>
                </td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px' }}>
                {bhm ? (
                  <>
                    <span style={{ color: 'var(--green)' }}>{formatPct(bhm.bestYear.returnPct)}</span>{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({bhm.bestYear.year})</span>
                  </>
                ) : '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', padding: '8px 16px', paddingBottom: 16 }}>{t('Worst Year')}</td>
              {finalResults.map((r, i) => (
                <td key={i} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', paddingBottom: 16 }}>
                  <span style={{ color: 'var(--red)' }}>{formatPct(r.metrics.worstYear.returnPct)}</span> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({r.metrics.worstYear.year})</span>
                </td>
              ))}
              <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 16px', paddingBottom: 16 }}>
                {bhm ? (
                  <>
                    <span style={{ color: 'var(--red)' }}>{formatPct(bhm.worstYear.returnPct)}</span>{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({bhm.worstYear.year})</span>
                  </>
                ) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div style={{ padding: 16, borderTop: '1px solid var(--surface-border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: '60%' }}>
          {t('This Pine Script is designed for the 1-day interval on TradingView.')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {finalResults.map((r, i) => (
            <button
              key={i}
              onClick={() => generatePineScript(r.parameters, { mode: 'strategy', includeAlerts: true, includeComments: true, confirmOnClose: true, coinName: asset, backtestResult: r })}
              className="btn btn-ghost"
              style={{ gap: 8, fontSize: 11, padding: '4px 8px' }}
            >
              <Download size={12} />
              {results ? `${t('Rank')} #${i+1}` : t('Export Pine Script')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComparisonMetricsTable({ resultA, resultB, initialCapital, currency = 'eur' }: { resultA: BacktestResult; resultB: BacktestResult; initialCapital: number; currency?: 'eur' | 'usd' }) {
  const { t, language } = useAppTranslation();
  const mA = resultA.metrics;
  const mB = resultB.metrics;
  const buyHoldFinal = initialCapital * (1 + mA.buyHoldReturnPct / 100);
  const finalA = resultA.equityCurve[resultA.equityCurve.length - 1] ?? initialCapital;
  const finalB = resultB.equityCurve[resultB.equityCurve.length - 1] ?? initialCapital;
  const sym = currency === 'usd' ? '$' : '€';

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const fmt = (val: number) => `${sym}${val.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (val: number) => `${val > 0 ? '+' : ''}${val.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const ratio = (val: number) => isFinite(val)
    ? val.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

  const better = (a: number, b: number, higherIsBetter = true) => {
    if (higherIsBetter) return a > b ? 'var(--green)' : a < b ? 'var(--red)' : undefined;
    return a < b ? 'var(--green)' : a > b ? 'var(--red)' : undefined;
  };

  const td = { padding: '6px 16px' } as const;
  const tdR = { ...td, textAlign: 'right' as const, fontWeight: 600 };
  const secH = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', paddingTop: 16, paddingBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 1, borderBottom: 'none' } as const;
  const thBase = { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 1 } as const;

  return (
    <div className="card" style={{ padding: 0, marginTop: 16 }}>
      <div className="table-container" style={{ border: 'none' }}>
        <table style={{ fontSize: 13, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--text-muted)', ...thBase }}>{t('Metric')}</th>
              <th style={{ textAlign: 'right', color: 'var(--series-crypto)', ...thBase }}>{t('Strategy A')}</th>
              <th style={{ textAlign: 'right', color: 'var(--series-market)', ...thBase }}>{t('Strategy B')}</th>
              <th style={{ textAlign: 'right', color: 'var(--text-secondary)', ...thBase }}>{t('Buy & Hold')}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} style={secH}>{t('Performance')}</td></tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{fmt(initialCapital)} {t('would be')}</td>
              <td style={{ ...tdR, color: better(finalA, finalB) }}>{fmt(finalA)}</td>
              <td style={{ ...tdR, color: better(finalB, finalA) }}>{fmt(finalB)}</td>
              <td style={{ ...tdR, color: 'var(--text-primary)' }}>{fmt(buyHoldFinal)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Total Return')}</td>
              <td style={{ ...tdR, color: better(mA.totalReturnPct, mB.totalReturnPct) }}>{pct(mA.totalReturnPct)}</td>
              <td style={{ ...tdR, color: better(mB.totalReturnPct, mA.totalReturnPct) }}>{pct(mB.totalReturnPct)}</td>
              <td style={{ ...tdR, color: 'var(--text-primary)' }}>{pct(mA.buyHoldReturnPct)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Ann. Return')}</td>
              <td style={{ ...tdR, color: better(mA.annualizedReturnPct, mB.annualizedReturnPct) }}>{pct(mA.annualizedReturnPct)}</td>
              <td style={{ ...tdR, color: better(mB.annualizedReturnPct, mA.annualizedReturnPct) }}>{pct(mB.annualizedReturnPct)}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Sharpe Ratio')}</td>
              <td style={{ ...tdR, color: better(mA.sharpeRatio, mB.sharpeRatio) }}>{ratio(mA.sharpeRatio)}</td>
              <td style={{ ...tdR, color: better(mB.sharpeRatio, mA.sharpeRatio) }}>{ratio(mB.sharpeRatio)}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Sortino Ratio')}</td>
              <td style={{ ...tdR, color: better(mA.sortinoRatio, mB.sortinoRatio) }}>{ratio(mA.sortinoRatio)}</td>
              <td style={{ ...tdR, color: better(mB.sortinoRatio, mA.sortinoRatio) }}>{ratio(mB.sortinoRatio)}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>

            <tr><td colSpan={4} style={secH}>{t('Risk')}</td></tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Max Drawdown')}</td>
              <td style={{ ...tdR, color: better(mA.maxDrawdownPct, mB.maxDrawdownPct, false) }}>-{mA.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: better(mB.maxDrawdownPct, mA.maxDrawdownPct, false) }}>-{mB.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Drawdown Duration')}</td>
              <td style={{ ...tdR, color: better(mA.drawdownDurationDays, mB.drawdownDurationDays, false) }}>{Math.round(mA.drawdownDurationDays)}d</td>
              <td style={{ ...tdR, color: better(mB.drawdownDurationDays, mA.drawdownDurationDays, false) }}>{Math.round(mB.drawdownDurationDays)}d</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Volatility')}</td>
              <td style={{ ...tdR, color: better(mA.volatility, mB.volatility, false) }}>{mA.volatility.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: better(mB.volatility, mA.volatility, false) }}>{mB.volatility.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Calmar Ratio')}</td>
              <td style={{ ...tdR, color: better(mA.calmarRatio, mB.calmarRatio) }}>{ratio(mA.calmarRatio)}</td>
              <td style={{ ...tdR, color: better(mB.calmarRatio, mA.calmarRatio) }}>{ratio(mB.calmarRatio)}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>

            <tr><td colSpan={4} style={secH}>{t('Trades & Annual')}</td></tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Trades')}</td>
              <td style={tdR}>{mA.totalTrades}</td>
              <td style={tdR}>{mB.totalTrades}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Win Rate')}</td>
              <td style={{ ...tdR, color: better(mA.winRate, mB.winRate) }}>{mA.winRate.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: better(mB.winRate, mA.winRate) }}>{mB.winRate.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Profit Factor')}</td>
              <td style={{ ...tdR, color: better(mA.profitFactor, mB.profitFactor) }}>{ratio(mA.profitFactor)}</td>
              <td style={{ ...tdR, color: better(mB.profitFactor, mA.profitFactor) }}>{ratio(mB.profitFactor)}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Avg Win / Loss')}</td>
              <td style={tdR}>
                <span style={{ color: 'var(--green)' }}>+{mA.avgGainPerTrade.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span> / <span style={{ color: 'var(--red)' }}>-{mA.avgLossPerTrade.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>
              </td>
              <td style={tdR}>
                <span style={{ color: 'var(--green)' }}>+{mB.avgGainPerTrade.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span> / <span style={{ color: 'var(--red)' }}>-{mB.avgLossPerTrade.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>
              </td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Best Year')}</td>
              <td style={{ ...tdR, color: 'var(--green)' }}>{pct(mA.bestYear?.returnPct || 0)} <span style={{ color: 'var(--text-muted)' }}>({mA.bestYear?.year || '-'})</span></td>
              <td style={{ ...tdR, color: 'var(--green)' }}>{pct(mB.bestYear?.returnPct || 0)} <span style={{ color: 'var(--text-muted)' }}>({mB.bestYear?.year || '-'})</span></td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-secondary)', ...td }}>{t('Worst Year')}</td>
              <td style={{ ...tdR, color: 'var(--red)' }}>{pct(mA.worstYear?.returnPct || 0)} <span style={{ color: 'var(--text-muted)' }}>({mA.worstYear?.year || '-'})</span></td>
              <td style={{ ...tdR, color: 'var(--red)' }}>{pct(mB.worstYear?.returnPct || 0)} <span style={{ color: 'var(--text-muted)' }}>({mB.worstYear?.year || '-'})</span></td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StrategyLabPage() {
  const { t, language } = useAppTranslation();
  const { displayCurrency } = useDisplayCurrencyPreference();
  // ─── SHARED STATE ───
  const [asset, setAsset] = useState('BTC');
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClass>('crypto');
  const currencySymbol = displayCurrency === 'usd' ? '$' : '€';
  const [analysisMode, setAnalysisMode] = useState<'manual' | 'auto'>('auto');
  const [initialCapital, setInitialCapital] = useState(100);
  const [feePercent, setFeePercent] = useState(0.25);
  const [feeMode, setFeeMode] = useState<'percent' | 'flat'>('percent');
  const [flatFeeAmount, setFlatFeeAmount] = useState(1);
  const [slippage, setSlippage] = useState(0.1);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const [backtestError, setBacktestError] = useState(false);

  // ─── HISTORICAL DATA ───
  const [prices, setPrices] = useState<number[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyTrustState, setHistoryTrustState] = useState<HistoryTrustState | null>(null);

  // ─── MANUAL MODE STATE ───
  const [useSma, setUseSma] = useState(true);
  const [smaPeriod, setSmaPeriod] = useState(50);
  const [dualSma, setDualSma] = useState(false);
  const [fastPeriod, setFastPeriod] = useState(20);
  const [slowPeriod, setSlowPeriod] = useState(50);
  const [singleResult, setSingleResult] = useState<BacktestResult | null>(null);

  // ─── COMPARISON MODE STATE ───
  const [compareMode, setCompareMode] = useState(false);
  const [compareResult, setCompareResult] = useState<BacktestResult | null>(null);
  const [useSmaB, setUseSmaB] = useState(true);
  const [smaPeriodB, setSmaPeriodB] = useState(200);
  const [dualSmaB, setDualSmaB] = useState(false);
  const [fastPeriodB, setFastPeriodB] = useState(10);
  const [slowPeriodB, setSlowPeriodB] = useState(30);

  // Volume filter state
  const [volumes, setVolumes] = useState<(number | null)[]>([]);

  // ─── AUTO MODE STATE ───
  const [intensity, setIntensity] = useState<'fast' | 'normal' | 'thorough'>('normal');
  const [optStep, setOptStep] = useState(1);
  const [autoResults, setAutoResults] = useState<FullAnalysisResult[]>([]);
  const [selectedRank, setSelectedRank] = useState(1);
  const [topResultsFull, setTopResultsFull] = useState<BacktestResult[]>([]);
  const [activeTab, setActiveTab] = useState<'config' | 'results' | 'export'>('config');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('MAX');
  const interval = '1d';
  const strategyAParameters = useMemo<BacktestParameters>(() => ({
    strategyType: dualSma ? 'dual_sma' : 'single_sma',
    smaPeriod: dualSma ? undefined : smaPeriod,
    fastPeriod: dualSma ? fastPeriod : undefined,
    slowPeriod: dualSma ? slowPeriod : undefined,
    feePercent,
    feeMode,
    flatFeeAmount,
    quoteCurrency: displayCurrency,
    slippagePercent: slippage,
    initialCapital,
    interval,
  }), [
    displayCurrency,
    dualSma,
    fastPeriod,
    feeMode,
    feePercent,
    flatFeeAmount,
    initialCapital,
    slippage,
    slowPeriod,
    smaPeriod,
  ]);
  const strategyBParameters = useMemo<BacktestParameters>(() => ({
    strategyType: dualSmaB ? 'dual_sma' : 'single_sma',
    smaPeriod: dualSmaB ? undefined : smaPeriodB,
    fastPeriod: dualSmaB ? fastPeriodB : undefined,
    slowPeriod: dualSmaB ? slowPeriodB : undefined,
    feePercent,
    feeMode,
    flatFeeAmount,
    quoteCurrency: displayCurrency,
    slippagePercent: slippage,
    initialCapital,
    interval,
  }), [
    displayCurrency,
    dualSmaB,
    fastPeriodB,
    feeMode,
    feePercent,
    flatFeeAmount,
    initialCapital,
    slippage,
    slowPeriodB,
    smaPeriodB,
  ]);
  const sharedBacktestParameters = useMemo<BacktestParameters>(() => ({
    strategyType: 'single_sma',
    smaPeriod: 2,
    feePercent,
    feeMode,
    flatFeeAmount,
    quoteCurrency: displayCurrency,
    slippagePercent: slippage,
    initialCapital,
    interval,
  }), [
    displayCurrency,
    feeMode,
    feePercent,
    flatFeeAmount,
    initialCapital,
    slippage,
  ]);
  const validHistoricalSeries = isBacktestSeries(prices, dates);
  const effectiveVolumes =
    volumes.length === prices.length ? volumes : undefined;
  const manualBacktestInputsValid =
    validHistoricalSeries
    && isBacktestParameters(strategyAParameters)
    && (
      !compareMode
      || isBacktestParameters(strategyBParameters)
    );
  const automaticBacktestInputsValid =
    validHistoricalSeries
    && isBacktestParameters(sharedBacktestParameters);
  const canRunBacktest =
    analysisMode === 'auto'
      ? automaticBacktestInputsValid
      : manualBacktestInputsValid;
  const buyHoldMetrics = useMemo(
    () => calculateBuyAndHoldMetrics(
      prices,
      dates,
      initialCapital,
      interval,
    ),
    [dates, initialCapital, prices],
  );
  const [stability, setStability] = useState<StabilityReport | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [chartTab, setChartTab] = useState<'equity' | 'sma_landscape' | 'sma_heatmap' | 'monthly_heatmap'>('equity');
  const [themeRevision, setThemeRevision] = useState(0);

  const strategyMonthlyCells = useMemo(() => {
    if (autoResults.length === 0 || !dates || dates.length === 0) return [];
    const result = autoResults[0].result;
    const curve = result.equityCurve;
    const monthValues: Record<string, number> = {};
    for (let i = 0; i < dates.length; i++) {
      const monthKey = dates[i].slice(0, 7);
      monthValues[monthKey] = curve[i];
    }
    const monthKeys = Object.keys(monthValues).sort();
    const cells: { year: string; month: string; returnPct: number | null }[] = [];
    let prevValue = initialCapital;
    for (const key of monthKeys) {
      const currentVal = monthValues[key];
      const ret = ((currentVal - prevValue) / prevValue) * 100;
      cells.push({
        year: key.slice(0, 4),
        month: key.slice(5, 7),
        returnPct: Number(ret.toFixed(2))
      });
      prevValue = currentVal;
    }
    return cells;
  }, [autoResults, dates, initialCapital]);

  const groupedMonthlyReturns = useMemo(() => {
    const yearMap = new Map<string, (number | null)[]>();
    strategyMonthlyCells.forEach(cell => {
      if (!yearMap.has(cell.year)) {
        yearMap.set(cell.year, new Array(12).fill(null));
      }
      const monthIdx = parseInt(cell.month, 10) - 1;
      yearMap.get(cell.year)![monthIdx] = cell.returnPct;
    });
    return Array.from(yearMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [strategyMonthlyCells]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeRevision((value) => value + 1);
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  // Fetch history when asset or currency changes
  const fetchHistory = useCallback(async (sym: string) => {
    setLoadingHistory(true);
    setPrices([]);
    setDates([]);
    setVolumes([]);
    setHistoryTrustState(null);
    try {
      const res = await fetchFinancialData(`/api/prices/history?symbol=${sym}&currency=${displayCurrency}&interval=${interval}`);
      const data = (await res.json()) as HistoryResponse;
      if (res.ok && data.prices) {
        const trustState = getHistoryTrustState(data);
        setHistoryTrustState(trustState);
        if (trustState === 'unavailable' || !isHistoryUsableForDerivedPerformance(data)) return;
        const allPrices = data.prices.map((p: { close: number }) => p.close);
        const allDates = data.prices.map((p: { date: string }) => p.date);
        const allVolumes = data.prices.map((p: { volume: number | null }) => p.volume);
        const daysMap: Record<TimePeriod, number> = { '1Y': 365, '2Y': 730, '5Y': 1825, '10Y': 3650, 'MAX': allPrices.length };
        const days = Math.min(daysMap[timePeriod] || allPrices.length, allPrices.length);

        setPrices(allPrices.slice(-days));
        setDates(allDates.slice(-days));
        setVolumes(allVolumes.slice(-days));
      } else {
        setHistoryTrustState('unavailable');
      }
    } catch {
      setHistoryTrustState('unavailable');
    } finally {
      setLoadingHistory(false);
    }
  }, [timePeriod, displayCurrency, interval]);

  useEffect(() => { fetchHistory(asset); }, [asset, fetchHistory, timePeriod, displayCurrency, interval]);

  const estCount = useMemo(() => estimateCombinations(intensity), [intensity]);
  const selectedAssetConfig = useMemo(() => getAssetConfig(asset), [asset]);
  const availableAssets = useMemo(
    () => getTrackableAssetsByClass(assetClassFilter),
    [assetClassFilter],
  );
  const costModelSummary = describeBacktestFeeModel({
    strategyType: 'single_sma',
    feePercent,
    feeMode,
    flatFeeAmount,
    quoteCurrency: displayCurrency,
    slippagePercent: slippage,
    initialCapital,
  });

  // ─── HELPERS ───
  const getManualStrategyLabel = (
    _useSma: boolean, _smaPeriod: number, _dualSma: boolean,
    _fastPeriod: number, _slowPeriod: number
  ): string => {
    const parts: string[] = [];
    if (_useSma) {
      if (_dualSma) parts.push(`SMA(${_fastPeriod}/${_slowPeriod})`);
      else parts.push(`SMA(${_smaPeriod})`);
    }
    return parts.join(' + ') || 'No Indicators';
  };

  const autoEquitySeries = useMemo<InteractiveEquitySeries[]>(() => {
    if (prices.length === 0) return [];

    const buyHoldCurve = prices.map((price) => initialCapital * (price / prices[0]));
    const lines: InteractiveEquitySeries[] = [
      { label: t('Buy & Hold'), color: 'var(--series-neutral)', data: buyHoldCurve, lineStyle: 'dashed' },
    ];

    const colors = ['var(--series-crypto)', 'var(--series-real-return)', 'var(--series-market)'];
    for (let i = 0; i < Math.min(1, autoResults.length); i++) {
      lines.push({
        label: autoResults[i].strategyLabel,
        color: colors[i],
        data: autoResults[i].result.equityCurve,
      });
    }

    return lines;
  }, [autoResults, initialCapital, prices]);

  const manualEquitySeries = useMemo<InteractiveEquitySeries[]>(() => {
    if (!singleResult || prices.length === 0) return [];

    const buyHoldCurve = prices.map((price) => initialCapital * (price / prices[0]));
    const labelA = getManualStrategyLabel(
      useSma,
      smaPeriod,
      dualSma,
      fastPeriod,
      slowPeriod,
    );

    const lines: InteractiveEquitySeries[] = [
      { label: t('Buy & Hold'), color: 'var(--series-neutral)', data: buyHoldCurve, lineStyle: 'dashed' },
      {
        label: compareMode ? `${t('Strategy A')}: ${labelA}` : labelA,
        color: 'var(--series-crypto)',
        data: singleResult.equityCurve,
      },
    ];

    if (compareMode && compareResult) {
      const labelB = getManualStrategyLabel(
        useSmaB,
        smaPeriodB,
        dualSmaB,
        fastPeriodB,
        slowPeriodB,
      );

      lines.push({
        label: `${t('Strategy B')}: ${labelB}`,
        color: 'var(--series-market)',
        data: compareResult.equityCurve,
      });
    }

    return lines;
  }, [
    compareMode,
    compareResult,
    dualSma,
    dualSmaB,
    fastPeriod,
    fastPeriodB,
    initialCapital,
    prices,
    singleResult,
    slowPeriod,
    slowPeriodB,
    smaPeriod,
    smaPeriodB,
    useSma,
    useSmaB,
  ]);

  const downloadPineScript = useCallback((params: BacktestParameters, result?: BacktestResult, labelSuffix?: string) => {
    const script = generatePineScript(params, {
      mode: 'strategy',
      includeAlerts: true,
      includeComments: true,
      confirmOnClose: true,
      coinName: asset,
      backtestResult: result,
    });
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (labelSuffix || 'strategy').replace(/[^a-zA-Z0-9_()-]/g, '_');
    a.href = url;
    a.download = `${asset}_${safeName}.pine`;
    a.click();
    URL.revokeObjectURL(url);
  }, [asset]);

  // Draw SMA parameter landscape for auto results
  useEffect(() => {
    if (!chartRef.current || autoResults.length < 1 || activeTab !== 'results' || (chartTab !== 'sma_landscape' && chartTab !== 'sma_heatmap')) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const chartGrid = readThemeCssVar('--chart-grid', 'rgba(100,116,139,0.15)');
    const chartTrack = readThemeCssVar('--chart-track', 'rgba(100,116,139,0.8)');
    const chartTextDim = readThemeCssVar('--chart-text-dim', '#64748b');
    const seriesMarket = readThemeCssVar('--series-market', '#3b82f6');
    const seriesInvested = readThemeCssVar('--series-invested', '#94a3b8');

    const isRtl = language === 'ar';
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padL = isRtl ? 64 : 60;
    const padR = isRtl ? 60 : 64;
    const padB = 48;
    const padT = 16;
    const chartW = W - padL - padR;
    const chartH = H - padB - padT;

    ctx.clearRect(0, 0, W, H);
    
    const bhReturn = autoResults[0]?.result.metrics.buyHoldReturnPct || 0;

    if (chartTab === 'sma_landscape') {
      const smaData = autoResults
        .filter((r) => r.result.parameters.strategyType === 'single_sma')
        .map((r) => ({ period: r.result.parameters.smaPeriod!, returnPct: r.result.metrics.totalReturnPct }))
        .sort((a, b) => a.period - b.period);

      const smaReturns = smaData.map(d => d.returnPct);
      const minReturn = Math.min(...smaReturns, bhReturn) - 3;
      const maxReturn = Math.max(...smaReturns, bhReturn) + 3;
      const yRangePadded = maxReturn - minReturn;
      const yScaleLocal = (value: number) => padT + chartH - ((value - minReturn) / yRangePadded) * chartH;

      if (smaData.length === 0) {
        ctx.fillStyle = chartTextDim;
        ctx.textAlign = 'center';
        ctx.font = '13px sans-serif';
        ctx.fillText(t('No single-SMA data available (were only combinations tested?)'), W / 2, H / 2);
        return;
      }

      const minPeriod = smaData[0].period;
      const maxPeriod = smaData[smaData.length - 1].period;
      const xStepLocal = chartW / Math.max(1, maxPeriod - minPeriod);

      // Draw grid & labels
      ctx.strokeStyle = chartGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const y = padT + (chartH * i) / 5;
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        const val = maxReturn - (i / 5) * yRangePadded;
        ctx.fillStyle = chartTextDim;
        ctx.font = '10px sans-serif';
        ctx.textAlign = isRtl ? 'left' : 'right';
        ctx.fillText(`${val.toFixed(0)}%`, isRtl ? W - padR + 8 : padL - 8, y + 4);
      }
      ctx.stroke();

      // Draw Buy & Hold reference line
      const bhY = yScaleLocal(bhReturn);
      ctx.strokeStyle = chartTrack;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padL, bhY);
      ctx.lineTo(W - padR, bhY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = chartTextDim;
      ctx.textAlign = isRtl ? 'right' : 'left';
      ctx.fillText(`${t('Buy & Hold')}: ${bhReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`, isRtl ? padL : W - padR + 8, bhY + 4);

      // Draw Curve
      ctx.strokeStyle = seriesMarket;
      ctx.lineWidth = 2;
      ctx.beginPath();
      smaData.forEach((d, i) => {
        const x = padL + (d.period - minPeriod) * xStepLocal;
        const y = yScaleLocal(d.returnPct);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Highlight best SMA
      const bestSmaPoint = smaData.reduce((prev, curr) => (curr.returnPct > prev.returnPct ? curr : prev), smaData[0]);
      if (bestSmaPoint) {
        const hX = padL + (bestSmaPoint.period - minPeriod) * xStepLocal;
        const hY = yScaleLocal(bestSmaPoint.returnPct);
        
        ctx.fillStyle = 'var(--accent-teal)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hX, hY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`SMA(${bestSmaPoint.period})`, hX, hY - 12);
      }

      // Draw Area
      const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
      gradient.addColorStop(0, seriesMarket + '44');
      gradient.addColorStop(1, seriesMarket + '00');
      ctx.fillStyle = gradient;
      ctx.lineTo(padL + (smaData[smaData.length - 1].period - minPeriod) * xStepLocal, padT + chartH);
      ctx.lineTo(padL, padT + chartH);
      ctx.closePath();
      ctx.fill();

      // X-Axis labels
      ctx.fillStyle = chartTextDim;
      ctx.textAlign = 'center';
      for (let i = 0; i <= 10; i++) {
        const p = Math.round(minPeriod + (i / 10) * (maxPeriod - minPeriod));
        const x = padL + (p - minPeriod) * xStepLocal;
        ctx.fillText(`${p}`, x, padT + chartH + 20);
      }
      ctx.fillText(t('SMA Period (Days)'), W / 2, padT + chartH + 40);
    } else if (chartTab === 'sma_heatmap') {
      const allDual = autoResults.filter(r => r.result.parameters.strategyType === 'dual_sma');
      const dualData = allDual.filter(r => {
        const f = r.result.parameters.fastPeriod || 0;
        const s = r.result.parameters.slowPeriod || 0;
        return (f - 5) % optStep === 0 && (s - 20) % optStep === 0;
      });
      if (dualData.length === 0) {
        ctx.fillStyle = chartTextDim;
        ctx.textAlign = 'center';
        ctx.font = '13px sans-serif';
        ctx.fillText(t('No dual-SMA data available for heatmap.'), W / 2, H / 2);
        return;
      }

      const fasts = Array.from(new Set(dualData.map(d => d.result.parameters.fastPeriod!))).sort((a, b) => a - b);
      const slows = Array.from(new Set(dualData.map(d => d.result.parameters.slowPeriod!))).sort((a, b) => a - b);

      // Find min/max for color scale
      const returns = dualData.map(d => d.result.metrics.totalReturnPct);
      const minR = Math.min(...returns);
      const maxR = Math.max(...returns);
      const rangeR = Math.max(0.1, maxR - minR);

      const getCellColor = (val: number) => {
        const n = (val - minR) / rangeR;
        let r, g, b;
        
        // 0.0 -> Red (220, 38, 38)
        // 0.5 -> Yellow (234, 179, 8)
        // 1.0 -> Green (22, 163, 74)
        if (n < 0.5) {
          const t = n * 2;
          r = Math.round(220 + (234 - 220) * t);
          g = Math.round(38 + (179 - 38) * t);
          b = Math.round(38 + (8 - 38) * t);
        } else {
          const t = (n - 0.5) * 2;
          r = Math.round(234 + (22 - 234) * t);
          g = Math.round(179 + (163 - 179) * t);
          b = Math.round(8 + (74 - 8) * t);
        }
        return `rgb(${r}, ${g}, ${b})`;
      };

      // Draw Legend
      const legendW = 15;
      const legendX = isRtl ? 10 : W - padR + 25;
      const legendH = chartH;
      const legendY = padT;
      
      for (let i = 0; i < legendH; i++) {
        const val = minR + ((legendH - i) / legendH) * rangeR;
        ctx.fillStyle = getCellColor(val);
        ctx.fillRect(legendX, legendY + i, legendW, 1);
      }
      
      // Legend Labels
      ctx.fillStyle = chartTextDim;
      ctx.textAlign = isRtl ? 'right' : 'left';
      ctx.font = '10px sans-serif';
      [0, 0.25, 0.5, 0.75, 1].forEach(p => {
        const val = minR + p * rangeR;
        const y = legendY + legendH - p * legendH;
        ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(0)}%`, legendX + legendW + 6, y + 4);
      });

      const bestResult = dualData.reduce((prev, curr) => (curr.result.metrics.totalReturnPct > prev.result.metrics.totalReturnPct ? curr : prev), dualData[0]);

      dualData.forEach(d => {
        const fx = fasts.indexOf(d.result.parameters.fastPeriod!);
        const sy = slows.indexOf(d.result.parameters.slowPeriod!);
        if (fx === -1 || sy === -1) return;

        // Swapped: Slow on X, Fast on Y
        const x = padL + sy * (chartW / slows.length);
        const y = padT + (fasts.length - 1 - fx) * (chartH / fasts.length);
        const cw = chartW / slows.length;
        const ch = chartH / fasts.length;

        ctx.fillStyle = getCellColor(d.result.metrics.totalReturnPct);
        ctx.fillRect(x, y, cw, ch);

        // Highlight best cell
        if (d === bestResult) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
          
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) / 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Labels
      ctx.fillStyle = chartTextDim;
      ctx.font = '10px sans-serif';

      // X axis (Slow SMA)
      slows.forEach((s, i) => {
        if (i % Math.ceil(slows.length / 10) === 0) {
          ctx.textAlign = 'center';
          const x = padL + i * (chartW / slows.length) + (chartW / slows.length) / 2;
          ctx.fillText(`${s}`, x, padT + chartH + 16);
        }
      });

      // Y axis (Fast SMA)
      fasts.forEach((f, i) => {
        if (i % Math.ceil(fasts.length / 10) === 0) {
          ctx.textAlign = isRtl ? 'left' : 'right';
          const y = padT + (fasts.length - 1 - i) * (chartH / fasts.length) + (chartH / fasts.length) / 2 + 4;
          ctx.fillText(`${f}`, isRtl ? W - padR + 8 : padL - 8, y);
        }
      });

      ctx.textAlign = 'center';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(t('Slow SMA Period'), padL + chartW / 2, padT + chartH + 36);
      ctx.save();
      ctx.translate(isRtl ? W - 10 : 16, padT + chartH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(t('Fast SMA Period'), 0, 0);
      ctx.restore();
    }
  }, [activeTab, autoResults, chartTab, language, t, themeRevision]);

  // ─── MANUAL: Run single backtest ───
  const runManual = useCallback(() => {
    if (!manualBacktestInputsValid) return;
    setBacktestError(false);
    setIsRunning(true);
    setSingleResult(null);
    setCompareResult(null);
    setAutoResults([]);
      setActiveTab('results');
    setTimeout(() => {
      try {
        setSingleResult(
          runBacktest(
            prices,
            dates,
            strategyAParameters,
            asset,
            effectiveVolumes,
          ),
        );

        // Strategy B (comparison mode)
        if (compareMode) {
          setCompareResult(
            runBacktest(
              prices,
              dates,
              strategyBParameters,
              asset,
              effectiveVolumes,
            ),
          );
        }
      } catch {
        setBacktestError(true);
      }
      setIsRunning(false);
    }, 50);
  }, [
    asset,
    compareMode,
    dates,
    effectiveVolumes,
    manualBacktestInputsValid,
    prices,
    strategyAParameters,
    strategyBParameters,
  ]);

  // ─── AUTO: Run exhaustive search ───
  const runAuto = useCallback(() => {
    if (!automaticBacktestInputsValid) return;
    setBacktestError(false);
    setIsRunning(true);
    setAutoResults([]);
    setSingleResult(null);
    setCompareResult(null);
    setStability(null);
    setActiveTab('results');
    setTimeout(() => {
      try {
        const results = runMultiOptimization(
          {
            asset,
            prices,
            dates,
            feePercent,
            feeMode,
            flatFeeAmount,
            quoteCurrency: displayCurrency,
            slippagePercent: slippage,
            initialCapital,
            intensity,
            step: 1,
            volumes: effectiveVolumes,
            interval,
          },
          (p) => setProgress(p),
        );
        setAutoResults(results);
        // Run stability analysis for MAX
        if (timePeriod === 'MAX' && prices.length > 730) {
          const report = runStabilityAnalysis(results, prices, dates, asset);
          setStability(report);
        }
      } catch {
        setBacktestError(true);
      } finally {
        setIsRunning(false);
      }
    }, 50);
  }, [
    asset,
    automaticBacktestInputsValid,
    dates,
    displayCurrency,
    effectiveVolumes,
    feeMode,
    feePercent,
    flatFeeAmount,
    initialCapital,
    intensity,
    prices,
    slippage,
    timePeriod,
  ]);

  useEffect(() => {
    if (autoResults.length === 0 || !prices || prices.length === 0) {
      setTopResultsFull([]);
      return;
    }

    // 1) Get Top 3
    const top3 = autoResults.slice(0, 3);
    const full3 = top3.map(r =>
      runBacktest(
        prices,
        dates,
        r.result.parameters,
        asset,
        effectiveVolumes,
      ),
    );
    setTopResultsFull(full3);
  }, [autoResults, prices, dates, asset, effectiveVolumes]);

  // ─── TAG STYLING ───
  const tagStyle = (tag: CategoryTag): { bg: string; color: string } => {
    switch (tag) {
      case 'best_overall': return { bg: 'var(--accent-teal-dim)', color: 'var(--series-crypto)' };
      case 'best_return': return { bg: 'var(--green-dim)', color: 'var(--green)' };
      case 'best_winrate': return { bg: 'var(--accent-blue-dim)', color: 'var(--series-market)' };
      case 'best_risk': return { bg: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' };
      case 'best_sharpe': return { bg: 'var(--yellow-dim)', color: 'var(--yellow)' };
      case 'best_sma_only': return { bg: 'var(--accent-blue-dim)', color: 'var(--series-market)' };
      case 'best_dual_sma': return { bg: 'var(--accent-teal-dim)', color: 'var(--series-crypto)' };
      default: return { bg: 'var(--surface-accent-soft)', color: 'var(--text-secondary)' };
    }
  };

  const sortedResults = useMemo(() => {
    const items = autoResults.map((item, index) => ({ item, rank: index + 1 }));
    if (sortConfig !== null) {
      items.sort((a, b) => {
        let aVal: number | string = 0;
        let bVal: number | string = 0;
        const m1 = a.item.result.metrics;
        const m2 = b.item.result.metrics;

        switch (sortConfig.key) {
          case 'rank': aVal = a.rank; bVal = b.rank; break;
          case 'strategy': aVal = a.item.strategyLabel; bVal = b.item.strategyLabel; break;
          case 'trades': aVal = m1.totalTrades; bVal = m2.totalTrades; break;
          case 'win%': aVal = m1.winRate; bVal = m2.winRate; break;
          case 'return': aVal = m1.totalReturnPct; bVal = m2.totalReturnPct; break;
          case 'annualReturn': aVal = m1.annualizedReturnPct; bVal = m2.annualizedReturnPct; break;
          case 'endCapital': aVal = a.item.endCapital; bVal = b.item.endCapital; break;
          case 'avgGain': aVal = m1.avgGainPerTrade; bVal = m2.avgGainPerTrade; break;
          case 'volatility': aVal = m1.volatility; bVal = m2.volatility; break;
          case 'maxDD': aVal = m1.maxDrawdownPct; bVal = m2.maxDrawdownPct; break;
          case 'sharpe': aVal = m1.sharpeRatio; bVal = m2.sharpeRatio; break;
          case 'vsBH': aVal = m1.totalReturnPct - m1.buyHoldReturnPct; bVal = m2.totalReturnPct - m2.buyHoldReturnPct; break;
          case 'robust': 
            const rm1 = a.item.robustnessFlag === 'robust' ? 3 : a.item.robustnessFlag === 'possibly_overfit' ? 2 : 1;
            const rm2 = b.item.robustnessFlag === 'robust' ? 3 : b.item.robustnessFlag === 'possibly_overfit' ? 2 : 1;
            aVal = rm1; bVal = rm2; break;
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [autoResults, sortConfig]);

  const bestAutoResultByReturn = useMemo(() => {
    if (autoResults.length === 0) return null;
    return autoResults.reduce((best, current) =>
      current.result.metrics.totalReturnPct > best.result.metrics.totalReturnPct ? current : best,
    );
  }, [autoResults]);

  const autoVsBuyHoldInsight = useMemo(() => {
    if (!bestAutoResultByReturn) return null;

    const buyHoldReturn = bestAutoResultByReturn.result.metrics.buyHoldReturnPct;
    const bestStrategyReturn = bestAutoResultByReturn.result.metrics.totalReturnPct;

    return {
      bestLabel: bestAutoResultByReturn.strategyLabel,
      buyHoldReturn,
      bestStrategyReturn,
      deltaPct: bestStrategyReturn - buyHoldReturn,
      leader: bestStrategyReturn < buyHoldReturn ? 'buyHold' : bestStrategyReturn > buyHoldReturn ? 'strategy' : 'tie',
      buyHoldBeatsAll: autoResults.every(
        (entry) => entry.result.metrics.totalReturnPct < entry.result.metrics.buyHoldReturnPct,
      ),
    };
  }, [autoResults, bestAutoResultByReturn]);

  const bestSingleSmaResult = useMemo(() => {
    const singleSmaResults = autoResults.filter((entry) => entry.result.parameters.strategyType === 'single_sma');
    if (singleSmaResults.length === 0) return null;

    return singleSmaResults.reduce((best, current) =>
      current.result.metrics.totalReturnPct > best.result.metrics.totalReturnPct ? current : best,
    );
  }, [autoResults]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (key === 'rank' || key === 'maxDD' || key === 'volatility' || key === 'strategy') direction = 'asc';
    if (sortConfig && sortConfig.key === key) direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) return <ChevronsUpDown size={12} style={{ marginLeft: 4, opacity: 0.5 }} />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={12} style={{ marginLeft: 4 }} /> : <ChevronDown size={12} style={{ marginLeft: 4 }} />;
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const renderIndicatorPanel = (
    label: string,
    borderColor: string,
    s: {
      useSma: boolean; setUseSma: (v: boolean) => void;
      smaPeriod: number; setSmaPeriod: (v: number) => void;
      dualSma: boolean; setDualSma: (v: boolean) => void;
      fastPeriod: number; setFastPeriod: (v: number) => void;
      slowPeriod: number; setSlowPeriod: (v: number) => void;
    }
  ) => (
    <div>
      <h4 style={{ marginBottom: 12, borderLeft: `3px solid ${borderColor}`, paddingLeft: 10, fontWeight: 600 }}>{label}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* SMA */}
        <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: s.useSma ? '1px solid var(--accent-blue)' : '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={s.useSma} onChange={e => s.setUseSma(e.target.checked)} /> {t('SMA (Simple Moving Average)')}
          </label>
          {s.useSma && (<>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" checked={s.dualSma} onChange={e => s.setDualSma(e.target.checked)} /> {t('Dual SMA (Golden/Death Cross)')}
            </label>
            {s.dualSma ? (
              <div className="grid-2">
                <div><label className="label">{t('Fast')}</label><input className="input" type="number" min={2} value={s.fastPeriod} onChange={e => s.setFastPeriod(Number(e.target.value))} /></div>
                <div><label className="label">{t('Slow')}</label><input className="input" type="number" min={2} value={s.slowPeriod} onChange={e => s.setSlowPeriod(Number(e.target.value))} /></div>
              </div>
            ) : (
              <div><label className="label">{t('SMA Periode')}</label><input className="input" type="number" min={2} value={s.smaPeriod} onChange={e => s.setSmaPeriod(Number(e.target.value))} /></div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="page-title">
            <FlaskConical size={24} style={{ display: 'inline', marginRight: 8 }} />
            {t('Strategies')}
          </h1>
        </div>

        <div className="tabs">
          <button className={`tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>{t('Configuration')}</button>
          <button className={`tab ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>{t('Results')} {autoResults.length > 0 ? `(${autoResults.length})` : singleResult ? '(1)' : ''}</button>
          <button className={`tab ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>{t('Export')}</button>
        </div>
      </div>

      <div className="page-content animate-in">
        <PageQuickStart
          description={t('This page is advanced. Use it when you want to test a strategy idea, not for everyday portfolio checking.')}
          steps={[
            t('Pick one asset and one time range first.'),
            t('Run a simple backtest before trying optimization or stability analysis.'),
            t('Compare the strategy result with buy-and-hold before changing anything important.'),
          ]}
          note={t('If you are just tracking investments, you can ignore this page.')}
        />

        {/* ═══════ CONFIG TAB ═══════ */}
        {activeTab === 'config' && (
          <div className="grid-2">
            {/* Left: Mode & Asset */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 16 }}>{t('Analysis Mode')}</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                <button className={`btn ${analysisMode === 'auto' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAnalysisMode('auto')} style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <Zap size={16} /> {t('Fully Automatic')}
                </button>
                <button className={`btn ${analysisMode === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAnalysisMode('manual')} style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <Settings2 size={16} /> {t('Manual')}
                </button>
              </div>

              <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('Asset Class')}</label>
                  <select
                    className="select"
                    value={assetClassFilter}
                    onChange={e => {
                      const nextClass = e.target.value as AssetClass;
                      const nextAssets = getSupportedAssetsByClass(nextClass);
                      setAssetClassFilter(nextClass);
                      if (nextAssets.length > 0) {
                        setAsset(nextAssets[0].symbol);
                      }
                    }}
                  >
                    {ASSET_CLASS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('Asset')}</label>
                  <select className="select" value={asset} onChange={e => setAsset(e.target.value)}>
                    {availableAssets.map(assetOption => (
                      <option key={assetOption.symbol} value={assetOption.symbol}>
                        {assetOption.symbol} — {assetOption.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('Currency')}</label>
                  <select className="select" style={{ width: 120 }} value={displayCurrency} disabled>
                    <option value="eur">{t('EUR (€)')}</option>
                  </select>
                </div>
              </div>

              {selectedAssetConfig && (
                <div className="asset-factor-panel">
                  <div className="asset-factor-header">
                    <div>
                      <div className="section-title">{selectedAssetConfig.name}</div>
                      <div className="panel-subtitle">
                        {getAssetFactorSummary(selectedAssetConfig.assetClass, t).label} · {getAssetFactorSummary(selectedAssetConfig.assetClass, t).note}
                      </div>
                    </div>
                    <span className="badge badge-blue">
                      {selectedAssetConfig.assetClass === 'crypto'
                        ? t('Crypto')
                        : selectedAssetConfig.assetClass === 'stock'
                        ? t('Stock')
                        : selectedAssetConfig.assetClass === 'etf'
                        ? t('ETF')
                        : t('Metal')}
                    </span>
                  </div>
                  <div className="asset-factor-pills">
                    {getAssetFactorSummary(selectedAssetConfig.assetClass, t).factors.map((factor) => (
                      <span key={factor} className="asset-factor-pill">
                        {factor}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label className="label">{t('Period')}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['1Y','2Y','5Y','10Y','MAX'] as TimePeriod[]).map(p => (
                    <button key={p} className={`btn ${timePeriod === p ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, padding: '6px 4px', fontSize: 12 }} 
                      onClick={() => { setTimePeriod(p); setAutoResults([]); setSingleResult(null); setCompareResult(null); }}>
                      {p === 'MAX' ? t('Max + Stability') : p}
                    </button>
                  ))}
                </div>
                {timePeriod === 'MAX' && <div style={{ fontSize: 11, color: 'var(--accent-teal)', marginTop: 6 }}>{t('Includes automatic segment analysis for strategy stability.')}</div>}
              </div>

              <div className="grid-2" style={{ marginBottom: 14 }}>
                <div><label className="label">{t(`Initial Capital (${currencySymbol})`)}</label><input className="input" type="number" min={1} max={1_000_000_000} value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} /></div>
                <div><label className="label">{t('Slippage (%)')}</label><input className="input" type="number" min={0} max={10} step={0.01} value={slippage} onChange={e => setSlippage(Number(e.target.value))} /></div>
              </div>
              <div className="grid-2" style={{ marginBottom: 14 }}>
                <div>
                  <label className="label">{t('Fee Model')}</label>
                  <select className="select" value={feeMode} onChange={e => setFeeMode(e.target.value as 'percent' | 'flat')}>
                    <option value="percent">{t('Percent of trade value')}</option>
                    <option value="flat">{t('Fixed broker ticket')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">
                    {feeMode === 'percent' ? t('Fee per Trade (%)') : t('Fixed Fee per Order')}
                  </label>
                  {feeMode === 'percent' ? (
                    <input className="input" type="number" min={0} max={10} step={0.01} value={feePercent} onChange={e => setFeePercent(Number(e.target.value))} />
                  ) : (
                    <input className="input" type="number" min={0} max={1_000_000} step={0.01} value={flatFeeAmount} onChange={e => setFlatFeeAmount(Number(e.target.value))} />
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('Cost model active: {summary}. Use percentage fees for exchanges and flat ticket fees for brokers like Trade Republic or IBKR.').replace('{summary}', t(costModelSummary))}
              </div>

              {analysisMode === 'auto' && (
                <div style={{ marginTop: 16 }}>
                  <label className="label">{t('Search Intensity')}</label>
                  <select className="select" value={intensity} onChange={e => setIntensity(e.target.value as typeof intensity)}>
                    <option value="fast">{t(`Fast (~${estimateCombinations('fast')} combinations)`)}</option>
                    <option value="normal">{t(`Normal (~${estimateCombinations('normal')} combinations)`)}</option>
                    <option value="thorough">{t(`Thorough (~${estimateCombinations('thorough')} combinations)`)}</option>
                  </select>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {t('Automatically tests: SMA and Dual SMA cross-overs with various parameters.')}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                  onClick={analysisMode === 'auto' ? runAuto : runManual}
                  disabled={isRunning || !canRunBacktest}>
                  <PlayCircle size={18} />
                  {isRunning ? t('Running...') : loadingHistory ? t('Loading Data...') :
                    analysisMode === 'auto' ? t(`Start Full Analysis (~${estCount} strategies)`) : t('Start Backtest')}
                </button>
                {!loadingHistory && prices.length === 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-error)', border: '1px solid var(--surface-error-border)', color: 'var(--red)', fontSize: 12 }}>
                    {t('No data loaded. Try picking a different asset.')}
                  </div>
                )}
                {!loadingHistory && prices.length > 0 && (historyTrustState === 'stale' || historyTrustState === 'partial') && (
                  <div className="callout warn" style={{ marginTop: 8, fontSize: 12 }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      {historyTrustState === 'stale'
                        ? t('Cached history is temporarily shown because live providers are unavailable. It may be up to 24 hours old.')
                        : t('Historical data is partial. Some periods or fields may be unavailable.')}
                    </div>
                  </div>
                )}
                {!loadingHistory && prices.length > 0 && !canRunBacktest && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-error)', border: '1px solid var(--surface-error-border)', color: 'var(--red)', fontSize: 12 }}>
                    {t('Enter valid backtest inputs. Capital must be positive, costs must stay within the displayed limits, and price dates must be unique and ordered.')}
                  </div>
                )}
                {backtestError && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-error)', border: '1px solid var(--surface-error-border)', color: 'var(--red)', fontSize: 12 }}>
                    {t('The backtest could not be completed with the selected inputs.')}
                  </div>
                )}
              </div>

              {isRunning && progress && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{progress.currentParams} • {progress.completed}/{progress.total}</div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
                </div>
              )}
            </div>

            {/* Right: Manual Config (only in manual mode) */}
            {analysisMode === 'manual' && (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 className="section-title" style={{ margin: 0 }}>{t('Select Indicators')}</h3>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={compareMode} onChange={e => { setCompareMode(e.target.checked); setCompareResult(null); }} />
                    {t('Comparison Mode (A vs B)')}
                  </label>
                </div>

                {compareMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {renderIndicatorPanel(t('Strategy A'), 'var(--series-crypto)', {
                      useSma, setUseSma, smaPeriod, setSmaPeriod, dualSma, setDualSma,
                      fastPeriod, setFastPeriod, slowPeriod, setSlowPeriod,
                    })}
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                    {renderIndicatorPanel(t('Strategy B'), 'var(--series-market)', {
                      useSma: useSmaB, setUseSma: setUseSmaB, smaPeriod: smaPeriodB, setSmaPeriod: setSmaPeriodB,
                      dualSma: dualSmaB, setDualSma: setDualSmaB,
                      fastPeriod: fastPeriodB, setFastPeriod: setFastPeriodB, slowPeriod: slowPeriodB, setSlowPeriod: setSlowPeriodB,
                    })}
                  </div>
                ) : (
                  renderIndicatorPanel(t('Indicators'), 'var(--accent-teal)', {
                    useSma, setUseSma, smaPeriod, setSmaPeriod, dualSma, setDualSma,
                    fastPeriod, setFastPeriod, slowPeriod, setSlowPeriod,
                  })
                )}
              </div>
            )}



            {/* Right: Auto mode info card */}
            {analysisMode === 'auto' && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 32 }}>
                <Zap size={48} style={{ color: 'var(--accent-teal)', marginBottom: 16 }} />
                <h3 style={{ marginBottom: 8 }}>{t('Fully Automatic Analysis')}</h3>
                <p suppressHydrationWarning style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 400, lineHeight: 1.6 }}>
                  {t('The software systematically tests ~{count} strategy combinations of SMA and Dual SMA cross-overs with various parameters.').replace('{count}', estCount.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US'))}
                  {t('Afterwards, a complete ranking highlighting the best strategies is generated.')}
                </p>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {['SMA only', 'Dual SMA'].map(c => (
                    <span key={c} className="badge badge-teal" style={{ fontSize: 11 }}>{t(c)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════ RESULTS TAB ═══════ */}
        {activeTab === 'results' && (
          <>
            {isRunning && (
              <div className="loading-overlay"><div className="spinner" />{progress ? `${progress.completed}/${progress.total} — ${progress.currentParams}` : t('Analysis running...')}</div>
            )}

            {/* Manual Result(s) */}
            {singleResult && !isRunning && (
              <div>
                {/* Banner + Pine Script buttons */}
                <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {compareMode && compareResult
                      ? <>{t('Strategy Comparison')}: <strong>{asset}</strong> &bull; {singleResult.startDate} &rarr; {singleResult.endDate} &bull; {t('Initial Capital')}: {initialCapital} {currencySymbol}</>
                      : <>{t('Manual Backtest')}: <strong>{asset}</strong> &bull; {singleResult.startDate} &rarr; {singleResult.endDate} &bull; {t('Initial Capital')}: {initialCapital} {currencySymbol}</>
                    }
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => downloadPineScript(singleResult.parameters, singleResult, compareMode ? 'Strategy_A' : 'Strategy')}>
                      <TrendingUp size={14} /> {t('Pine Script')} {compareMode ? '(A)' : ''}
                    </button>
                    {compareMode && compareResult && (
                      <button className="btn btn-secondary" style={{ fontSize: 12 }}
                        onClick={() => downloadPineScript(compareResult.parameters, compareResult, 'Strategy_B')}>
                        <TrendingUp size={14} /> {t('Pine Script')} (B)
                      </button>
                    )}
                  </div>
                </div>

                {/* Equity Chart */}
                <div className="card" style={{ marginBottom: 20, padding: 0 }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                    <TrendingUp size={16} style={{ display: 'inline', marginRight: 6 }} />
                    {t('Equity Curve')} {compareMode && compareResult ? t('(A vs B vs Buy & Hold)') : t('(Strategy vs Buy & Hold)')}
                  </div>
                  <div style={{ height: 400, padding: 16, overflow: 'hidden' }}>
                    <InteractiveEquityChart
                      dates={dates}
                      series={manualEquitySeries}
                      currencySymbol={currencySymbol}
                      referenceValue={initialCapital}
                    />
                  </div>
                </div>

                {/* Metrics Table */}
                {compareMode && compareResult ? (
                  <ComparisonMetricsTable resultA={singleResult} resultB={compareResult} initialCapital={initialCapital} currency={displayCurrency} />
                ) : (
                  <DetailedMetricsTable result={singleResult} initialCapital={initialCapital} currency={displayCurrency} buyHoldMetrics={buyHoldMetrics} asset={asset} />
                )}

                {/* Trades Strategy A */}
                {singleResult.trades.length > 0 && (
                  <div className="card" style={{ padding: 0, marginTop: 16 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                      {compareMode ? t('Trades Strategy A') : t('Simulated Trades')} ({singleResult.trades.length})
                    </div>
                    <div className="table-container" style={{ border: 'none' }}>
                      <table><thead><tr><th>#</th><th>{t('Entry')}</th><th>{t('Price')}</th><th>{t('Exit')}</th><th>{t('Price')}</th><th>{t('Fees')}</th><th>{t('P&L')}</th><th>{t('P&L %')}</th><th>{t('Days')}</th></tr></thead>
                        <tbody>{singleResult.trades.slice(0, 30).map((t_trade, i) => (
                          <tr key={i}><td className="mono">{i + 1}</td><td className="mono">{t_trade.entryDate}</td><td className="mono">{currencySymbol}{t_trade.entryPrice.toFixed(2)}</td><td className="mono">{t_trade.exitDate}</td><td className="mono">{currencySymbol}{t_trade.exitPrice.toFixed(2)}</td>
                            <td className="mono">{currencySymbol}{t_trade.totalFeesPaid.toFixed(2)}</td>
                            <td className="mono" style={{ color: t_trade.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{t_trade.profit >= 0 ? '+' : ''}{currencySymbol}{t_trade.profit.toFixed(2)}</td>
                            <td><span className={`badge ${t_trade.profitPercent >= 0 ? 'badge-green' : 'badge-red'}`}>{t_trade.profitPercent >= 0 ? '+' : ''}{t_trade.profitPercent.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></td>
                            <td className="mono">{t_trade.holdingBars}</td></tr>
                        ))}</tbody></table>
                    </div>
                  </div>
                )}

                {/* Trades Strategy B */}
                {compareMode && compareResult && compareResult.trades.length > 0 && (
                  <div className="card" style={{ padding: 0, marginTop: 16 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                      {t('Trades Strategy B')} ({compareResult.trades.length})
                    </div>
                    <div className="table-container" style={{ border: 'none' }}>
                      <table><thead><tr><th>#</th><th>{t('Entry')}</th><th>{t('Price')}</th><th>{t('Exit')}</th><th>{t('Price')}</th><th>{t('Fees')}</th><th>{t('P&L')}</th><th>{t('P&L %')}</th><th>{t('Days')}</th></tr></thead>
                        <tbody>{compareResult.trades.slice(0, 30).map((t_trade, i) => (
                          <tr key={i}><td className="mono">{i + 1}</td><td className="mono">{t_trade.entryDate}</td><td className="mono">{currencySymbol}{t_trade.entryPrice.toFixed(2)}</td><td className="mono">{t_trade.exitDate}</td><td className="mono">{currencySymbol}{t_trade.exitPrice.toFixed(2)}</td>
                            <td className="mono">{currencySymbol}{t_trade.totalFeesPaid.toFixed(2)}</td>
                            <td className="mono" style={{ color: t_trade.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{t_trade.profit >= 0 ? '+' : ''}{currencySymbol}{t_trade.profit.toFixed(2)}</td>
                            <td><span className={`badge ${t_trade.profitPercent >= 0 ? 'badge-green' : 'badge-red'}`}>{t_trade.profitPercent >= 0 ? '+' : ''}{t_trade.profitPercent.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></td>
                            <td className="mono">{t_trade.holdingBars}</td></tr>
                        ))}</tbody></table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Auto Results Table */}
            {autoResults.length > 0 && !isRunning && (
              <div>
                {/* Summary Cards */}
                <div className="grid-4" style={{ marginBottom: 20 }}>
                  <MC label={t('Tested Strategies')} value={`${autoResults.length}`} color="var(--accent-teal)" />
                  <MC label={t('🏆 Best Return')} value={`${autoResults.reduce((b, r) => r.result.metrics.totalReturnPct > b ? r.result.metrics.totalReturnPct : b, -Infinity).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`} color="var(--green)" sub={`${initialCapital} ${currencySymbol} → ${autoResults[0]?.endCapital.toFixed(0)} ${currencySymbol}`} />
                  <MC label={t('Best Win Rate')} value={`${Math.max(...autoResults.filter(r => r.result.metrics.totalTrades >= 3).map(r => r.result.metrics.winRate)).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`} color="var(--accent-blue)" />
                  <MC label={t('Lowest Max DD')} value={`-${Math.min(...autoResults.filter(r => r.result.metrics.totalTrades >= 3).map(r => r.result.metrics.maxDrawdownPct)).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`} color="var(--accent-cyan)" />
                </div>

                {/* Winner highlight */}
                {autoResults[0] && (
                  <div className="card" style={{ marginBottom: 20, border: '1px solid var(--accent-teal)', background: 'var(--surface-accent-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--accent-teal)', fontWeight: 700, marginBottom: 4 }}>{t('🏆 BEST STRATEGY')}</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{autoResults[0].strategyLabel}</div>
                        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                          {' '}{t('Return')}: {autoResults[0].result.metrics.totalReturnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% •
                          {' '}{t('Max DD')}: -{autoResults[0].result.metrics.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {autoResults[0].categoryTags.map(tag => {
                          const s = tagStyle(tag);
                          return <span key={tag} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>{getTagLabel(tag, t)}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Chart Comparison */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <div className="panel-header strategy-chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="section-title">
                        {chartTab === 'equity' ? t('Strategy Paths') : 
                         chartTab === 'sma_landscape' ? t('SMA Parameter Landscape') : 
                         chartTab === 'sma_heatmap' ? t('Optimization Heatmap') : 
                         t('Monthly return heatmap')}
                      </div>
                      <div className="panel-subtitle">
                        {chartTab === 'equity'
                          ? t('Compare the top tested strategies against the passive buy-and-hold baseline.')
                          : chartTab === 'monthly_heatmap'
                          ? t('A compact calendar view for quick up/down month checks of the best strategy.')
                          : t('See how different parameter configurations performed across the asset history.')}
                      </div>
                    </div>


                    <div className="strategy-chart-tabs" role="tablist" aria-label={t('Strategy chart view')}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chartTab === 'equity'}
                        className={`strategy-chart-tab ${chartTab === 'equity' ? 'active' : ''}`}
                        onClick={() => setChartTab('equity')}
                      >
                        <TrendingUp size={16} />
                        {t('Equity Curve')}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chartTab === 'sma_landscape'}
                        className={`strategy-chart-tab ${chartTab === 'sma_landscape' ? 'active' : ''}`}
                        onClick={() => setChartTab('sma_landscape')}
                      >
                        <BarChart3 size={16} />
                        {t('SMA Landscape')}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chartTab === 'sma_heatmap'}
                        className={`strategy-chart-tab ${chartTab === 'sma_heatmap' ? 'active' : ''}`}
                        onClick={() => setChartTab('sma_heatmap')}
                      >
                        <Zap size={16} />
                        {t('Optimization Heatmap')}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chartTab === 'monthly_heatmap'}
                        className={`strategy-chart-tab ${chartTab === 'monthly_heatmap' ? 'active' : ''}`}
                        onClick={() => setChartTab('monthly_heatmap')}
                      >
                        <LayoutGrid size={16} />
                        {t('Monthly Returns')}
                      </button>
                    </div>
                  </div>

                  {autoVsBuyHoldInsight ? (
                    <div
                      className={`callout ${
                        autoVsBuyHoldInsight.leader === 'buyHold'
                          ? 'warn'
                          : autoVsBuyHoldInsight.leader === 'strategy'
                          ? 'success'
                          : 'neutral'
                      }`}
                      style={{ marginTop: 18 }}
                    >
                      {autoVsBuyHoldInsight.leader === 'buyHold' ? (
                        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      ) : (
                        <TrendingUp size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      )}
                      <div>
                        {autoVsBuyHoldInsight.leader === 'buyHold' ? (
                          <>
                            <strong>{t('Buy & Hold outperformed every tested SMA strategy.')}</strong> {t('Best tested result')}:{' '}
                            {autoVsBuyHoldInsight.bestStrategyReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% {t('from')} {autoVsBuyHoldInsight.bestLabel},
                            {t('while Buy & Hold finished at')} {autoVsBuyHoldInsight.buyHoldReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%.
                          </>
                        ) : autoVsBuyHoldInsight.leader === 'tie' ? (
                          <>
                            <strong>{t('The best tested strategy only matched Buy & Hold.')}</strong> {t('Both ended near')}{' '}
                            {autoVsBuyHoldInsight.buyHoldReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% {t('over the same period.')}
                          </>
                        ) : (
                          <>
                            <strong>{t(autoVsBuyHoldInsight.bestLabel)} {t('improved on Buy & Hold.')}</strong>{' '}
                            {t('The best tested strategy is ahead by')} {autoVsBuyHoldInsight.deltaPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t('percentage points over the same period.')}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="summary-strip" style={{ marginTop: 18 }}>
                    <div className="summary-item">
                      <span>{t('Best Strategy')}</span>
                      <strong title={autoVsBuyHoldInsight?.bestLabel}>{autoVsBuyHoldInsight?.bestLabel ?? '—'}</strong>
                    </div>
                    <div className="summary-item">
                      <span>{t('Best Return')}</span>
                      <strong>
                        {autoVsBuyHoldInsight
                          ? `${autoVsBuyHoldInsight.bestStrategyReturn >= 0 ? '+' : ''}${autoVsBuyHoldInsight.bestStrategyReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                          : '—'}
                      </strong>
                    </div>
                    <div className="summary-item">
                      <span>{t('Buy & Hold')}</span>
                      <strong>
                        {autoVsBuyHoldInsight
                          ? `${autoVsBuyHoldInsight.buyHoldReturn >= 0 ? '+' : ''}${autoVsBuyHoldInsight.buyHoldReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                          : '—'}
                      </strong>
                    </div>
                    <div className="summary-item">
                      <span>{t('Gap vs Buy & Hold')}</span>
                      <strong
                        style={{
                          color:
                            autoVsBuyHoldInsight && autoVsBuyHoldInsight.deltaPct >= 0
                              ? 'var(--green)'
                              : 'var(--red)',
                        }}
                      >
                        {autoVsBuyHoldInsight
                          ? `${autoVsBuyHoldInsight.deltaPct >= 0 ? '+' : ''}${autoVsBuyHoldInsight.deltaPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pp`
                          : '—'}
                      </strong>
                    </div>
                    {chartTab === 'equity' && (
                      <div className="summary-item">
                        <span>{t('Stability')}</span>
                        <strong
                          style={{
                            color:
                              stability?.stabilityScores[0]?.stabilityFlag === 'stable'
                                ? 'var(--green)'
                                : stability?.stabilityScores[0]?.stabilityFlag === 'mixed'
                                ? 'var(--yellow)'
                                : 'var(--text-muted)',
                          }}
                        >
                          {stability?.stabilityScores[0]
                            ? stability.stabilityScores[0].stabilityFlag === 'regime_dependent'
                              ? t('Regime dependent')
                              : stability.stabilityScores[0].stabilityFlag === 'mixed'
                              ? t('Mixed')
                              : t('Stable')
                            : timePeriod === 'MAX'
                            ? t('Standard')
                            : t('Use MAX')}
                        </strong>
                      </div>
                    )}
                  </div>

                  <div className={`strategy-chart-panel ${chartTab === 'equity' ? 'is-equity' : 'is-landscape'}`}>
                    {chartTab === 'equity' ? (
                      <InteractiveEquityChart
                        dates={dates}
                        series={autoEquitySeries}
                        currencySymbol={currencySymbol}
                        referenceValue={initialCapital}
                      />
                    ) : chartTab === 'monthly_heatmap' ? (
                      <div className="return-heatmap" style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 8px' }}>
                        {groupedMonthlyReturns.map(([year, months]) => (
                          <div key={year} className="return-heatmap-year" style={{ marginBottom: 16 }}>
                            <div className="return-heatmap-year-label" style={{ minWidth: 80 }}>
                              <strong style={{ fontSize: 16 }}>{year}</strong>
                            </div>
                            <div className="return-heatmap-cells" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, flex: 1 }}>
                              {months.map((ret, idx) => {
                                const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx];
                                const intensity = ret === null ? 0 : Math.min(1, Math.abs(ret / 15));
                                const background = ret === null ? 'var(--surface-softer)' : 
                                                  ret >= 0 ? `rgba(52, 211, 153, ${0.1 + intensity * 0.4})` : 
                                                  `rgba(251, 113, 133, ${0.1 + intensity * 0.4})`;
                                return (
                                  <div key={monthName} className="return-heatmap-cell" style={{ background, padding: '8px 4px', borderRadius: 8, textAlign: 'center', minWidth: 0, border: '1px solid var(--surface-border-soft)' }}>
                                    <span style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.6, display: 'block', marginBottom: 2 }}>{t(monthName)}</span>
                                    <strong style={{ fontSize: 11, color: ret === null ? 'var(--text-muted)' : ret >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                      {ret === null ? '—' : `${ret > 0 ? '+' : ''}${ret.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                                    </strong>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {chartTab === 'sma_heatmap' && (
                          <div style={{ position: 'absolute', top: 6, left: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', padding: '4px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Step size')}:</span>
                            {[1, 2, 5].map((s) => (
                              <button
                                key={s}
                                onClick={() => setOptStep(s)}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: 'none',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  background: optStep === s ? 'var(--accent-teal)' : 'transparent',
                                  color: optStep === s ? '#fff' : 'var(--text-muted)',
                                }}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                        <canvas ref={chartRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Performance Comparison Section */}
                {topResultsFull.length > 0 && (
                  <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--surface-border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        <TrendingUp size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--accent-teal)' }} />
                        {t('Top Strategy Comparison')}
                      </div>
                    </div>

                    <div style={{ padding: 20 }}>
                      <DetailedMetricsTable 
                        results={topResultsFull} 
                        initialCapital={initialCapital} 
                        currency={displayCurrency}
                        buyHoldMetrics={buyHoldMetrics}
                        asset={asset}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!singleResult && autoResults.length === 0 && !isRunning && (
              <div className="loading-overlay"><FlaskConical size={24} />{t('Configure and start an analysis')}</div>
            )}
          </>
        )}

        {/* ═══════ EXPORT TAB ═══════ */}
        {activeTab === 'export' && (
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{t('Export Results')}</h3>
            {autoResults.length > 0 || singleResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {autoResults.length > 0
                    ? t('{count} strategies for {asset} ready for export.').replace('{count}', String(autoResults.length)).replace('{asset}', asset)
                    : compareMode && compareResult
                      ? t('Strategy Comparison (A vs B) ready for export.')
                      : t('Single backtest result ready for export.')}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {autoResults.length > 0 && (
                    <>
                      <button className="btn btn-primary" onClick={() => exportResultsToCSV(autoResults, asset, initialCapital, t)}>
                        <Download size={16} /> {t('Download Excel / CSV')}
                      </button>
                      <button className="btn btn-secondary" onClick={() => exportResultsToPDF(autoResults, asset, initialCapital, t)}>
                        <Download size={16} /> {t('Print PDF Report')}
                      </button>
                      <button className="btn btn-secondary" onClick={() => downloadPineScript(autoResults[0].result.parameters, autoResults[0].result, autoResults[0].strategyLabel)}>
                        <TrendingUp size={16} /> {t('Pine Script (Top Strategy)')}
                      </button>
                    </>
                  )}
                  {singleResult && (
                    <>
                      <button className="btn btn-primary" onClick={() => downloadPineScript(singleResult.parameters, singleResult, compareMode ? 'Strategy_A' : 'Strategy')}>
                        <TrendingUp size={16} /> {t('TradingView Pine Script')} {compareMode && compareResult ? '(Strategy A)' : ''}
                      </button>
                      {compareMode && compareResult && (
                        <button className="btn btn-primary" onClick={() => downloadPineScript(compareResult.parameters, compareResult, 'Strategy_B')}>
                          <TrendingUp size={16} /> {t('TradingView Pine Script (Strategy B)')}
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {autoResults.length > 0
                    ? t('CSV export contains all {count} strategies with all metrics and badges. PDF opens print preview. Pine Script exports the best strategy as TradingView code.').replace('{count}', String(autoResults.length))
                    : t('Pine Script exports the strategy as TradingView-compatible code with buy/sell signals.')}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>{t('No data loaded. Try 1D or pick a different asset.')}</div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function MC({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div className="card-title">{label}</div>
      <div className="card-value" style={{ fontSize: 20, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
