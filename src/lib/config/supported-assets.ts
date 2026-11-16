import { symbolToCoinGeckoId } from '@/lib/prices/coingecko';
import { SUPPORTED_COINS } from './supported-coins';
import { ShariahStatus } from '@/lib/types/shariah';
import {
  isShariahCompliant,
  resolveShariahDecision,
  type ShariahDecisionStatus,
} from '@/lib/shariah/decision';

export type AssetClass = 'crypto' | 'stock' | 'etf' | 'metal';
export type QuoteCurrency = 'eur' | 'usd';

export interface EtfPurificationConfig {
  selfPurified: boolean;
  perSharePurificationNative?: number;
  ratePeriod?: string;
  source?: string;
}

export interface AssetCompliance {
  status: ShariahStatus;
  reason?: string;
  auditSource?: string;
  lastAuditDate?: string;
}


export interface AssetConfig {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  nativeCurrency: QuoteCurrency;
  yahooSymbol?: string;
  yahooFallbackSymbol?: string;
  coinGeckoId?: string;
  isin?: string;
  wkn?: string;
  searchAliases?: string[];
  taxRegime: 'private_sale' | 'capital_income';
  unitLabel?: string;
  purification?: EtfPurificationConfig;
  compliance?: AssetCompliance;
}

export const ASSET_CLASS_ORDER: AssetClass[] = ['crypto', 'stock', 'etf', 'metal'];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  crypto: 'Crypto',
  stock: 'Stocks',
  etf: 'ETFs',
  metal: 'Metals',
};

export const ASSET_CLASS_BADGE_CLASSES: Record<AssetClass, string> = {
  crypto: 'badge-crypto',
  stock: 'badge-stock',
  etf: 'badge-etf',
  metal: 'badge-metal',
};

export const ASSET_CLASS_OPTIONS: Array<{ value: AssetClass; label: string }> = [
  { value: 'crypto', label: ASSET_CLASS_LABELS.crypto },
  { value: 'stock', label: ASSET_CLASS_LABELS.stock },
  { value: 'etf', label: ASSET_CLASS_LABELS.etf },
  { value: 'metal', label: ASSET_CLASS_LABELS.metal },
];

