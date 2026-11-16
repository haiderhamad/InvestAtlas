import React, { useMemo, useState } from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Sector,
  Tooltip
} from 'recharts';
import { type CategoryRow } from '../../../lib/budget/budget-utils';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface CategoryListProps {
  rows: CategoryRow[];
  total: number;
  hoveredCategoryId?: string | null;
  setHoveredCategoryId: (id: string | undefined) => void;
  formatMoney: (val: number) => string;
  t: (key: string) => string;
}

/**
 * Refined CategoryList component following the Portfolio/Analytics pattern.
 * More compact, premium progress bars, and better spacing.
 */
export function CategoryList({
  rows,
  total,
  hoveredCategoryId,
  setHoveredCategoryId,
  formatMoney,
  t,
}: CategoryListProps) {
  const { language } = useAppTranslation();
  return (
    <div className="budget-category-list-refined">
      {rows.map((row) => {
        const pct = total > 0 ? (row.value / total) * 100 : 0;
        const isActive = hoveredCategoryId === row.id;
        
        return (
          <div
            key={row.id}
            className={`budget-category-item-compact ${isActive ? 'is-active' : ''}`}
            onMouseEnter={() => setHoveredCategoryId(row.id)}
            onMouseLeave={() => setHoveredCategoryId(undefined)}
          >
            <div className="item-main-row">
              <div className="item-label-group">
                <span className="cat-dot" style={{ backgroundColor: row.color, boxShadow: isActive ? `0 0 10px ${row.color}80` : 'none' }} />
                <span className="cat-name">{t(row.label)}</span>
              </div>
              <div className="item-values">
                <span className="cat-value">{formatMoney(row.value)}</span>
                <span className="cat-pct">{pct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: pct >= 10 ? 0 : 2, maximumFractionDigits: pct >= 10 ? 0 : 2 })}%</span>
              </div>
            </div>
            <div className="cat-progress-container">
              <div
                className="cat-progress-fill"
                style={{ 
                  width: `${pct}%`, 
                  backgroundColor: row.color,
                  opacity: isActive ? 1 : 0.7,
                  boxShadow: isActive ? `0 0 8px ${row.color}40` : 'none'
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface BudgetDonutChartProps {
  rows: CategoryRow[];
  total: number;
  centerLabel: string;
  emptyLabel: string;
  hoveredCategoryId?: string | null;
  setHoveredCategoryId: (id: string | undefined) => void;
  formatMoney: (val: number) => string;
  t: (key: string) => string;
}

/**
 * Custom active slice renderer with a glow effect.
 */
function renderActivePieSlice(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;

  return (
    <g>
      <defs>
        <filter id="budget-donut-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 3}
        outerRadius={outerRadius + 3}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="var(--bg-card)"
        strokeWidth={2}
        filter="url(#budget-donut-glow)"
      />
    </g>
  );
}

/**
 * Modernized Donut Chart component.
 * More compact sizing and better center alignment.
 */
export function BudgetDonutChart({
  rows,
  total,
  centerLabel,
  emptyLabel,
  hoveredCategoryId,
  setHoveredCategoryId,
  formatMoney,
  t,
}: BudgetDonutChartProps) {
  const chartData = useMemo(() => {
    return rows
      .filter((row) => row.value > 0)
      .map((row) => ({
        id: row.id,
        name: row.label,
        value: row.value,
        color: row.color,
      }));
  }, [rows]);

  const activeIndex = useMemo(() => {
    if (!hoveredCategoryId) return undefined;
    const idx = chartData.findIndex((d) => d.id === hoveredCategoryId);
    return idx === -1 ? undefined : idx;
  }, [chartData, hoveredCategoryId]);

  if (chartData.length === 0) {
    return (
      <div className="budget-donut-shell empty">
        <div className="empty-state-content">
          <div className="empty-icon-shell">
            <div className="empty-icon-ring" />
          </div>
          <p>{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-donut-shell-compact">
      <div className="budget-donut-chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="78%"
              outerRadius="92%"
              paddingAngle={2.5}
              {...({
                activeIndex: activeIndex,
                activeShape: renderActivePieSlice
              } as any)}
              onMouseEnter={(_, index) => setHoveredCategoryId(chartData[index].id)}
              onMouseLeave={() => setHoveredCategoryId(undefined)}
              isAnimationActive={true}
              animationDuration={600}
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${entry.id}`} 
                  fill={entry.color} 
                  fillOpacity={activeIndex === undefined || activeIndex === index ? 1 : 0.5}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        
        <div className="budget-donut-center-overlay">
          <span className="center-eyebrow">{centerLabel}</span>
          <strong className="center-amount">{formatMoney(total)}</strong>
        </div>
      </div>
    </div>
  );
}
