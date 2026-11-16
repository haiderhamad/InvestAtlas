'use client';

import IndicatorBar from '@/components/ai/indicator-bar';
import ScoreGauge from '@/components/ai/score-gauge';
import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import { calculateMACD } from '@/lib/indicators/macd';
import { calculateRSI } from '@/lib/indicators/rsi';
import { calculateSMA } from '@/lib/indicators/sma';
import {
  AI_ANALYSIS_STORAGE_KEY,
  parseStoredAnalysis,
  type StoredAnalysisEntry,
} from '@/lib/ai/analysis-cache';
import {
  ASSET_CLASS_OPTIONS,
  getSupportedAssetsByClass,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { getFirebaseAuthHeaders } from '@/lib/auth/firebase-api-auth';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';
import { isHistoryUsableForAi } from '@/lib/financial-data/history/trust';

type AnalysisEntry = StoredAnalysisEntry;

const qualityBadgeClass: Record<AnalysisEntry['signalQuality'], string> = {
  strong: 'badge-green',
  moderate: 'badge-yellow',
  weak: 'badge-red',
};

const trendBadgeClass: Record<AnalysisEntry['trendDirection'], string> = {
  bullish: 'badge-green',
  bearish: 'badge-red',
  neutral: 'badge-blue',
  uncertain: 'badge-yellow',
};

const postureBadgeClass: Record<AnalysisEntry['technicalPosture'], string> = {
  positive: 'badge-green',
  neutral: 'badge-blue',
  negative: 'badge-red',
  uncertain: 'badge-yellow',
};

const postureLabel: Record<AnalysisEntry['technicalPosture'], string> = {
  positive: 'Positive technical posture',
  neutral: 'Neutral technical posture',
  negative: 'Negative technical posture',
  uncertain: 'Uncertain technical posture',
};

const AI_CURRENCY_OPTIONS = [
  { value: 'eur', label: 'EUR (€)' },
  { value: 'usd', label: 'USD ($)' },
] as const;

function readStoredAnalysis(): AnalysisEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = readWorkspaceStorageItem(AI_ANALYSIS_STORAGE_KEY);
    if (!raw) return null;
    return parseStoredAnalysis(raw);
  } catch {
    return null;
  }
}

function writeStoredAnalysis(entry: AnalysisEntry) {
  if (typeof window === 'undefined') return;
  writeWorkspaceStorageItem(AI_ANALYSIS_STORAGE_KEY, JSON.stringify(entry));
}

