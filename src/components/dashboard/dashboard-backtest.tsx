'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { FlaskConical, ChevronDown, ChevronUp, Play, Download, Trophy, Target, Shield, TrendingUp, Zap, BarChart3, Layers, AlertTriangle } from 'lucide-react';
import type { DataSegment } from '@/lib/data/historical-engine';
import { describeBacktestFeeModel } from '@/lib/strategy/fee-model';
import { runMultiOptimization, estimateCombinations } from '@/lib/strategy/multi-optimizer';
import { runStabilityAnalysis } from '@/lib/strategy/stability-analyzer';
import { exportResultsToCSV, exportResultsToPDF, getTagLabel } from '@/lib/strategy/strategy-export';
import type { FullAnalysisResult, OptimizationProgress, CategoryTag } from '@/lib/strategy/types';
import type { StabilityReport } from '@/lib/strategy/stability-analyzer';
import { ASSET_CLASS_OPTIONS, getAssetConfig, getSupportedAssetsByClass, type AssetClass } from '@/lib/config/supported-assets';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import { fetchFinancialData } from '@/lib/financial-data/client';

type TimePeriod = '1Y' | '2Y' | '5Y' | '10Y' | 'MAX';

function readThemeCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || fallback;
}

export default function DashboardBacktest() {
  const { t, language } = useAppTranslation();
  const [asset, setAsset] = useState('BTC');
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClass>('crypto');
  const [capital, setCapital] = useState(100);
  const [feeMode, setFeeMode] = useState<'percent' | 'flat'>('percent');
  const [feePercent, setFeePercent] = useState(0.25);
  const [flatFeeAmount, setFlatFeeAmount] = useState(1);
  const [period, setPeriod] = useState<TimePeriod>('MAX');
  const intensity: 'fast' | 'normal' = 'fast';
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const [results, setResults] = useState<FullAnalysisResult[]>([]);
  const [stability, setStability] = useState<StabilityReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const [showStability, setShowStability] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [themeRevision, setThemeRevision] = useState(0);

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

  // Prices & Provenance
  const [prices, setPrices] = useState<number[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [provenance, setProvenance] = useState<DataSegment[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const selectedAssetConfig = getAssetConfig(asset);
  const availableAssets = getSupportedAssetsByClass(assetClassFilter);
  const feeSummary = describeBacktestFeeModel({
    strategyType: 'single_sma',
    feePercent,
    feeMode,
    flatFeeAmount,
    quoteCurrency: 'eur',
    slippagePercent: 0.1,
    initialCapital: capital,
  });

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    try {
      const res = await fetchFinancialData(`/api/prices/history?symbol=${asset}`);
      const data = await res.json();
      if (res.ok && data.prices && isHistoryUsableForDerivedPerformance(data)) {
        const allPrices = data.prices.map((p: { close: number }) => p.close);
        const allDates = data.prices.map((p: { date: string }) => p.date);
        
        // Trim to selected period
        const daysMap: Record<TimePeriod, number> = { '1Y': 365, '2Y': 730, '5Y': 1825, '10Y': 3650, 'MAX': allPrices.length };
        const days = Math.min(daysMap[period] || allPrices.length, allPrices.length);
        
        setPrices(allPrices.slice(-days));
        setDates(allDates.slice(-days));
        setProvenance(data.provenance || []);
        setWarnings(data.warnings || []);
      } else {
        setPrices([]);
        setDates([]);
        setProvenance([]);
        setWarnings([]);
      }
    } catch {
      setPrices([]);
      setDates([]);
      setProvenance([]);
      setWarnings([]);
    }
    setLoadingData(false);
  }, [asset, period]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchData]);

  const runAnalysis = useCallback(() => {
    if (prices.length < 30) return;
    setIsRunning(true);
    setResults([]);
    setStability(null);
    setTimeout(() => {
      const res = runMultiOptimization(
        {
          asset,
          prices,
          dates,
          feePercent,
          feeMode,
          flatFeeAmount,
          quoteCurrency: 'eur',
          slippagePercent: 0.1,
          initialCapital: capital,
          intensity,
        },
        p => setProgress(p)
      );
      setResults(res);

      // Run stability analysis for MAX period
      if (period === 'MAX' && prices.length > 730) {
        const report = runStabilityAnalysis(res, prices, dates, asset);
        setStability(report);
      }

      setIsRunning(false);
      setExpanded(true);
    }, 50);
  }, [prices, dates, asset, capital, feeMode, feePercent, flatFeeAmount, intensity, period]);

  // Draw equity chart
  useEffect(() => {
    if (!chartRef.current || results.length < 1 || !showChart) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const chartGrid = readThemeCssVar('--chart-grid', 'rgba(100,116,139,0.15)');
    const chartTextDim = readThemeCssVar('--chart-text-dim', '#64748b');
    const chartTextFaint = readThemeCssVar('--chart-text-faint', '#94a3b8');
    const chartTextStrong = readThemeCssVar('--text-primary', '#f1f5f9');
    const seriesNeutral = readThemeCssVar('--series-neutral', '#64748b');
    const seriesCrypto = readThemeCssVar('--series-crypto', '#f7931a');
    const seriesReturn = readThemeCssVar('--series-real-return', '#22c55e');
    const seriesMarket = readThemeCssVar('--series-market', '#3b82f6');

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Layout geometry
    const padL = 60; // Left padding for Y-axis labels
    const padR = 48; // Right padding for End Value labels
    const padB = 48; // Bottom padding for X-axis (24) + Legend (24)
    const padT = 16; // Top padding
    const chartW = W - padL - padR;
    const chartH = H - padB - padT;

    ctx.clearRect(0, 0, W, H);

    // Collect curves: top 3 strategies + buy-and-hold
    const curves: { data: number[]; color: string; label: string }[] = [];

    // Buy & Hold
    const bhCurve = prices.map(p => capital * (p / prices[0]));
    curves.push({ data: bhCurve, color: seriesNeutral, label: 'Buy & Hold' });

    // Top 3 strategies
    const colors = [seriesCrypto, seriesReturn, seriesMarket];
    for (let i = 0; i < Math.min(3, results.length); i++) {
      curves.push({ data: results[i].result.equityCurve, color: colors[i], label: results[i].strategyLabel });
    }

    // Determine min and max for log scale
    let minV = Infinity, maxV = -Infinity;
    for (const c of curves) {
      for (const v of c.data) {
        if (v > 0 && v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (minV === Infinity || minV <= 0) minV = 1;
    if (maxV <= minV) maxV = minV + 10;

    const logMin = Math.log10(minV);
    const logMax = Math.log10(maxV);
    const domain = logMax - logMin;
    const padLog = domain * 0.05; // 5% padding top and bottom
    const pLogMin = logMin - padLog;
    const pLogMax = logMax + padLog;

    const xStep = chartW / Math.max(1, prices.length - 1);
    const yScale = (v: number) => {
      const lv = Math.log10(Math.max(v, 1));
      return padT + chartH - ((lv - pLogMin) / (pLogMax - pLogMin)) * chartH;
    };

    // Draw horizontal grid lines (Logarithmic step hints)
    ctx.strokeStyle = chartGrid;
    ctx.lineWidth = 1;
    ctx.fillStyle = chartTextDim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // 5 evenly spaced lines in log space
    for (let i = 0; i <= 4; i++) {
      const lv = pLogMin + (pLogMax - pLogMin) * (i / 4);
      const y = padT + chartH - ((lv - pLogMin) / (pLogMax - pLogMin)) * chartH;
      const val = Math.pow(10, lv);
      
      ctx.beginPath(); 
      ctx.moveTo(padL, y); 
      ctx.lineTo(W, y); 
      ctx.stroke();

      // Format currency label intelligently based on magnitude
      const formatted = val > 1000000 
        ? `${(val / 1000000).toFixed(1)}M €` 
        : val > 1000 
          ? `${(val / 1000).toFixed(1)}k €` 
          : `${val.toFixed(0)} €`;
      ctx.fillText(formatted, padL - 8, y);
    }

    // Lines and End Value labels
    for (const curve of curves) {
      if (curve.data.length === 0) continue;

      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      
      const pts = curve.data.map((v, i) => ({ x: padL + i * xStep, y: yScale(v) }));
      ctx.moveTo(pts[0].x, pts[0].y);
      
      for (let i = 0; i < pts.length - 1; i++) {
        const curr = pts[i];
        const next = pts[i + 1];
        const midX = (curr.x + next.x) / 2;
        ctx.bezierCurveTo(midX, curr.y, midX, next.y, next.x, next.y);
      }
      ctx.stroke();

      // End Value marker
      if (curve.data.length > 0) {
        const endX = padL + (curve.data.length - 1) * xStep;
        const endY = yScale(curve.data[curve.data.length - 1]);
        
        ctx.fillStyle = curve.color;
        ctx.beginPath();
        ctx.arc(endX, endY, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = chartTextStrong;
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const endVal = curve.data[curve.data.length - 1];
        const endText = endVal > 1000000 ? `${(endVal / 1000000).toFixed(1)}M` : endVal > 1000 ? `${(endVal / 1000).toFixed(1)}k` : `${endVal.toFixed(0)}`;
        ctx.fillText(endText, endX + 6, endY);
      }
    }

    // X-Axis Date Labels
    if (dates && dates.length > 0) {
      ctx.fillStyle = chartTextDim;
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';

      const tickCount = Math.max(2, Math.floor(chartW / 100)); // ~one label per 100px
      const tickStep = Math.max(1, Math.floor((dates.length - 1) / (tickCount - 1)));

      for (let i = 0; i < dates.length; i += tickStep) {
        const isLast = (i + tickStep >= dates.length);
        const idx = isLast ? dates.length - 1 : i;
        const x = padL + idx * xStep;

        // YYYY-MM formatted labels
        const formatted = dates[idx].substring(0, 7);

        if (idx === 0) ctx.textAlign = 'left';
        else if (idx === dates.length - 1) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';

        ctx.fillText(formatted, x, padT + chartH + 12);

        if (isLast) break;
      }
    }

    // Legend
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let lx = padL;
    const legendY = H - 16;
    for (const curve of curves) {
      ctx.fillStyle = curve.color;
      ctx.fillRect(lx, legendY, 12, 3);
      ctx.fillStyle = chartTextFaint;
      const shortLabel = curve.label.length > 35 ? curve.label.slice(0, 33) + '…' : curve.label;
      ctx.fillText(shortLabel, lx + 16, legendY - 4);
      lx += ctx.measureText(shortLabel).width + 36;
    }

  }, [results, prices, dates, showChart, capital, themeRevision]);

  const tagBg = (tag: CategoryTag) => {
    const m: Record<string, string> = {
      best_overall: 'var(--accent-teal-dim)', best_return: 'var(--green-dim)',
      best_winrate: 'var(--accent-blue-dim)', best_risk: 'var(--accent-cyan-dim)',
      best_sharpe: 'var(--yellow-dim)', best_sma_only: 'var(--accent-blue-dim)',
      best_dual_sma: 'var(--accent-teal-dim)',
    };
    return m[tag] || 'var(--surface-accent-soft)';
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div className="section-header" style={{ margin: 0 }}>
          <span className="section-title">
            <FlaskConical size={18} style={{ display: 'inline', marginRight: 8 }} />
            {t('Backtesting Results')}
          </span>
        </div>

        {/* Inline Controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="select"
            style={{ width: 112, fontSize: 12, padding: '4px 8px' }}
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
            {ASSET_CLASS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className="select" style={{ width: 110, fontSize: 12, padding: '4px 8px' }} value={asset} onChange={e => setAsset(e.target.value)}>
            {availableAssets.map(assetOption => <option key={assetOption.symbol} value={assetOption.symbol}>{assetOption.symbol}</option>)}
          </select>
          <select className="select" style={{ width: 90, fontSize: 12, padding: '4px 8px' }} value={String(capital)} onChange={e => setCapital(Number(e.target.value))}>
            <option value="100">100 €</option><option value="200">200 €</option><option value="500">500 €</option><option value="1000">1.000 €</option>
          </select>
          <select className="select" style={{ width: 130, fontSize: 12, padding: '4px 8px' }} value={feeMode} onChange={e => setFeeMode(e.target.value as 'percent' | 'flat')}>
            <option value="percent">{t('Percent fee')}</option>
            <option value="flat">{t('Flat fee')}</option>
          </select>
          {feeMode === 'percent' ? (
            <input className="input" style={{ width: 88, fontSize: 12, padding: '4px 8px' }} type="number" min={0} step={0.01} value={feePercent} onChange={e => setFeePercent(Number(e.target.value))} />
          ) : (
            <input className="input" style={{ width: 88, fontSize: 12, padding: '4px 8px' }} type="number" min={0} step={0.01} value={flatFeeAmount} onChange={e => setFlatFeeAmount(Number(e.target.value))} />
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1Y','2Y','5Y','10Y','MAX'] as TimePeriod[]).map(p => (
              <button key={p} className={`btn ${period === p ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 8px', fontSize: 11, minWidth: 0 }} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" onClick={runAnalysis} disabled={isRunning || loadingData || prices.length < 30}>
            <Play size={14} /> {isRunning ? `${progress?.completed || 0}/${progress?.total || '...'}` : t('Analyze')}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span className={`badge ${
          selectedAssetConfig?.assetClass === 'crypto'
            ? 'badge-crypto'
            : selectedAssetConfig?.assetClass === 'stock'
            ? 'badge-stock'
            : selectedAssetConfig?.assetClass === 'etf'
            ? 'badge-etf'
            : 'badge-metal'
        }`}>
          {selectedAssetConfig?.assetClass === 'crypto'
            ? 'Crypto'
            : selectedAssetConfig?.assetClass === 'stock'
            ? 'Stocks'
            : selectedAssetConfig?.assetClass === 'etf'
            ? 'ETFs'
            : 'Metals'}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>{t('Cost model')}: {t(feeSummary)}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {t("The strategy universe is trackable, not pre-certified. Check each asset's current evidence status before interpreting results.")}
        </span>
      </div>

      {/* Data Provenance Banner */}
      {provenance && provenance.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{t('Data source(s)')}:</span>
          {provenance.map((prov, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className={`badge ${prov.role === 'primary' ? 'badge-blue' : prov.role === 'secondary' ? 'badge-yellow' : 'badge-teal'}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                {prov.providerName}
              </span>
              <span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{prov.dataPoints} {t('Days')} ({prov.startDate} → {prov.endDate})</span>
              {idx < provenance.length - 1 && <span style={{ color: 'var(--border)', margin: '0 4px' }}>+</span>}
            </div>
          ))}
          {warnings && warnings.length > 0 && (
             <div className="tooltip" data-tooltip={`${warnings.length} warnings during data validation`} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--yellow)', cursor: 'help' }}>
               <AlertTriangle size={14} />
             </div>
          )}
        </div>
      )}

      {/* Progress */}
      {isRunning && progress && (
        <div style={{ marginTop: 12 }}>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{progress.currentParams}</div>
        </div>
      )}

      {/* Results Summary */}
      {results.length > 0 && !isRunning && (
        <>
          {/* Top-5 Cards */}
          <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{t('Top 5 Strategies — {asset} • {capital} € • {period}').replace('{asset}', asset).replace('{capital}', String(capital)).replace('{period}', period)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {results.slice(0, 5).map((r, i) => {
                const m = r.result.metrics;
                const icons = [<Trophy key="t" size={16} />, <Target key="ta" size={16} />, <Shield key="s" size={16} />, <TrendingUp key="tu" size={16} />, <BarChart3 key="b" size={16} />];
                const colors = ['var(--series-crypto)', 'var(--green)', 'var(--series-market)', 'var(--accent-cyan)', 'var(--text-secondary)'];
                return (
                  <div key={i} style={{ padding: 14, background: 'var(--bg-primary)', borderRadius: 8, border: i === 0 ? '1px solid var(--accent-teal)' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: colors[i] }}>{icons[i]}</span>
                      <span style={{ fontWeight: 700, color: i < 3 ? 'var(--accent-teal)' : 'var(--text-secondary)' }}>#{i + 1}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{r.strategyLabel}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Return')}:</span> <strong style={{ color: m.totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{m.totalReturnPct >= 0 ? '+' : ''}{m.totalReturnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Final Value')}:</span> <strong>{r.endCapital.toFixed(0)} €</strong></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Win%')}:</span> {m.winRate.toFixed(0)}%</div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Trades')}:</span> {m.totalTrades}</div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Max DD')}:</span> <span style={{ color: 'var(--red)' }}>-{m.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('Sharpe')}:</span> {m.sharpeRatio.toFixed(2)}</div>
                    </div>
                    {r.categoryTags.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.categoryTags.map(tag => (
                          <span key={tag} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: tagBg(tag), color: 'var(--text-secondary)' }}>{getTagLabel(tag, t)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Equity Chart */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{t('Equity Curve')}</span>
              <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShowChart(!showChart)}>
                {showChart ? t('Hide') : t('Show')}
              </button>
            </div>
            {showChart && (
              <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: 12, overflow: 'hidden' }}>
                <canvas ref={chartRef} style={{ width: '100%', height: 200, display: 'block' }} />
              </div>
            )}
          </div>

          {/* Collapsible Full Table */}
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {expanded ? t('Collapse Table') : t('Full Table ({count} strategies)').replace('{count}', String(results.length))}
            </button>
            {expanded && (
              <div className="table-container" style={{ marginTop: 12, maxHeight: 400, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ fontSize: 11 }}>
                  <thead><tr>
                    <th title={t('Rank')}>#</th>
                    <th title={t('Used indicators and parameters')}>{t('Strategy')}</th>
                    <th title={t('Number of trades')}>{t('Trades')}</th>
                    <th title={t('Percentage of profitable trades')}>{t('Win%')}</th>
                    <th title={t('Total return in percent')}>{t('Return%')}</th>
                    <th title={t('Final capital value')}>{t('End Value')}</th>
                    <th title={t('Maximum historical loss')}>{t('Max DD')}</th>
                    <th title={t('Risk-adjusted return (Sharpe Ratio)')}>{t('Sharpe')}</th>
                    <th title={t('Percentage of loss signals')}>{t('False Sig.%')}</th>
                    <th title={t('Outperformance vs Buy & Hold in %')}>{t('vs B&H')}</th>
                    <th title={t('Stability and overfitting risk')}>{t('Robust')}</th>
                    <th title={t('Achieved tags')}>{t('Tags')}</th>
                  </tr></thead>
                  <tbody>
                    {results.slice(0, 50).map((r, i) => {
                      const m = r.result.metrics;
                      const vsBhDelta = m.totalReturnPct - m.buyHoldReturnPct;
                      return (
                        <tr key={i} style={{ background: r.categoryTags.length > 0 ? 'var(--surface-accent-soft)' : undefined }}>
                          <td className="mono" style={{ fontWeight: 700 }}>#{i + 1}</td>
                          <td style={{ fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.strategyLabel}</td>
                          <td className="mono">{m.totalTrades}</td>
                          <td className="mono">{m.winRate.toFixed(0)}%</td>
                          <td className="mono" style={{ fontWeight: 700, color: m.totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{m.totalReturnPct >= 0 ? '+' : ''}{m.totalReturnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                          <td className="mono">{r.endCapital.toFixed(0)} €</td>
                          <td className="mono" style={{ color: 'var(--red)' }}>-{m.maxDrawdownPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                          <td className="mono">{m.sharpeRatio.toFixed(2)}</td>
                          <td className="mono">{m.falseSignalRate.toFixed(0)}%</td>
                          <td
                            className="mono"
                            title={`${t('Buy & Hold')}: ${m.buyHoldReturnPct >= 0 ? '+' : ''}${m.buyHoldReturnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                            style={{ color: vsBhDelta >= 0 ? 'var(--green)' : 'var(--red)' }}
                          >
                            {vsBhDelta >= 0 ? '✅' : '❌'} {vsBhDelta >= 0 ? '+' : ''}{vsBhDelta.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                          </td>
                          <td>{r.robustnessFlag === 'robust' ? '✅' : r.robustnessFlag === 'possibly_overfit' ? '⚠️' : '❓'}</td>
                          <td style={{ maxWidth: 140 }}>
                            {r.categoryTags.slice(0, 2).map(tag => (
                              <span key={tag} style={{ display: 'inline-block', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: tagBg(tag), color: 'var(--text-secondary)', marginRight: 3 }}>{getTagLabel(tag, t)}</span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Stability Analysis (MAX mode only) */}
          {stability && (
            <div style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowStability(!showStability)}>
                <Layers size={16} /> {showStability ? t('Collapse Stability Analysis') : t('Show Stability Analysis (4Y / 2Y Segments)')}
              </button>
              {showStability && (
                <div style={{ marginTop: 12 }}>
                  {/* 4Y Segments */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-teal)', marginBottom: 8 }}>{t('4-Year Segments')}</div>
                  <div className="table-container" style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table style={{ fontSize: 11 }}>
                      <thead><tr><th>{t('Segment')}</th><th>{t('Period')}</th><th>{t('Days')}</th><th>{t('Best Strategy')}</th><th>{t('Return')}</th><th>{t('Win%')}</th><th>{t('Max DD')}</th></tr></thead>
                      <tbody>
                        {stability.segments4Y.map((seg, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{seg.segmentLabel}</td>
                            <td className="mono">{seg.startDate} → {seg.endDate}</td>
                            <td className="mono">{seg.dataPoints}</td>
                            <td style={{ fontWeight: 600 }}>{seg.bestStrategy?.label || '—'}</td>
                            <td className="mono" style={{ color: (seg.bestStrategy?.returnPct || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{seg.bestStrategy ? `${seg.bestStrategy.returnPct >= 0 ? '+' : ''}${seg.bestStrategy.returnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}</td>
                            <td className="mono">{seg.bestStrategy?.winRate.toFixed(0) || '—'}%</td>
                            <td className="mono" style={{ color: 'var(--red)' }}>{seg.bestStrategy ? `-${seg.bestStrategy.maxDD.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 2Y Rolling */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: 8 }}>{t('2-Year Rolling Windows')}</div>
                  <div className="table-container" style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table style={{ fontSize: 11 }}>
                      <thead><tr><th>{t('Window')}</th><th>{t('Days')}</th><th>{t('Best Strategy')}</th><th>{t('Return')}</th><th>{t('Best SMA')}</th></tr></thead>
                      <tbody>
                        {stability.segments2Y.map((seg, i) => {
                          const drift = stability.parameterDrift.find(d => d.segment === seg.segmentLabel);
                          return (
                            <tr key={i}>
                              <td style={{ fontWeight: 600 }}>{seg.segmentLabel}</td>
                              <td className="mono">{seg.dataPoints}</td>
                              <td>{seg.bestStrategy?.label || '—'}</td>
                              <td className="mono" style={{ color: (seg.bestStrategy?.returnPct || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{seg.bestStrategy ? `${seg.bestStrategy.returnPct >= 0 ? '+' : ''}${seg.bestStrategy.returnPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}</td>
                              <td className="mono">{drift?.bestSmaPeriod || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Stability Scores */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)', marginBottom: 8 }}>{t('Strategy Stability Across All Market Phases')}</div>
                  <div className="table-container" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table style={{ fontSize: 11 }}>
                      <thead><tr><th>{t('Strategy')}</th><th>{t('Total Return')}</th><th>{t('Total Score')}</th><th>{t('Score Variance')}</th><th>{t('Rating')}</th></tr></thead>
                      <tbody>
                        {stability.stabilityScores.slice(0, 10).map((ss, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{ss.strategyLabel}</td>
                            <td className="mono" style={{ color: ss.overallReturn >= 0 ? 'var(--green)' : 'var(--red)' }}>{ss.overallReturn >= 0 ? '+' : ''}{ss.overallReturn.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                            <td className="mono">{ss.overallScore.toFixed(1)}</td>
                            <td className="mono">{ss.scoreVariance.toFixed(1)}</td>
                            <td>
                              <span className={`badge ${ss.stabilityFlag === 'stable' ? 'badge-green' : ss.stabilityFlag === 'mixed' ? 'badge-yellow' : 'badge-red'}`}>
                                {ss.stabilityFlag === 'stable' ? `✅ ${t('Stable')}` : ss.stabilityFlag === 'mixed' ? `⚠️ ${t('Mixed')}` : `🔄 ${t('Regime Dependent')}`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Interpretation */}
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <strong>{t('Interpretation')}:</strong> {t('Strategies with the label ✅ Stable show consistent performance across different 4-year and 2-year market phases. Strategies marked 🔄 Regime Dependent only work in certain market situations and might be overfitted.')}
                    {stability.parameterDrift.length > 0 && (
                      <span> {t('The best SMA varies between segments ({periods}), indicating changing market conditions.').replace('{periods}', [...new Set(stability.parameterDrift.map(d => d.bestSmaPeriod).filter(Boolean))].join(', '))}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export buttons */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => exportResultsToCSV(results, asset, capital, t)}>
              <Download size={14} /> CSV
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => exportResultsToPDF(results, asset, capital, t)}>
              <Download size={14} /> PDF
            </button>
          </div>
        </>
      )}

      {/* Empty State */}
      {results.length === 0 && !isRunning && (
        <div style={{ marginTop: 16, textAlign: 'center', padding: 24, background: 'var(--bg-primary)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          <Zap size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('Select an asset, capital, and period, then click Analyze')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('~{count} strategy combinations will be tested').replace('{count}', String(estimateCombinations(intensity)))}</div>
        </div>
      )}
    </div>
  );
}
