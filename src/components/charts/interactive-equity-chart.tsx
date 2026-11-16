'use client';

import { useMemo, useState } from 'react';
import { formatChartAxis, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface InteractiveEquitySeries {
  label: string;
  color: string;
  data: number[];
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

interface Props {
  dates: string[];
  series: InteractiveEquitySeries[];
  currencySymbol: string;
  referenceValue?: number;
  emptyLabel?: string;
  showAttribution?: boolean;
}

type RangeOption = '6M' | '1Y' | '3Y' | 'MAX';

type ChartRow = {
  date: string;
  timestamp: number;
  shortDate: string;
  [key: string]: string | number | null;
};

const rangeOptions: RangeOption[] = ['6M', '1Y', '3Y', 'MAX'];

const tooltipContentStyle = {
  backgroundColor: 'var(--tooltip-bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-sm)',
  color: 'var(--text-primary)',
  padding: '10px 12px',
};

const tooltipLabelStyle = {
  color: 'var(--text-primary)',
  fontWeight: 700,
  marginBottom: 6,
};

const tooltipItemStyle = {
  color: 'var(--text-secondary)',
  fontWeight: 700,
  padding: 0,
};

function formatTooltipCurrency(value: number, currencySymbol: string, locale: string): string {
  return `${currencySymbol}${value.toLocaleString(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function normalizeChartDate(input: string): string | null {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function formatShortDate(date: string, language: string, showDay = false): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    month: 'short',
    ...(showDay ? { day: 'numeric' as const } : { year: '2-digit' as const }),
    timeZone: 'UTC',
    calendar: 'gregory',
  }).format(parsed);
}

function formatFullDate(date: string, language: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
  }).format(parsed);
}

function rangeStartTimestamp(lastTimestamp: number, range: RangeOption): number {
  if (range === 'MAX') return Number.NEGATIVE_INFINITY;

  const date = new Date(lastTimestamp);
  if (range === '6M') {
    date.setUTCMonth(date.getUTCMonth() - 6);
  } else if (range === '1Y') {
    date.setUTCFullYear(date.getUTCFullYear() - 1);
  } else if (range === '3Y') {
    date.setUTCFullYear(date.getUTCFullYear() - 3);
  }
  return date.getTime();
}

function getStrokeDashArray(lineStyle?: InteractiveEquitySeries['lineStyle']) {
  if (lineStyle === 'dashed') return '6 5';
  if (lineStyle === 'dotted') return '2 5';
  return undefined;
}

function buildRows(dates: string[], series: InteractiveEquitySeries[], language: string) {
  const rowsByDate = new Map<string, ChartRow>();
  const seriesMeta = series.map((line, index) => ({
    ...line,
    key: `series_${index}`,
  }));
  const limit = Math.max(0, ...series.map((line) => line.data.length), dates.length);

  for (let index = 0; index < limit; index++) {
    const date = normalizeChartDate(dates[index] ?? '');
    if (!date) continue;

    const timestamp = new Date(`${date}T00:00:00Z`).getTime();
    if (!Number.isFinite(timestamp)) continue;

    const row: ChartRow = {
      date,
      timestamp,
      shortDate: formatShortDate(date, language),
    };

    for (const line of seriesMeta) {
      const value = line.data[index];
      row[line.key] = Number.isFinite(value) ? value : null;
    }

    rowsByDate.set(date, row);
  }

  return {
    rows: [...rowsByDate.values()].sort((left, right) => left.timestamp - right.timestamp),
    seriesMeta,
  };
}

const RenderCustomEquityTick = (props: any) => {
  const { x, y, payload, isRtl, formatter } = props;
  const formattedValue = formatter ? formatter(payload.value) : payload.value;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={isRtl ? 10 : -10}
        y={4}
        textAnchor={isRtl ? 'start' : 'end'}
        fill="none"
        stroke="var(--bg-card)"
        strokeWidth={2}
        fontSize={11}
        fontWeight="bold"
      >
        {formattedValue}
      </text>
      <text
        x={isRtl ? 10 : -10}
        y={4}
        textAnchor={isRtl ? 'start' : 'end'}
        fill="var(--text-muted)"
        fontSize={11}
      >
        {formattedValue}
      </text>
    </g>
  );
};

export default function InteractiveEquityChart({
  dates,
  series,
  currencySymbol,
  emptyLabel,
  showAttribution = false,
}: Props) {
  const { t, language } = useAppTranslation();
  const isRtl = language === 'ar';
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const [activeRange, setActiveRange] = useState<RangeOption>('MAX');

  const { rows, seriesMeta } = useMemo(() => buildRows(dates, series, language), [dates, series, language]);
  const visibleRows = useMemo(() => {
    const lastTimestamp = rows[rows.length - 1]?.timestamp;
    if (!Number.isFinite(lastTimestamp)) return rows;
    const startTimestamp = rangeStartTimestamp(lastTimestamp, activeRange);
    return rows.filter((row) => row.timestamp >= startTimestamp);
  }, [activeRange, rows]);

  const values = useMemo(() => visibleRows.flatMap(row =>
    seriesMeta.map(line => row[line.key]).filter((value): value is number => typeof value === 'number')
  ), [visibleRows, seriesMeta]);
  const domain = useMemo(() => getChartDomain(values), [values]);
  const showDay = visibleRows.length > 1 && visibleRows[visibleRows.length - 1].timestamp - visibleRows[0].timestamp <= 120 * 86_400_000;
  const axisOptions = { currencySymbol };

  const latestRow = visibleRows[visibleRows.length - 1];
  const latestDate = latestRow ? formatFullDate(latestRow.date, language) : t('Latest point');
  const fillSeries = seriesMeta.find((line) => line.lineStyle !== 'dashed') ?? seriesMeta[0];

  if (values.length === 0 || seriesMeta.length === 0) {
    return (
      <div className="interactive-equity-empty">
        {emptyLabel || t('No equity data available.')}
      </div>
    );
  }

  return (
    <div className="interactive-equity-shell" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="interactive-equity-toolbar">
        <div className="interactive-equity-spacer" aria-hidden="true" />

        <div className="interactive-equity-actions">
          <div className="interactive-equity-range" role="group" aria-label={t('Period')}>
            {rangeOptions.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setActiveRange(range)}
                aria-pressed={activeRange === range}
                className={`interactive-equity-range-button ${activeRange === range ? 'active' : ''}`}
              >
                {t(range)}
              </button>
            ))}
          </div>
          <span className="interactive-equity-date-pill">
            {latestDate}
          </span>
        </div>
      </div>

      <div className="interactive-equity-surface">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={visibleRows} margin={{ top: 0, right: 0, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id="strategyEquityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={fillSeries?.color ?? 'var(--series-market)'} stopOpacity={0.24} />
                <stop offset="95%" stopColor={fillSeries?.color ?? 'var(--series-market)'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeOpacity={0.4} strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={visibleRows.map(row => row.timestamp)}
              tickFormatter={(value) => formatShortDate(new Date(value).toISOString().slice(0, 10), language, showDay)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              minTickGap={60}

            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={(props: any) => (
                <RenderCustomEquityTick
                  {...props}
                  isRtl={isRtl}
                  formatter={(val: number) => {
                    return formatChartAxis(val, domain, numberLocale, axisOptions);
                  }}
                />
              )}
              orientation={isRtl ? 'right' : 'left'}
              domain={domain}
              width={getChartAxisWidth(domain, numberLocale, axisOptions)}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={{ stroke: 'var(--border-hover)', strokeDasharray: '4 4' }}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ChartRow | undefined;
                return row?.date ? formatFullDate(row.date, language) : t('Selected point');
              }}
              formatter={(value, name) => [
                formatTooltipCurrency(Number(value), currencySymbol, numberLocale),
                String(name),
              ]}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              wrapperStyle={{ color: 'var(--text-secondary)', paddingTop: 12 }}
              formatter={(value) => (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {String(value)}
                </span>
              )}
            />
            {seriesMeta.map((line) => {
              const isFillLine = line.key === fillSeries?.key;
              const commonProps = {
                dataKey: line.key,
                name: line.label,
                stroke: line.color,
                strokeWidth: line.lineStyle === 'dashed' ? 1.6 : 2.2,
                strokeDasharray: getStrokeDashArray(line.lineStyle),
                dot: false,
                activeDot: { r: 4, strokeWidth: 2 },
                isAnimationActive: false,
              };

              if (isFillLine) {
                return (
                  <Area
                    key={line.key}
                    {...commonProps}
                    type="monotone"
                    fill="url(#strategyEquityFill)"
                    fillOpacity={1}
                  />
                );
              }

              return (
                <Line
                  key={line.key}
                  {...commonProps}
                  type="monotone"
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {showAttribution ? (
        <div className="interactive-equity-attribution">
          {t('Chart data from the selected backtest run.')}
        </div>
      ) : null}
    </div>
  );
}
