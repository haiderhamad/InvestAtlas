/**
 * Strategy Results Export
 * Excel (.xlsx) and PDF (print-optimized) export for strategy analysis results
 */

import type { FullAnalysisResult, CategoryTag } from './types';

const TAG_LABELS: Record<CategoryTag, string> = {
  best_overall: '🏆 Best Overall',
  best_return: '💰 Highest Return',
  best_winrate: '🎯 Best Winrate',
  best_risk: '🛡️ Lowest Risk',
  best_sharpe: '⚖️ Best Sharpe Ratio',
  best_sma_only: '📊 Best SMA',
  best_dual_sma: '📊 Best Dual SMA',
};

export function getTagLabel(tag: CategoryTag, t?: (s: string) => string): string {
  const label = TAG_LABELS[tag] || tag;
  return t ? t(label) : label;
}

/**
 * Export results as CSV (works without external dependencies)
 */
export function exportResultsToCSV(results: FullAnalysisResult[], asset: string, initialCapital: number, t: (s: string) => string): void {
  const headers = [
    t('Rank'), t('Strategy'), t('Asset'), t('Period'), t('Initial Capital'),
    'SMA',
    t('Trades'), t('Buys'), t('Sells'), t('Winning Trades'), t('Losing Trades'), t('Win%'),
    `${t('End Value')} (€)`, t('Return%'), t('Avg Gain%'), t('Avg Loss%'),
    t('Volatility%'), t('Max Drawdown%'), t('Sharpe'), t('Sortino'), t('Profit Factor'),
    t('False Signals%'), t('Buy&Hold%'), t('Robustness'), t('Badges'),
  ];

  const rows = results.map((r, i) => {
    const m = r.result.metrics;
    const p = r.result.parameters;
    const buySignals = r.result.signals.filter(s => s.type === 'buy').length;
    const sellSignals = r.result.signals.filter(s => s.type === 'sell').length;

    return [
      i + 1,
      r.strategyLabel,
      asset,
      `${r.result.startDate} - ${r.result.endDate}`,
      initialCapital.toFixed(2),
      p.smaPeriod || (p.fastPeriod ? `${p.fastPeriod}/${p.slowPeriod}` : '-'),
      m.totalTrades,
      buySignals,
      sellSignals,
      m.winningTrades,
      m.losingTrades,
      m.winRate.toFixed(1),
      r.endCapital.toFixed(2),
      m.totalReturnPct.toFixed(2),
      m.avgGainPerTrade.toFixed(2),
      m.avgLossPerTrade.toFixed(2),
      m.volatility.toFixed(2),
      m.maxDrawdownPct.toFixed(2),
      m.sharpeRatio.toFixed(3),
      m.sortinoRatio.toFixed(3),
      m.profitFactor.toFixed(2),
      m.falseSignalRate.toFixed(1),
      m.buyHoldReturnPct.toFixed(2),
      r.robustnessFlag === 'robust' ? t('Robust') : r.robustnessFlag === 'possibly_overfit' ? t('Possibly overfit') : t('Little data'),
      r.categoryTags.map(tag => getTagLabel(tag, t)).join('; '),
    ];
  });

  const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `strategy_analysis_${asset}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export results as print-optimized HTML for PDF (via browser print)
 */
export function exportResultsToPDF(results: FullAnalysisResult[], asset: string, initialCapital: number, t: (s: string) => string): void {
  const best = results[0];
  const topResults = results.slice(0, 50);

  const tableRows = topResults.map((r, i) => {
    const m = r.result.metrics;
    const p = r.result.parameters;
    const highlight = r.categoryTags.length > 0 ? 'background:#1a2744;' : '';

    return `<tr style="${highlight}">
      <td style="font-weight:700;color:${i < 3 ? '#2dd4bf' : '#94a3b8'}">#${i + 1}</td>
      <td style="font-weight:600">${r.strategyLabel}</td>

      <td>${m.totalTrades}</td>
      <td>${m.winRate.toFixed(1)}%</td>
      <td style="font-weight:700;color:${m.totalReturnPct >= 0 ? '#22c55e' : '#ef4444'}">${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%</td>
      <td>${initialCapital.toFixed(0)} € → <strong>${r.endCapital.toFixed(0)} €</strong></td>
      <td style="color:#ef4444">-${m.maxDrawdownPct.toFixed(1)}%</td>
      <td>${m.sharpeRatio.toFixed(3)}</td>
      <td>${m.falseSignalRate.toFixed(1)}%</td>
      <td>${p.smaPeriod || `${p.fastPeriod}/${p.slowPeriod}`}</td>
      <td>${r.robustnessFlag === 'robust' ? '✅' : r.robustnessFlag === 'possibly_overfit' ? '⚠️' : '❓'}</td>
      <td>${r.categoryTags.map(tag => getTagLabel(tag, t)).join('<br>')}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${t('Strategy Analysis')} ${asset}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: -apple-system, sans-serif; color:#e2e8f0; background:#0f172a; padding:24px; font-size:11px; }
      h1 { font-size:20px; margin-bottom:4px; }
      h2 { font-size:14px; color:#94a3b8; margin-bottom:16px; }
      .summary { display:flex; gap:16px; margin-bottom:20px; }
      .card { background:#1e293b; border-radius:8px; padding:12px 16px; flex:1; }
      .card-label { font-size:10px; color:#64748b; text-transform:uppercase; }
      .card-value { font-size:18px; font-weight:700; margin-top:4px; }
      table { width:100%; border-collapse:collapse; margin-top:16px; }
      th { background:#1e293b; padding:6px 8px; text-align:left; font-size:10px; text-transform:uppercase; color:#64748b; border-bottom:1px solid #334155; }
      td { padding:5px 8px; border-bottom:1px solid #1e293b; white-space:nowrap; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head><body>
    <h1>${t('Strategy Analysis')}: ${asset}</h1>
    <h2>${results.length} ${t('Tested Strategies')} • ${best?.result.startDate || ''} to ${best?.result.endDate || ''} • ${t('Initial Capital')}: ${initialCapital} €</h2>
    <div class="summary">
      <div class="card"><div class="card-label">🏆 ${t('Best Strategy')}</div><div class="card-value">${best?.strategyLabel || '—'}</div></div>
      <div class="card"><div class="card-label">${t('Return')}</div><div class="card-value" style="color:${(best?.result.metrics.totalReturnPct || 0) >= 0 ? '#22c55e' : '#ef4444'}">${best?.result.metrics.totalReturnPct.toFixed(2)}%</div></div>
      <div class="card"><div class="card-label">${t('End Value')}</div><div class="card-value">${best?.endCapital.toFixed(2)} €</div></div>
      <div class="card"><div class="card-label">${t('Win Rate')}</div><div class="card-value">${best?.result.metrics.winRate.toFixed(1)}%</div></div>
    </div>
    <table>
      <thead><tr>
        <th>#</th><th>${t('Strategy')}</th><th>${t('Trades')}</th><th>${t('Win%')}</th><th>${t('Return')}</th><th>${t('Capital')}</th><th>${t('Max DD')}</th><th>${t('Sharpe')}</th><th>${t('False Sig.%')}</th><th>SMA</th><th>${t('Robust')}</th><th>${t('Badge')}</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}
