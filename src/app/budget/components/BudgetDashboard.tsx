import { 
  TrendingUp, 
  TrendingDown, 
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
  Zap
} from 'lucide-react';
import { BudgetDonutChart, CategoryList } from './AnalysisParts';
import { type CategoryRow, type TimelinePoint } from '../../../lib/budget/budget-utils';

interface BudgetDashboardProps {
  analysisKind: 'income' | 'expense';
  setAnalysisKind: (kind: 'income' | 'expense') => void;
  analysisRows: CategoryRow[];
  distributionPeriodLabel: string;
  formatMoney: (val: number) => string;
  t: (key: string) => string;
  hoveredCategoryId: string | undefined | null;
  setHoveredCategoryId: (id: string | undefined) => void;
  timelinePoints: TimelinePoint[];
  selectedTimelinePoint: TimelinePoint | undefined;
  setSelectedTimelineKey: (key: string) => void;
  onShiftTimeline: (direction: -1 | 1) => void;
  onResetTimeline: () => void;
  isCurrentTimelineWindow: boolean;
  timelineMax: number;
  selectedTimelineDelta: number;
  selectedTimelineBalance: number;
  selectedSavingsRate: string;
  averageMonthlyIncome: number;
  averageMonthlyExpense: number;
}

export function BudgetDashboard({
  analysisKind,
  setAnalysisKind,
  analysisRows,
  distributionPeriodLabel,
  formatMoney,
  t,
  hoveredCategoryId,
  setHoveredCategoryId,
  timelinePoints,
  selectedTimelinePoint,
  setSelectedTimelineKey,
  onShiftTimeline,
  onResetTimeline,
  isCurrentTimelineWindow,
  timelineMax,
  selectedTimelineDelta,
  selectedTimelineBalance,
  selectedSavingsRate,
  averageMonthlyIncome,
  averageMonthlyExpense,
}: BudgetDashboardProps) {
  const displayTotal = analysisRows.reduce((sum, row) => sum + row.value, 0);
  const distributionLabel = analysisKind === 'income' ? t('Income breakdown') : t('Expense breakdown');
  const distributionTotalLabel = analysisKind === 'income' ? t('Total income') : t('Total expenses');

  const selectedIncome = selectedTimelinePoint?.income ?? 0;
  const selectedExpense = selectedTimelinePoint?.expense ?? 0;

  return (
    <div className="budget-analysis-tab animate-in">
      <div className="budget-cockpit-grid">
        <div className="budget-main-metrics">
          <div className="budget-metric-card compact">
            <div className="metric-icon-box balance">
              <TrendingUp size={16} />
            </div>
            <div className="metric-info">
              <span className="metric-label">{t('Balance')}</span>
              <strong className="metric-value" style={{ color: selectedTimelineBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {formatMoney(selectedTimelineBalance)}
              </strong>
            </div>
          </div>

          <div className="budget-metric-card compact">
            <div className={`metric-icon-box ${analysisKind}`}>
              {analysisKind === 'income' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            </div>
            <div className="metric-info">
              <span className="metric-label">{analysisKind === 'income' ? t('Total income') : t('Total expenses')}</span>
              <strong className="metric-value">{formatMoney(analysisKind === 'income' ? selectedIncome : selectedExpense)}</strong>
            </div>
          </div>

          <div className="budget-metric-card compact highlight">
            <div className="metric-icon-box savings">
              <Zap size={16} />
            </div>
            <div className="metric-info">
              <span className="metric-label">{t('Savings rate')}</span>
              <strong className="metric-value">{selectedSavingsRate}</strong>
            </div>
          </div>
        </div>

        <div className="budget-analysis-cockpit">
          <div className="card budget-analysis-panel premium-surface">
            <div className="panel-header-toolbar">
              <div className="panel-title-group">
                <div className="panel-title-line">
                  <div className="section-title">{t('Distribution')}</div>
                  {distributionPeriodLabel && (
                    <span className="badge badge-blue distribution-period-badge">{distributionPeriodLabel}</span>
                  )}
                </div>
                <div className="panel-subtitle">{distributionLabel}</div>
              </div>
              <div className="budget-segmented-pill">
                {(['expense', 'income'] as const).map((kind) => (
                  <button
                    key={kind}
                    className={analysisKind === kind ? 'active' : ''}
                    type="button"
                    onClick={() => setAnalysisKind(kind)}
                  >
                    {t(kind === 'expense' ? 'Expenses' : 'Income')}
                  </button>
                ))}
              </div>
            </div>

            <div className="budget-cockpit-split">
              <div className="budget-list-side">
                <CategoryList
                  rows={analysisRows}
                  total={displayTotal}
                  hoveredCategoryId={hoveredCategoryId}
                  setHoveredCategoryId={setHoveredCategoryId}
                  formatMoney={formatMoney}
                  t={t}
                />
              </div>

              <div className="budget-chart-side">
                <BudgetDonutChart
                  rows={analysisRows}
                  total={displayTotal}
                  centerLabel={distributionTotalLabel}
                  emptyLabel={t('No data')}
                  hoveredCategoryId={hoveredCategoryId}
                  setHoveredCategoryId={setHoveredCategoryId}
                  formatMoney={formatMoney}
                  t={t}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card budget-history-card premium-surface" style={{ marginTop: 24 }}>
        <div className="budget-panel-heading">
          <div>
            <div className="section-title">{t('Period comparison')}</div>
            <div className="panel-subtitle">{t('Compare income, expenses, and balance.')}</div>
          </div>
          <div className="budget-history-actions">
            <div className="budget-period-nav" aria-label={t('Period comparison')}>
              <button
                className="budget-period-nav-button"
                type="button"
                title={t('Past periods')}
                aria-label={t('Past periods')}
                onClick={() => onShiftTimeline(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="budget-period-reset-button"
                type="button"
                title={t('Current period')}
                disabled={isCurrentTimelineWindow}
                onClick={onResetTimeline}
              >
                <RotateCcw size={14} />
                <span>{t('Current period')}</span>
              </button>
              <button
                className="budget-period-nav-button"
                type="button"
                title={t('Future periods')}
                aria-label={t('Future periods')}
                onClick={() => onShiftTimeline(1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <span className={`badge ${selectedTimelineDelta >= 0 ? 'badge-green' : 'badge-red'}`}>
              {selectedTimelineDelta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {formatMoney(Math.abs(selectedTimelineDelta))} {t('vs previous')}
            </span>
          </div>
        </div>

        <div className="budget-history-chart">
          <div className="budget-history-legend">
            <span className="legend-item"><i className="income" />{t('Income')}</span>
            <span className="legend-item"><i className="expense" />{t('Expenses')}</span>
          </div>
          <div className="budget-history-bars">
            {timelinePoints.map((point) => (
              <button
                key={point.key}
                className={`budget-history-point ${selectedTimelinePoint?.key === point.key ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSelectedTimelineKey(point.key)}
              >
                <div className="budget-history-bar-pair">
                  <div className="bar-stack">
                    <span className="bar income" style={{ height: `${Math.max(4, (point.income / timelineMax) * 100)}%` }}>
                      <span className="bar-glow" />
                    </span>
                    <span className="bar expense" style={{ height: `${Math.max(4, (point.expense / timelineMax) * 100)}%` }}>
                      <span className="bar-glow" />
                    </span>
                  </div>
                </div>
                <strong className="point-label">{point.label}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="summary-strip-new">
          <div className="summary-item">
            <span className="summary-label">{t('Balance')}</span>
            <strong className="summary-value" style={{ color: selectedTimelineBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {formatMoney(selectedTimelineBalance)}
            </strong>
          </div>
          <div className="summary-divider" />
          <div className="summary-item">
            <span className="summary-label">{t('Selected period')}</span>
            <strong className="summary-value">{selectedTimelinePoint?.label}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
