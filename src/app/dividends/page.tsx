'use client';

import { formatChartAxis, getChartDomain } from '@/lib/charts/scale';
import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import { buildDividendInsights } from '@/lib/dividends/dividend-insights';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import { AlertTriangle, CalendarDays, Coins } from 'lucide-react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ChartTooltipPayload = {
  color?: string;
  name?: string | number;
  value?: string | number;
};

function DividendChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  emptyLabel,
  seriesLabel,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string | number;
  valueFormatter: (value: number) => string;
  emptyLabel: string;
  seriesLabel: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip-card">
      <div className="chart-tooltip-label">{String(label ?? emptyLabel)}</div>
      {payload.map((entry) => {
        const value = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
        return (
          <div key={`${entry.name ?? 'total'}-${entry.color ?? 'series'}`} className="chart-tooltip-row">
            <span className="chart-tooltip-name">
              <span className="chart-tooltip-dot" style={{ background: entry.color ?? 'var(--series-dividends)' }} />
              {seriesLabel}
            </span>
            <span className="chart-tooltip-value">
              {Number.isFinite(value) ? valueFormatter(value) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function DividendsPage() {
  const { t, language } = useAppTranslation();
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const { formatMoney, displayCurrency, eurToUsdRate } = useDisplayCurrencyPreference();
  const [transactions, setTransactions] = useState<AppTransaction[]>(() => getAllTransactions());

  useEffect(() => {
    const syncTransactions = () => {
      setTransactions(getAllTransactions());
    };

    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener('storage', syncTransactions);

    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener('storage', syncTransactions);
    };
  }, []);

  const holdings = useMemo(() => deriveHoldingsFromTransactions(transactions), [transactions]);
  const insights = useMemo(
    () => buildDividendInsights(transactions, holdings, { locale: numberLocale }),
    [holdings, numberLocale, transactions],
  );
  const nextEventByAsset = useMemo(() => {
    const grouped = new Map<
      string,
      {
        date: string;
        amount: number;
        confidence: 'high' | 'medium' | 'low';
        events: number;
      }
    >();

    for (const item of insights.calendar) {
      const current = grouped.get(item.symbol);
      if (!current) {
        grouped.set(item.symbol, {
          date: item.date,
          amount: item.amount,
          confidence: item.confidence,
          events: 1,
        });
      } else {
        grouped.set(item.symbol, {
          ...current,
          events: current.events + 1,
        });
      }
    }

    return grouped;
  }, [insights.calendar]);

  const monthlyDomain = useMemo(() => getChartDomain(insights.monthlyTotals.map(point => point.total), { includeZero: true }), [insights.monthlyTotals]);
  const displayFactor = displayCurrency === 'eur' ? 1 : eurToUsdRate ?? NaN;
  const displayDomain: [number, number] = [monthlyDomain[0] * displayFactor, monthlyDomain[1] * displayFactor];
  const axisOptions = { currencySymbol: displayCurrency === 'eur' ? '€' : '$' };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="page-title">
            <Coins size={24} style={{ display: 'inline', marginRight: 8 }} />
            {t('Dividends')}
          </h1>
        </div>
      </div>

      <div className="page-content animate-in">
        <PageQuickStart
          description={t('This page reads your booked dividend transactions and turns them into income insights.')}
          steps={[
            t('Book dividends in Transactions first.'),
            t('Read trailing 12-month income before relying on the forecast.'),
            t('Use the calendar as a planning tool, not as a broker-confirmed schedule.'),
          ]}
          note={t('Forecast dates are estimated from past cadence, so they are useful for planning but not guaranteed.')}
        />

        {insights.calculationStatus === 'insufficient_fx_data' ? (
          <div className="callout warn">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>{t('Dividend totals unavailable')}</strong>
              <div style={{ marginTop: 4 }}>
                {t('A reliable FX conversion is required before non-EUR dividends can be aggregated.')}
                {' '}
                {t('Missing FX quotes')}: {insights.missingFxQuotes.join(', ')}
              </div>
            </div>
          </div>
        ) : (
          <>
        <div className="summary-strip">
          <div className="summary-item">
            <span>{t('All booked dividends')}</span>
            <strong>{formatMoney(insights.allTimeTotal)}</strong>
          </div>
          <div className="summary-item">
            <span>{t('Trailing 12 months')}</span>
            <strong>{formatMoney(insights.trailing12Months)}</strong>
          </div>
          <div className="summary-item">
            <span>{t('Forecast next 12 months')}</span>
            <strong>{formatMoney(insights.forecast12Months)}</strong>
          </div>
          <div className="summary-item">
            <span>{t('Average month')}</span>
            <strong>{formatMoney(insights.averageMonthlyTrailing)}</strong>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="panel-header">
                <div>
                  <div className="section-title">{t('Dividend Trend')}</div>
                  <div className="panel-subtitle">
                    {t(`Last 12 booked months in ${displayCurrency.toUpperCase()}.`)}
                  </div>
                </div>
              </div>

            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={insights.monthlyTotals} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickSize={0}
                    tickMargin={12}
                    tickFormatter={(value: number) => formatChartAxis(value * displayFactor, displayDomain, numberLocale, axisOptions)}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11, stroke: 'var(--bg-card)', strokeWidth: 2, paintOrder: 'stroke' }}
                    orientation={language === 'ar' ? 'right' : 'left'}
                    domain={monthlyDomain}
                    width="auto"
                  />
                  <Tooltip
                    content={(
                      <DividendChartTooltip
                        valueFormatter={(value) => formatMoney(value)}
                        emptyLabel={t('Selected month')}
                        seriesLabel={t('Dividend')}
                      />
                    )}
                    cursor={{ fill: 'var(--surface-accent-soft)' }}
                  />
                  <Bar
                    dataKey="total"
                    fill="var(--series-dividends)"
                    maxBarSize={48}
                    radius={[10, 10, 0, 0]}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Annual Totals')}</div>
                <div className="panel-subtitle">{t('Income grouped by calendar year.')}</div>
              </div>
            </div>

            <div className="table-container" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('Year')}</th>
                    <th>{t('Payments')}</th>
                    <th>{t('Total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.annualTotals.map((row) => (
                    <tr key={row.year}>
                      <td>{row.year}</td>
                      <td>{row.payments}</td>
                      <td className="mono">{formatMoney(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="table-toolbar">
            <div>
              <div className="section-title">{t('Dividend Outlook')}</div>
              <div className="panel-subtitle">
                {t('Forecast, cadence, and the next expected payment in one planning table.')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-blue">{t(`${insights.assets.length} payers`)}</span>
              <span className="badge badge-green">
                <CalendarDays size={12} />
                {t(`${insights.calendar.length} upcoming events`)}
              </span>
            </div>
          </div>

          {insights.assets.length > 0 ? (
            <div className="table-container" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('Asset')}</th>
                    <th>{t('Cadence')}</th>
                    <th>{t('Trailing 12M')}</th>
                    <th>{t('Forecast 12M')}</th>
                    <th>{t('Next payment')}</th>
                    <th>{t('Confidence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.assets.map((asset) => {
                    const nextEvent = nextEventByAsset.get(asset.symbol);

                    return (
                      <tr key={asset.symbol}>
                        <td>
                          <strong>{asset.symbol}</strong>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            {t(`${asset.payments} booked payments`)}
                          </div>
                        </td>
                        <td>
                          {t(asset.cadenceLabel)}
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            {asset.yieldOnCostPct === null ? `${t('Yield on cost')} —` : `${t('Yield on cost')} ${asset.yieldOnCostPct.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                          </div>
                        </td>
                        <td className="mono">{formatMoney(asset.trailing12Months)}</td>
                        <td className="mono">{formatMoney(asset.forecast12Months)}</td>
                        <td>
                          {nextEvent ? new Date(nextEvent.date).toLocaleDateString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US') : t('No forecast')}
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            {nextEvent
                              ? t(`${formatMoney(nextEvent.amount)} · ${nextEvent.events} event${nextEvent.events > 1 ? 's' : ''} ahead`)
                              : t('At least two past payments help build a schedule')}
                          </div>
                        </td>
                        <td>
                          <span style={{ textTransform: 'capitalize' }}>{nextEvent ? t(nextEvent.confidence) : t(asset.confidence)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">{t('No dividends booked yet. Add one in Transactions first.')}</div>
          )}
        </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