export default function AIAnalysisPage() {
  const { t, language } = useAppTranslation();
  const { user } = useAuth();
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [selectedAssetClass, setSelectedAssetClass] = useState<AssetClass>('crypto');
  const [currency, setCurrency] = useState<'eur' | 'usd'>('eur');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const availableAssets = useMemo(
    () => getSupportedAssetsByClass(selectedAssetClass),
    [selectedAssetClass],
  );

  useEffect(() => {
    setMounted(true);
    const stored = readStoredAnalysis();
    if (stored) setCurrentAnalysis(stored);
  }, []);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const historyResponse = await fetchFinancialData(`/api/prices/history?symbol=${selectedAsset}&currency=${currency}`);
      const historyData = await historyResponse.json();

      if (!historyResponse.ok || !historyData.prices || historyData.prices.length === 0) {
        throw new Error(`Failed to fetch price history for ${selectedAsset}`);
      }
      if (!isHistoryUsableForAi(historyData)) {
        throw new Error(t('Fresh historical data is temporarily unavailable. AI analysis was not started.'));
      }

      const prices = historyData.prices.map((point: { close: number }) => point.close);
      const currentPrice = prices[prices.length - 1];
      const recentPrices = prices.slice(-8);

      const sma50 = calculateSMA(prices, 50);
      const sma200 = calculateSMA(prices, 200);
      const macdValues = calculateMACD(prices, 12, 26, 9);
      const rsiValues = calculateRSI(prices, 14);
      const lastIndex = prices.length - 1;
      const smaValues = Object.fromEntries(
        [
          ['50', sma50[lastIndex]],
          ['200', sma200[lastIndex]],
        ].filter((entry): entry is [string, number] => (
          typeof entry[1] === 'number'
          && Number.isFinite(entry[1])
          && entry[1] > 0
        )),
      );
      const latestMacd = macdValues
        ? {
            macd: macdValues.macd[lastIndex],
            signal: macdValues.signal[lastIndex],
            histogram: macdValues.histogram[lastIndex],
          }
        : undefined;
      const macd = latestMacd
        && Object.values(latestMacd).every((value) => Number.isFinite(value))
        ? latestMacd
        : undefined;
      const latestRsi = rsiValues[lastIndex];

      const analysisResponse = await fetch('/api/ai', {
        method: 'POST',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          asset: selectedAsset,
          currentPrice,
          currency,
          assetClass: selectedAssetClass,
          locale: language,
          smaValues,
          macd,
          rsi: Number.isFinite(latestRsi) ? latestRsi : undefined,
          recentPrices,
        }),
      });

      const analysisData = await analysisResponse.json();

      if (!analysisResponse.ok) {
        throw new Error(t('Technical analysis is unavailable.'));
      }

      const entry: AnalysisEntry = {
        id: `${selectedAsset}-${Date.now()}`,
        asset: selectedAsset,
        ...analysisData.result,
        date: analysisData.timestamp,
      };
      setCurrentAnalysis(entry);
      writeStoredAnalysis(entry);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : t('Technical analysis is unavailable.'),
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <Brain size={24} style={{ display: 'inline', marginInlineEnd: 8 }} />
              {t('Technical Analysis')}
            </h1>

            <div className="page-header-meta">
              <span className="status-pill neutral">
                <Brain size={13} />
                {t('Deterministic evidence model')}
              </span>
              {mounted && currentAnalysis && (
                <span className="status-pill neutral">
                  <Sparkles size={13} />
                  {t('Last analysis')}: {new Date(currentAnalysis.date).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-content animate-in">


        {!user && (
          <div className="card" role="status" style={{ marginBottom: 24 }}>
            <div className="section-title">{t('Sign-in required')}</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>
              {t('Sign in to run the deterministic technical analysis. No AI-provider prose is used in this workflow.')}
            </p>
          </div>
        )}

        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Run Analysis')}</div>

            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', minWidth: 180 }}>
              <label className="label">{t('Asset Class')}</label>
              <select
                className="select"
                value={selectedAssetClass}
                onChange={(event) => {
                  const nextClass = event.target.value as AssetClass;
                  const nextAssets = getSupportedAssetsByClass(nextClass);
                  setSelectedAssetClass(nextClass);
                  if (nextAssets.length > 0) {
                    setSelectedAsset(nextAssets[0].symbol);
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
            <div style={{ flex: '1 1 220px', minWidth: 220 }}>
              <label className="label">{t('Asset to Analyze')}</label>
              <select className="select" value={selectedAsset} onChange={(event) => setSelectedAsset(event.target.value)}>
                {availableAssets.map((assetOption) => (
                  <option key={assetOption.symbol} value={assetOption.symbol}>
                    {assetOption.name} ({assetOption.symbol})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 140 }}>
              <label className="label">{t('Currency')}</label>
              <select
                className="select"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as 'eur' | 'usd')}
              >
                {AI_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={`btn ${isAnalyzing ? 'btn-analyzing' : 'btn-primary'}`}
              onClick={handleAnalyze}
              disabled={isAnalyzing || !user}
            >
              <Brain size={16} />
              {isAnalyzing ? t('Analyzing...') : t('Run Technical Analysis')}
            </button>
          </div>
        </div>

        <div className="callout warn">
          <AlertTriangle size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>{t('Deterministic technical interpretation only.')}</strong> {t('The analysis uses supplied price and technical-indicator data. It does not use provider-generated prose, estimate fundamentals, or recommend portfolio actions.')}
          </div>
        </div>

        {error && (
          <div className="callout error">
            <AlertTriangle size={18} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('Analysis failed.')}</strong> {error}
            </div>
          </div>
        )}

        {!currentAnalysis && !isAnalyzing && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Brain size={22} />
            </div>
            {t('Select an asset and start the analysis.')}
          </div>
        )}

        {currentAnalysis && (() => { const analysis = currentAnalysis; return (
          <div key={analysis.id} className="card">
            <div className="panel-header">
              <div>
                <div className="ai-analysis-header-badges" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}><bdi dir="ltr">{analysis.asset}</bdi> {t('Analysis')}</div>
                  <span className={`badge ${trendBadgeClass[analysis.trendDirection]}`}>
                    {analysis.trendDirection === 'bullish' ? <TrendingUp size={12} /> : analysis.trendDirection === 'bearish' ? <TrendingDown size={12} /> : <Activity size={12} />}
                    {t(analysis.trendDirection)}
                  </span>
                  <span className={`badge ${qualityBadgeClass[analysis.signalQuality]}`}>
                    {t(analysis.signalQuality)}
                  </span>
                  <span className={`badge ${postureBadgeClass[analysis.technicalPosture]}`}>
                    {t(postureLabel[analysis.technicalPosture])}
                  </span>
                </div>
                <div className="panel-subtitle" style={{ marginTop: 8 }}>
                  <bdi dir="auto">{analysis.provider}</bdi> · <bdi dir="ltr">{analysis.model}</bdi> · {new Date(analysis.date).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}
                </div>
              </div>
            </div>

            <div className="split-panel" style={{ gridTemplateColumns: 'minmax(220px, 260px) 1fr' }}>
              <div className="section-stack">
                <div className="card" style={{ background: 'var(--surface-soft)', padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <ScoreGauge score={analysis.score} size={148} />
                  </div>
                  <div className="summary-strip" style={{ marginTop: 14 }}>
                    <div className="summary-item">
                      <span>{t('Directional score')}</span>
                      <strong>{analysis.score} / 100</strong>
                    </div>
                  </div>
                </div>

                <div className="callout info">
                  <Sparkles size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>{t('Evidence-bound interpretation')}.</strong>{' '}
                    {t(analysis.summary)}
                  </div>
                </div>
              </div>

              <div className="section-stack">
                <div className="card" style={{ background: 'var(--surface-soft)' }}>
                  <div className="panel-header">
                    <div>
                      <div className="section-title">{t('Indicator Readout')}</div>

                    </div>
                  </div>
                  <div>
                    {analysis.indicators.length > 0 ? (
                      analysis.indicators.map((indicator) => (
                        <IndicatorBar
                          key={`${analysis.id}-${indicator.label}`}
                          indicator={indicator}
                        />
                      ))
                    ) : (
                      <div className="empty-state" style={{ padding: 28 }}>
                        {t('No indicator diagnostics were returned for this analysis.')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid-2">
                  <div className="card" style={{ background: 'var(--surface-soft)' }}>
                    <div className="panel-header">
                      <div>
                        <div className="section-title">{t('Bullish Signals')}</div>

                      </div>
                    </div>
                    <div className="signal-column">
                      {analysis.bullishSignals.length > 0 ? (
                        analysis.bullishSignals.map((signal, index) => (
                          <div key={`${analysis.id}-bull-${index}`} className="signal-card">
                            <div>
                              <div style={{ fontWeight: 700 }}>{t(signal.label)}</div>
                              {signal.detail && (
                                <div dir="ltr" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                  {t(signal.detail)}
                                </div>
                              )}
                            </div>
                            <CheckCircle size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
                          </div>
                        ))
                      ) : (
                        <div className="empty-state" style={{ padding: 28 }}>
                          {t('No bullish triggers surfaced in this run.')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card" style={{ background: 'var(--surface-soft)' }}>
                    <div className="panel-header">
                      <div>
                        <div className="section-title">{t('Bearish Signals')}</div>

                      </div>
                    </div>
                    <div className="signal-column">
                      {analysis.bearishSignals.length > 0 ? (
                        analysis.bearishSignals.map((signal, index) => (
                          <div key={`${analysis.id}-bear-${index}`} className="signal-card">
                            <div>
                              <div style={{ fontWeight: 700 }}>{t(signal.label)}</div>
                              {signal.detail && (
                                <div dir="ltr" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                  {t(signal.detail)}
                                </div>
                              )}
                            </div>
                            <AlertTriangle size={16} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
                          </div>
                        ))
                      ) : (
                        <div className="empty-state" style={{ padding: 28 }}>
                          {t('No bearish warnings were identified in this run.')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('Reasoning & Diagnostics')}
              </summary>
              <div
                style={{
                  marginTop: 12,
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--surface-soft)',
                  border: '1px solid rgba(101, 157, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                }}
              >
                <span>{t(analysis.reasoning)}</span>
              </div>
            </details>

            {analysis.warnings.length > 0 && (
              <div className="signal-column" style={{ marginTop: 16 }}>
                {analysis.warnings.map((warning, index) => (
                  <div key={`${analysis.id}-warning-${index}`} className="callout warn">
                    <AlertTriangle size={16} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                    <div>{t(warning)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ); })()}
      </div>
    </AppShell>
  );
}
