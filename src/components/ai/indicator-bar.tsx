'use client';

import type { IndicatorReading } from '@/lib/ai/analyzer';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface Props {
  indicator: IndicatorReading;
}

const STATUS_COLOR: Record<string, string> = {
  bullish: '#10b981',
  bearish: '#ef4444',
  neutral: '#94a3b8',
};

const STATUS_LABEL: Record<string, string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
};

/**
 * Single indicator row with a visual position bar appropriate to its kind.
 *
 * - price_vs_ma → diverging bar centered at the moving average, marker at current price
 * - rsi         → 0-100 horizontal scale with overbought/oversold zones and a marker
 * - macd        → diverging bar centered at zero showing line vs signal
 * - momentum    → diverging bar around 0%
 * - generic     → no bar, just label + value
 */
export default function IndicatorBar({ indicator }: Props) {
  const { t } = useAppTranslation();
  const color = STATUS_COLOR[indicator.status] ?? '#94a3b8';
  const Icon = indicator.status === 'bullish' ? TrendingUp : indicator.status === 'bearish' ? TrendingDown : Minus;
  const localizedDetail = (() => {
    if (!indicator.detail) return null;
    const histogram = /^Histogram (.+) · (positive|negative|flat)$/u.exec(indicator.detail);
    if (histogram) {
      return `${t('Histogram')} ${histogram[1]} · ${t(histogram[2])}`;
    }
    const comparison = /^(.+) vs (.+)$/u.exec(indicator.detail);
    if (comparison) {
      return `${comparison[1]} ${t('vs')} ${comparison[2]}`;
    }
    return t(indicator.detail);
  })();

  return (
    <div
      className="indicator-bar-row"
      style={{
        display: 'grid',
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid rgba(148, 163, 184, 0.06)',
      }}
    >
      {/* Label + detail */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t(indicator.label)}
        </div>
        {localizedDetail && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={localizedDetail}
            dir="auto"
          >
            {localizedDetail}
          </div>
        )}
      </div>

      {/* Visual bar */}
      <div style={{ minWidth: 0 }}>
        <BarRenderer indicator={indicator} color={color} />
      </div>

      {/* Status pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          justifyContent: 'flex-end',
        }}
      >
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 700,
              color,
              lineHeight: 1.2,
            }}
          >
            {indicator.value}
          </div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color,
              letterSpacing: '0.8px',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              justifyContent: 'flex-end',
              marginTop: 2,
            }}
          >
            <Icon size={10} />
            {t(STATUS_LABEL[indicator.status])}
          </div>
        </div>
      </div>
    </div>
  );
}

function BarRenderer({ indicator, color }: { indicator: IndicatorReading; color: string }) {
  switch (indicator.kind) {
    case 'price_vs_ma':
    case 'macd':
    case 'momentum':
      return <DivergingBar indicator={indicator} color={color} />;
    case 'rsi':
      return <RsiScale value={indicator.numbers?.current ?? 50} color={color} />;
    default:
      return <div style={{ height: 8 }} />;
  }
}

/**
 * Diverging horizontal bar centered at 50%. Reads positive deviation to the right (green),
 * negative to the left (red). Used for price vs SMA, MACD line vs signal, and momentum.
 */
function DivergingBar({ indicator, color }: { indicator: IndicatorReading; color: string }) {
  // Compute a normalized -1..+1 deviation that we can render visually.
  let deviation = 0;

  if (indicator.kind === 'price_vs_ma' && indicator.numbers?.current && indicator.numbers?.reference) {
    const dev = (indicator.numbers.current - indicator.numbers.reference) / indicator.numbers.reference;
    // Cap at ±10% for visual range — anything beyond pins to the edge.
    deviation = Math.max(-1, Math.min(1, dev / 0.1));
  } else if (indicator.kind === 'macd' && indicator.numbers?.current !== undefined && indicator.numbers?.reference !== undefined) {
    // MACD is unbounded; normalize by the larger absolute of the two so the bar is always informative.
    const span = Math.max(Math.abs(indicator.numbers.current), Math.abs(indicator.numbers.reference), 1);
    deviation = Math.max(-1, Math.min(1, (indicator.numbers.current - indicator.numbers.reference) / span));
  } else if (indicator.kind === 'momentum' && indicator.numbers?.current !== undefined) {
    // Momentum value is already a percent. Cap at ±15%.
    deviation = Math.max(-1, Math.min(1, indicator.numbers.current / 15));
  }

  // Convert deviation to bar geometry — bar grows from 50% center outward.
  const center = 50;
  const halfWidth = Math.abs(deviation) * 50;
  const barLeft = deviation >= 0 ? center : center - halfWidth;
  const barWidth = halfWidth;

  return (
    <div
      style={{
        position: 'relative',
        height: 22,
        background: 'rgba(148, 163, 184, 0.06)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {/* Center divider */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 4,
          bottom: 4,
          width: 1,
          background: 'rgba(148, 163, 184, 0.3)',
          transform: 'translateX(-0.5px)',
        }}
      />
      {/* Filled bar */}
      <div
        style={{
          position: 'absolute',
          left: `${barLeft}%`,
          top: 5,
          bottom: 5,
          width: `${barWidth}%`,
          background: color,
          opacity: 0.85,
          borderRadius: 2,
          transition: 'left 600ms cubic-bezier(0.2, 0.8, 0.2, 1), width 600ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          boxShadow: `0 0 8px ${color}40`,
        }}
      />
    </div>
  );
}

/**
 * RSI 0-100 scale with shaded oversold (<30) and overbought (>70) zones,
 * and a triangular marker at the current value.
 */
function RsiScale({ value, color }: { value: number; color: string }) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div style={{ position: 'relative', height: 22 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(148, 163, 184, 0.06)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {/* Oversold zone (0-30) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '30%',
            background: 'rgba(16, 185, 129, 0.12)',
          }}
        />
        {/* Overbought zone (70-100) */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '30%',
            background: 'rgba(239, 68, 68, 0.12)',
          }}
        />
        {/* 30 / 50 / 70 grid lines */}
        {[30, 50, 70].map((t) => (
          <div
            key={t}
            style={{
              position: 'absolute',
              left: `${t}%`,
              top: 4,
              bottom: 4,
              width: 1,
              background: 'rgba(148, 163, 184, 0.25)',
              transform: 'translateX(-0.5px)',
            }}
          />
        ))}
      </div>
      {/* Marker */}
      <div
        style={{
          position: 'absolute',
          left: `${safeValue}%`,
          top: -2,
          bottom: -2,
          width: 3,
          background: color,
          transform: 'translateX(-1.5px)',
          boxShadow: `0 0 6px ${color}88`,
          borderRadius: 1,
          transition: 'left 600ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      />
    </div>
  );
}
