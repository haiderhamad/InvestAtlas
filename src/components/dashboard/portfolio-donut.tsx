'use client';

import { useState } from 'react';
import { getDisplayCurrencyCode, useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { AssetIcon } from '@/components/ui/asset-icon';
import type { AssetClass } from '@/lib/config/supported-assets';

export interface DonutAsset {
  symbol: string;
  name: string;
  value: number;
  allocation: number;
  assetClass?: AssetClass;
  color?: string;
}

const ASSET_COLORS: Record<string, string> = {
  CRYPTO: 'var(--asset-crypto)',
  STOCK: 'var(--asset-stock)',
  STOCKS: 'var(--asset-stock)',
  ETF: 'var(--asset-etf)',
  ETFS: 'var(--asset-etf)',
  METAL: 'var(--asset-metal)',
  METALS: 'var(--asset-metal)',
  CASH: 'var(--asset-neutral)',
  SAVING_CASH: 'var(--asset-saving)',
  CASH_RESERVE: 'var(--asset-saving)',
  CRY: 'var(--asset-crypto)',
  STO: 'var(--asset-stock)',
  MET: 'var(--asset-metal)',
  BTC: 'var(--asset-crypto)',
  ETH: '#627eea',
  SOL: '#14f195',
  XRP:    '#22d3ee',
  ADA:    '#10b981',
  DOT:    '#e6007a',
  LINK:   '#3b82f6',
  AVAX:   '#ef4444',
  MATIC:  '#14b8a6',
  ATOM:   '#10b981',
  NEAR:   '#14b8a6',
  SUI:    '#06b6d4',
  INJ:    '#f97316',
  RENDER: '#84cc16',
  FET:    '#0d9488',
  TAO:    '#fb923c',
  ARB:    '#38bdf8',
  OP:     '#ff0420',
  TIA:    '#2dd4bf',
  SEI:    '#4ade80',
  APT:    '#fbbf24',
  ICP:    '#34d399',
  FIL:    '#a3e635',
  LTC:    '#94a3b8',
  IMX:    '#67e8f9',
};
const FALLBACK_COLORS = [
  'var(--asset-stock)',
  'var(--asset-crypto)',
  'var(--asset-etf)',
  'var(--asset-metal)',
  'var(--asset-saving)',
  '#ef4444',
  '#0ea5e9',
  '#84cc16',
];

export function assetColor(symbol: string, idx = 0): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  return ASSET_COLORS[normalizedSymbol] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

interface Props {
  assets: DonutAsset[];
  totalValue: number;
  countLabel?: string;
  hoveredSymbol?: string | null;
  onHover?: (symbol: string | null) => void;
}

function formatCompactMoney(value: number | null, currencyCode: 'EUR' | 'USD', language: string): string {
  if (value === null) return '—';
  const symbol = currencyCode === 'USD' ? '$' : '€';
  if (value >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  }
  if (value >= 1_000) {
    return `${symbol}${(value / 1_000).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
  }
  return `${symbol}${Math.round(value).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}`;
}

function formatLegendMoney(value: number, currencyCode: 'EUR' | 'USD', language: string): string {
  return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCenterHeading(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

export default function PortfolioDonut({ assets, totalValue, countLabel = 'Assets', hoveredSymbol, onHover }: Props) {
  const { t, language } = useAppTranslation();
  const { convertMoney, displayCurrency } = useDisplayCurrencyPreference();
  const [hovered, setHovered] = useState<string | null>(null);
  const activeHovered = hoveredSymbol || hovered;
  const currencyCode = getDisplayCurrencyCode(displayCurrency);

  const r = 40;
  const cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const sortedAssets = [...assets].sort((a, b) => b.value - a.value);
  const chartTotal = sortedAssets.reduce((sum, asset) => sum + Math.max(asset.value, 0), 0);
  const activeAssetsCount = sortedAssets.filter((a) => Math.max(a.value, 0) > 0).length;
  const segmentGap = activeAssetsCount > 1 ? 1.5 : 0;

  // Build segments using cumulative path lengths so each slice starts where the previous one ends.
  const { segments } = sortedAssets.reduce<{
    cumulativeLength: number;
    segments: Array<DonutAsset & { color: string; dash: number; offset: number }>;
  }>((acc, a, i) => {
    const color = a.color ?? assetColor(a.symbol, i);
    const rawLength = chartTotal > 0 ? (Math.max(a.value, 0) / chartTotal) * circ : 0;
    const dash = Math.max(rawLength - segmentGap, 0);

    return {
      cumulativeLength: acc.cumulativeLength + rawLength,
      segments: [
        ...acc.segments,
        {
          ...a,
          color,
          dash,
          offset: -acc.cumulativeLength,
        },
      ],
    };
  }, { cumulativeLength: 0, segments: [] });

  const activeSegments = segments.filter(s => Math.max(s.value, 0) > 0);

  // Center label: show hovered asset or total
  const hoveredAsset = activeHovered ? sortedAssets.find(a => a.symbol === activeHovered) : null;
  const centerLabel = hoveredAsset
    ? {
        top: hoveredAsset.symbol,
        mid: formatCompactMoney(convertMoney(hoveredAsset.value), currencyCode, language),
        bot: `${hoveredAsset.allocation.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% · ${formatCenterHeading(hoveredAsset.name)}`,
      }
    : {
        top: t('Total'),
        mid: formatCompactMoney(convertMoney(totalValue), currencyCode, language),
        bot: `${sortedAssets.length} ${t(countLabel).toLowerCase()}`,
      };

  if (sortedAssets.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
        {t('Loading…')}
      </div>
    );
  }

  return (
    <div>
      {/* SVG Donut */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
        <svg viewBox="0 0 100 100" style={{ width: 220, height: 220 }}>
          <defs>
            <filter id="portfolio-donut-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.9" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {/* Background track (only needed if there are gaps) */}
            {activeSegments.length > 1 && (
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={14} />
            )}

            {activeSegments.length === 1 ? (
              <circle
                key={activeSegments[0].symbol}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={activeSegments[0].color}
                strokeWidth={activeHovered === activeSegments[0].symbol ? 16 : 14}
                filter={activeHovered === activeSegments[0].symbol ? 'url(#portfolio-donut-glow)' : undefined}
                style={{
                  cursor: 'pointer',
                  transition: 'stroke-width 0.15s ease, opacity 0.15s ease',
                }}
                onMouseEnter={() => {
                  setHovered(activeSegments[0].symbol);
                  onHover?.(activeSegments[0].symbol);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  onHover?.(null);
                }}
              />
            ) : (
              activeSegments.map((s) => (
                <circle
                  key={s.symbol}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={activeHovered === s.symbol ? 16 : 14}
                  strokeDasharray={`${s.dash} ${circ - s.dash}`}
                  strokeDashoffset={s.offset}
                  filter={activeHovered === s.symbol ? 'url(#portfolio-donut-glow)' : undefined}
                  style={{
                    cursor: 'pointer',
                    transition: 'stroke-width 0.15s ease, opacity 0.15s ease',
                    opacity: activeHovered && activeHovered !== s.symbol ? 0.54 : 1,
                  }}
                  onMouseEnter={() => {
                    setHovered(s.symbol);
                    onHover?.(s.symbol);
                  }}
                  onMouseLeave={() => {
                    setHovered(null);
                    onHover?.(null);
                  }}
                />
              ))
            )}
          </g>

          {/* Center text */}
          <text
            x={cx}
            y={cy - 7}
            textAnchor="middle"
            fill="var(--text-secondary)"
            fontSize="5.2"
            fontWeight="600"
            fontFamily="var(--font-sans)"
          >
            {centerLabel.top}
          </text>
          <text
            x={cx}
            y={cy + 5}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="8.8"
            fontWeight="800"
            fontFamily="var(--font-sans)"
          >
            {centerLabel.mid}
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="4.5"
            fontFamily="var(--font-sans)"
          >
            {centerLabel.bot}
          </text>
        </svg>
      </div>


    </div>
  );
}
