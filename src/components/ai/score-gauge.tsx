'use client';

import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface Props {
  /** 0-100 */
  score: number;
  size?: number;
}

/**
 * Radial score gauge.
 *
 * 270° arc (from 8 o'clock around to 4 o'clock), filled clockwise from 0 to `score`.
 * A neutral blue scale visualizes an application-derived evidence-agreement score.
 */
export default function ScoreGauge({ score, size = 156 }: Props) {
  const { t } = useAppTranslation();
  const safeScore = Math.max(0, Math.min(100, score));
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // 270° arc: start at 135°, sweep 270° to 405° (== 45°).
  // SVG y-axis is flipped, so we compute polar manually.
  const ARC_DEG = 270;
  const START_DEG = 135;

  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const arcPath = (fromDeg: number, toDeg: number): string => {
    const start = polar(fromDeg);
    const end = polar(toDeg);
    const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const trackPath = arcPath(START_DEG, START_DEG + ARC_DEG);
  const fillToDeg = START_DEG + (ARC_DEG * safeScore) / 100;
  const fillPath = arcPath(START_DEG, fillToDeg);

  const color = 'var(--accent-blue)';
  const shadowHex = '#659dff';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--asset-neutral-soft)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{
            transition: 'd 600ms cubic-bezier(0.2, 0.8, 0.2, 1), stroke 300ms ease',
            filter: `drop-shadow(0 0 6px ${shadowHex}55)`,
          }}
        />
        {/* Tick marks at 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((t) => {
          const deg = START_DEG + (ARC_DEG * t) / 100;
          const inner = radius - stroke / 2 - 4;
          const outer = radius - stroke / 2 - 1;
          const rad = (deg * Math.PI) / 180;
          const i = { x: cx + inner * Math.cos(rad), y: cy + inner * Math.sin(rad) };
          const o = { x: cx + outer * Math.cos(rad), y: cy + outer * Math.sin(rad) };
          return (
            <line
              key={t}
              x1={i.x}
              y1={i.y}
              x2={o.x}
              y2={o.y}
              stroke="var(--asset-neutral-border)"
              strokeWidth={1}
            />
          );
        })}
      </svg>

      {/* Center label */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: size * 0.28,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1,
            letterSpacing: '-2px',
          }}
        >
          {Math.round(safeScore)}
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '1px',
            marginTop: 4,
          }}
        >
          / 100
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            letterSpacing: '1.5px',
            marginTop: 6,
          }}
        >
          {t('Direction')}
        </div>
      </div>
    </div>
  );
}
