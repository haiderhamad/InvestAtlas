'use client';

import { useState } from 'react';
import { Bitcoin, Coins, Gem, Layers, LineChart, Wallet, type LucideIcon } from 'lucide-react';
import { getAssetIconUrl } from '@/lib/config/asset-icon-sources';
import type { AssetClass } from '@/lib/config/supported-assets';

interface AssetIconProps {
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  size?: number;
  color?: string;
}

const CATEGORY_ICON_META: Record<string, { icon: LucideIcon; label: string }> = {
  crypto: { icon: Bitcoin, label: 'Crypto' },
  stock: { icon: LineChart, label: 'Stocks' },
  etf: { icon: Layers, label: 'ETFs' },
  metal: { icon: Gem, label: 'Metals' },
  cash: { icon: Wallet, label: 'Cash' },
};

const CATEGORY_SYMBOLS: Record<string, string> = {
  CRYPTO: 'crypto',
  STOCK: 'stock',
  STOCKS: 'stock',
  ETF: 'etf',
  ETFS: 'etf',
  METAL: 'metal',
  METALS: 'metal',
  CASH: 'cash',
  SAVING_CASH: 'cash',
  CASH_RESERVE: 'cash',
};

function iconSoftBackground(color: string, alpha = 18) {
  return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
}

function iconBorderColor(color: string, alpha = 44) {
  return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
}

export function AssetIcon({ symbol, name, assetClass, size = 34, color = 'var(--accent-blue)' }: AssetIconProps) {
  // A failed open-licensed crypto icon must not suppress subsequent assets.
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const normalizedSymbol = symbol.trim().toUpperCase();
  const categoryAssetClass = CATEGORY_SYMBOLS[normalizedSymbol];

  if (categoryAssetClass) {
    const { icon: Icon, label } = CATEGORY_ICON_META[categoryAssetClass];

    return (
      <div
        role="img"
        aria-label={name || label}
        title={name || label}
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(8, Math.round(size * 0.34)),
          background: iconSoftBackground(color),
          border: `1px solid ${iconBorderColor(color)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          flexShrink: 0,
        }}
      >
        <Icon size={Math.max(12, Math.round(size * 0.62))} strokeWidth={2.3} />
      </div>
    );
  }

  if (assetClass === 'metal' && (normalizedSymbol === 'GOLD' || normalizedSymbol === 'SILVER')) {
    const metalColor = normalizedSymbol === 'GOLD' ? '#b18b28' : '#8493a5';
    return (
      <div
        role="img"
        aria-label={name || symbol}
        title={name || symbol}
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          background: iconSoftBackground(metalColor),
          border: `1px solid ${iconBorderColor(metalColor)}`,
          color: metalColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Coins size={Math.max(12, Math.round(size * 0.62))} strokeWidth={2.2} aria-hidden="true" />
      </div>
    );
  }

  const iconUrl = getAssetIconUrl(normalizedSymbol, assetClass);
  if (iconUrl && failedIconUrl !== iconUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          overflow: 'hidden',
          background: 'var(--surface-soft)',
          border: '1px solid var(--surface-border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <img
          src={iconUrl}
          alt={name || symbol}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: '70%', height: '70%', objectFit: 'contain' }}
          onError={() => setFailedIconUrl(iconUrl)}
        />
      </div>
    );
  }

  // Fallback to initials
  return (
    <div
      role="img"
      aria-label={name || symbol}
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: iconSoftBackground(color),
        border: `1px solid ${iconBorderColor(color)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size > 30 ? 9 : 8,
        letterSpacing: '-0.4px',
        fontWeight: 700,
        color,
        flexShrink: 0
      }}
    >
      {normalizedSymbol.slice(0, size > 30 ? 5 : 4)}
    </div>
  );
}
