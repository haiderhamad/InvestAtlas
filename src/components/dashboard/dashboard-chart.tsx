'use client';

import React from 'react';
import { PORTFOLIO_CHART_MARGIN, PortfolioValueAxis } from '@/components/charts/portfolio-value-axis';
import { getChartDomain } from '@/lib/charts/scale';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';

interface DashboardChartProps {
  data: any[];
}

const formatPct = (value: number, locale: string = 'de-DE') => `${value >= 0 ? '+' : ''}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export default function DashboardChart({ data }: DashboardChartProps) {
  const { t, language } = useAppTranslation();
  const { formatMoney } = useDisplayCurrencyPreference();

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const domain = getChartDomain(data.flatMap(point => [point.marketValue, point.invested]));

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart data={data} margin={PORTFOLIO_CHART_MARGIN}>
        <defs>
          <linearGradient id="dashboardPortfolioFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--series-market)" stopOpacity={0.16} />
            <stop offset="95%" stopColor="var(--series-market)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.6} />
        <XAxis
          dataKey="shortDate"
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickMargin={14}
          height={40}
          minTickGap={60}
          padding={{ left: 0, right: 0 }}
        />
        <PortfolioValueAxis yAxisId="value" domain={domain} locale={numberLocale} isRtl={language === 'ar'} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) {
              return null;
            }

            const point = payload[0]?.payload;
            if (!point) {
              return null;
            }

            const tooltipRowStyle = {
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              fontSize: 13,
            } satisfies React.CSSProperties;

            return (
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  color: 'var(--text-primary)',
                  padding: 14,
                  minWidth: 220,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</div>
                <div style={tooltipRowStyle}>
                  <span>{t('Portfolio value')}</span>
                  <strong>{formatMoney(point.marketValue)}</strong>
                </div>
                <div style={tooltipRowStyle}>
                  <span>{t('Invested capital')}</span>
                  <strong>{formatMoney(point.invested)}</strong>
                </div>
                <div style={tooltipRowStyle}>
                  <span>{t('Unrealized P&L')}</span>
                  <strong style={{ color: point.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {point.pnl >= 0 ? '+' : '-'}{formatMoney(Math.abs(point.pnl))}
                  </strong>
                </div>
                <div style={tooltipRowStyle}>
                  <span>{t('Performance')}</span>
                  <strong style={{ color: point.pnlPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {formatPct(point.pnlPct, language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US')}
                  </strong>
                </div>
                <div style={tooltipRowStyle}>
                  <span>{t('Dividends recorded')}</span>
                  <strong>
                    {point.monthlyDividends > 0
                      ? t(`${formatMoney(point.monthlyDividends)} this month`)
                      : formatMoney(point.cumulativeDividends)}
                  </strong>
                </div>
              </div>
            );
          }}
        />
        <Area
          yAxisId="value"
          type="monotone"
          dataKey="marketValue"
          stroke="var(--series-market)"
          fill="url(#dashboardPortfolioFill)"
          strokeWidth={2.4}
          isAnimationActive={false}
          name="marketValue"
        />
        <Line
          yAxisId="value"
          type="monotone"
          dataKey="invested"
          stroke="var(--series-invested)"
          strokeDasharray="6 6"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name="invested"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