export const SUPPORTED_STOCK_ASSETS: AssetConfig[] = [
  { symbol: 'AAPL', name: 'Apple', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'AAPL', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Passes Shariah financial ratios (Debt/MCap < 33%)', auditSource: 'Zoya / Musaffa' } },
  { symbol: 'MSFT', name: 'Microsoft', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'MSFT', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Business activity and debt ratios compliant', auditSource: 'Zoya' } },
  { symbol: 'NVDA', name: 'NVIDIA', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'NVDA', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Tech sector, compliant financials', auditSource: 'Musaffa' } },
  { symbol: 'AMZN', name: 'Amazon', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'AMZN', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Mixed income within limits, debt compliant', auditSource: 'Zoya' } },
  { symbol: 'GOOGL', name: 'Alphabet', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'GOOGL', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Passes debt and liquidity filters', auditSource: 'Musaffa' } },
  { symbol: 'META', name: 'Meta Platforms', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'META', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Social media activity generally compliant', auditSource: 'Zoya' } },
  { symbol: 'TSLA', name: 'Tesla', assetClass: 'stock', nativeCurrency: 'usd', yahooSymbol: 'TSLA', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Automotive/Energy, compliant ratios', auditSource: 'Zoya' } },
  { symbol: 'SAP', name: 'SAP', assetClass: 'stock', nativeCurrency: 'eur', yahooSymbol: 'SAP.DE', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Software services, compliant', auditSource: 'Musaffa' } },
  { symbol: 'ASML', name: 'ASML Holding', assetClass: 'stock', nativeCurrency: 'eur', yahooSymbol: 'ASML.AS', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Semiconductor equipment, compliant', auditSource: 'Zoya' } },
  { symbol: 'SIE', name: 'Siemens', assetClass: 'stock', nativeCurrency: 'eur', yahooSymbol: 'SIE.DE', taxRegime: 'capital_income', compliance: { status: 'Compliant', reason: 'Industrial, compliant ratios', auditSource: 'Musaffa' } },
];

export const SUPPORTED_ETF_ASSETS: AssetConfig[] = [
  {
    symbol: 'ISWD',
    name: 'iShares MSCI World Islamic UCITS ETF',
    assetClass: 'etf',
    nativeCurrency: 'eur',
    yahooSymbol: 'IUSD.DE',
    isin: 'IE00B27YCN58',
    wkn: 'A0NA46',
    searchAliases: ['IUSD', 'IUSD.DE', 'ISWD.L', 'ISWD.SW', 'ISWD.S'],
    taxRegime: 'capital_income',
    purification: {
      selfPurified: false,
      perSharePurificationNative: 0.00299,
      ratePeriod: '2025-05',
      source: 'iShares Islamic Distribution Report',
    },
    compliance: { status: 'Compliant', reason: 'Certified Shariah-compliant index tracking', auditSource: 'MSCI Shariah Committee' },
  },
  {
    symbol: 'ISUS',
    name: 'iShares MSCI USA Islamic UCITS ETF',
    assetClass: 'etf',
    nativeCurrency: 'eur',
    yahooSymbol: 'IUSF.DE',
    isin: 'IE00B296QM64',
    wkn: 'A0NA0N',
    searchAliases: ['IUSF', 'IUSF.DE', 'ISUS.L', 'ISDU.L'],
    taxRegime: 'capital_income',
    purification: {
      selfPurified: false,
      perSharePurificationNative: 0.00282,
      ratePeriod: '2025-05',
      source: 'iShares Islamic Distribution Report',
    },
    compliance: { status: 'Compliant', reason: 'Certified Shariah-compliant index tracking', auditSource: 'MSCI Shariah Committee' },
  },
  {
    symbol: 'ISDE',
    name: 'iShares MSCI EM Islamic UCITS ETF',
    assetClass: 'etf',
    nativeCurrency: 'eur',
    yahooSymbol: 'IUSE.DE',
    isin: 'IE00B27YCP72',
    wkn: 'A0NA47',
    searchAliases: ['IUSE', 'IUSE.DE', 'ISDE.L'],
    taxRegime: 'capital_income',
    purification: {
      selfPurified: false,
      perSharePurificationNative: 0.00202,
      ratePeriod: '2025-05',
      source: 'iShares Islamic Distribution Report',
    },
    compliance: { status: 'Compliant', reason: 'Certified Shariah-compliant index tracking', auditSource: 'MSCI Shariah Committee' },
  },
  {
    symbol: 'HLAL',
    name: 'Wahed FTSE USA Shariah ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'HLAL',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'Wahed Invest — issuer handles purification',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'Wahed Shariah Board' },
  },
  {
    symbol: 'UMMA',
    name: 'Wahed Dow Jones Islamic World ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'UMMA',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'Wahed Invest — issuer handles purification',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'Wahed Shariah Board' },
  },
  {
    symbol: 'SPUS',
    name: 'SP Funds S&P 500 Sharia Industry Exclusions ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'SPUS',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'SP Funds prospectus — issuer purifies',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'S&P Shariah Board' },
  },
  {
    symbol: 'SPWO',
    name: 'SP Funds S&P World ex-US ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'SPWO',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'SP Funds prospectus — issuer purifies',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'S&P Shariah Board' },
  },
  {
    symbol: 'SPTE',
    name: 'SP Funds S&P Global Technology ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'SPTE',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'SP Funds prospectus — issuer purifies',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'S&P Shariah Board' },
  },
  {
    symbol: 'SPRE',
    name: 'SP Funds S&P Global REIT Sharia ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'SPRE',
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'SP Funds prospectus — issuer purifies',
    },
    compliance: { status: 'Compliant', reason: 'Issuer-level Shariah certification', auditSource: 'S&P Shariah Board' },
  },
  {
    symbol: 'IVSI',
    name: 'Invesco Dow Jones Islamic Global Developed Markets UCITS ETF',
    assetClass: 'etf',
    nativeCurrency: 'usd',
    yahooSymbol: 'IGDA.L',
    isin: 'IE000UOXRAM8',
    searchAliases: ['IGDA', 'IGDA.L'],
    taxRegime: 'capital_income',
    purification: {
      selfPurified: true,
      source: 'Invesco Shariah Prospectus',
    },
    compliance: { status: 'Compliant', reason: 'Certified Shariah-compliant index tracking', auditSource: 'Dow Jones Shariah Committee' },
  },
];

export const SUPPORTED_METAL_ASSETS: AssetConfig[] = [
  {
    symbol: 'GOLD',
    name: 'Gold',
    assetClass: 'metal',
    nativeCurrency: 'usd',
    yahooSymbol: 'XAUUSD=X',
    yahooFallbackSymbol: 'GC=F',
    coinGeckoId: 'pax-gold',
    taxRegime: 'private_sale',
    unitLabel: 'g',
    compliance: { status: 'Compliant', reason: 'Physical commodity (Haqiqi), compliant', auditSource: 'AAOIFI Shariah Standard' },
  },
  {
    symbol: 'SILVER',
    name: 'Silver',
    assetClass: 'metal',
    nativeCurrency: 'usd',
    yahooSymbol: 'XAGUSD=X',
    yahooFallbackSymbol: 'SI=F',
    coinGeckoId: 'kinesis-silver',
    taxRegime: 'private_sale',
    unitLabel: 'g',
    compliance: { status: 'Compliant', reason: 'Physical commodity (Haqiqi), compliant', auditSource: 'AAOIFI Shariah Standard' },
  },
];

export const SUPPORTED_CRYPTO_ASSETS: AssetConfig[] = SUPPORTED_COINS.map((coin) => ({
  symbol: coin.symbol,
  name: coin.name,
  assetClass: 'crypto',
  nativeCurrency: 'usd',
  yahooSymbol: coin.symbol,
  coinGeckoId: symbolToCoinGeckoId(coin.symbol) ?? undefined,
  taxRegime: 'private_sale',
}));

export const SUPPORTED_ASSETS: AssetConfig[] = [
  ...SUPPORTED_CRYPTO_ASSETS,
  ...SUPPORTED_STOCK_ASSETS,
  ...SUPPORTED_ETF_ASSETS,
  ...SUPPORTED_METAL_ASSETS,
];

export const SUPPORTED_ASSETS_BY_CLASS: Record<AssetClass, AssetConfig[]> = {
  crypto: SUPPORTED_CRYPTO_ASSETS,
  stock: SUPPORTED_STOCK_ASSETS,
  etf: SUPPORTED_ETF_ASSETS,
  metal: SUPPORTED_METAL_ASSETS,
};

export function getSupportedAssetsByClass(assetClass: AssetClass): AssetConfig[] {
  return SUPPORTED_ASSETS_BY_CLASS[assetClass];
}

export function getAssetConfig(symbol: string): AssetConfig | undefined {
  const normalized = symbol.trim().toUpperCase();
  return SUPPORTED_ASSETS.find((asset) => asset.symbol === normalized);
}

export function normalizeAssetIdentifier(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function getAssetIdentifiers(asset: AssetConfig): string[] {
  const identifiers = [
    asset.symbol,
    asset.yahooSymbol,
    asset.yahooFallbackSymbol,
    asset.isin,
    asset.wkn,
    ...(asset.searchAliases ?? []),
  ];

  return Array.from(
    new Set(
      identifiers
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim().toUpperCase()),
    ),
  );
}

export function getAssetTickers(asset: AssetConfig): string[] {
  return getAssetIdentifiers(asset).filter((identifier) => (
    identifier !== asset.symbol &&
    identifier !== asset.isin &&
    identifier !== asset.wkn
  ));
}

export function getAssetSearchTokens(asset: AssetConfig): string[] {
  return [
    asset.symbol,
    asset.name,
    asset.yahooSymbol,
    asset.yahooFallbackSymbol,
    asset.isin,
    asset.wkn,
    ...(asset.searchAliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function findAssetByIdentifier(
  value: string | null | undefined,
  assetClass?: AssetClass,
): AssetConfig | undefined {
  const normalized = normalizeAssetIdentifier(value);
  if (!normalized) return undefined;

  const candidates = assetClass ? SUPPORTED_ASSETS_BY_CLASS[assetClass] : SUPPORTED_ASSETS;
  return candidates.find((asset) =>
    getAssetIdentifiers(asset).some((identifier) => normalizeAssetIdentifier(identifier) === normalized),
  );
}

export function isCryptoAsset(symbol: string): boolean {
  return getAssetConfig(symbol)?.assetClass === 'crypto';
}

export function isStockAsset(symbol: string): boolean {
  return getAssetConfig(symbol)?.assetClass === 'stock';
}

export function isETFAsset(symbol: string): boolean {
  return getAssetConfig(symbol)?.assetClass === 'etf';
}

export function isMetalAsset(symbol: string): boolean {
  return getAssetConfig(symbol)?.assetClass === 'metal';
}

export function isCapitalIncomeAssetClass(assetClass: AssetClass): boolean {
  return assetClass === 'stock' || assetClass === 'etf';
}

/**
 * Returns assets that can be tracked by the demo. Tracking eligibility is not a
 * Shariah decision; callers must render the asset's evidence-backed status.
 */
export function getTrackableAssetsByClass(assetClass: AssetClass): AssetConfig[] {
  return SUPPORTED_ASSETS_BY_CLASS[assetClass];
}

/**
 * Resolves the current trust status for a configured asset.
 *
 * The legacy catalogue contains descriptive source labels but no auditable
 * evidence date. Those entries therefore require review rather than being
 * promoted to a positive compliance decision.
 */
export function getAssetShariahStatus(
  assetOrSymbol: AssetConfig | string,
): ShariahDecisionStatus {
  const asset = typeof assetOrSymbol === 'string'
    ? getAssetConfig(assetOrSymbol)
    : assetOrSymbol;
  if (!asset?.compliance) return 'insufficient_data';

  return resolveShariahDecision({
    legacyStatus: asset.compliance.status,
    hasVerifiedEvidence: Boolean(
      asset.compliance.auditSource?.trim() && asset.compliance.lastAuditDate?.trim(),
    ),
    requiresManualReview: asset.compliance.status === 'Doubtful',
  });
}

/**
 * @deprecated Use getTrackableAssetsByClass for selectors and
 * getAssetShariahStatus for trust decisions.
 */
export function getHalalAssetsByClass(assetClass: AssetClass): AssetConfig[] {
  return SUPPORTED_ASSETS_BY_CLASS[assetClass].filter(
    (asset) => isShariahCompliant(getAssetShariahStatus(asset)),
  );
}

/**
 * Checks if an asset is currently compliant.
 */
export function isAssetHalal(symbol: string): boolean {
  return isShariahCompliant(getAssetShariahStatus(symbol));
}
