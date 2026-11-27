import { YAxis } from 'recharts';
import { formatChartAxis, type ChartDomain } from '@/lib/charts/scale';

export const PORTFOLIO_CHART_MARGIN = { top: 0, right: 4, bottom: 0, left: 4 };

export function PortfolioValueAxis({ domain, locale, isRtl, suffix, yAxisId }: {
  domain: ChartDomain;
  locale: string;
  isRtl: boolean;
  suffix?: string;
  yAxisId?: string;
}) {
  return (
    <YAxis
      yAxisId={yAxisId}
      domain={domain}
      orientation={isRtl ? 'right' : 'left'}
      width="auto"
      axisLine={false}
      tickLine={false}
      tickSize={0}
      tickMargin={12}
      tickFormatter={(value: number) => formatChartAxis(value, domain, locale, { suffix })}
      tick={{ fill: 'var(--text-muted)', fontSize: 11, stroke: 'var(--bg-card)', strokeWidth: 2, paintOrder: 'stroke' }}
    />
  );
}
