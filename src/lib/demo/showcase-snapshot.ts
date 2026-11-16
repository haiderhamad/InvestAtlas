import type { AssetClass } from '@/lib/config/supported-assets';
import type { ShariahDecisionStatus } from '@/lib/shariah/decision';

export type DemoAssetClass = AssetClass | 'cash';
export type DemoCurrency = 'EUR';

export interface DemoDatasetManifest {
  readonly datasetVersion: string;
  readonly dataAsOf: string;
  readonly publishedAt: string;
  readonly mode: 'demo_snapshot';
  readonly realtime: false;
  readonly synthetic: true;
  readonly readOnly: true;
  readonly personalData: false;
  readonly provenanceId: string;
  readonly disclosure: string;
}

export interface DemoDatasetProvenance {
  readonly id: string;
  readonly datasetVersion: string;
  readonly sourceKind: 'investatlas_authored_synthetic';
  readonly sourceName: 'InvestAtlas synthetic showcase data';
  readonly quality: 'demo';
  readonly externalProvider: null;
  readonly externalSourceUrl: null;
  readonly realtime: false;
  readonly synthetic: true;
  readonly personalData: false;
  readonly asOf: string;
}

export interface DemoAsset {
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: DemoAssetClass;
  readonly nativeCurrency: DemoCurrency;
  readonly fictional: true;
  readonly provenanceRef: string;
}

export type DemoTransactionType = 'deposit' | 'buy' | 'sell' | 'dividend';
export type DemoTransactionTaxType =
  | 'cash_in'
  | 'acquisition'
  | 'disposal'
  | 'dividend_income';

export interface ShowcaseDemoTransaction {
  readonly id: string;
  readonly date: string;
  readonly venue: 'InvestAtlas Synthetic Brokerage';
  readonly type: DemoTransactionType;
  readonly asset: string;
  readonly assetClass: DemoAssetClass;
  readonly quote: DemoCurrency;
  readonly amount: number;
  readonly price: number;
  readonly total: number;
  readonly fee: number;
  readonly metalFineness?: number;
  readonly taxType: DemoTransactionTaxType;
  readonly source: 'demo_snapshot';
  readonly provenanceRef: string;
}

export interface ShowcaseDemoHolding {
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: DemoAssetClass;
  readonly amount: number;
  /** Fine-metal-equivalent grams; amount remains the gross ledger weight. */
  readonly fineMetalAmount?: number;
  readonly avgCost: number;
  readonly currentPrice: number;
  readonly costBasis: number;
  readonly value: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly allocation: number;
  readonly currency: DemoCurrency;
  readonly venue: 'InvestAtlas Synthetic Brokerage';
  readonly source: 'demo_snapshot';
  readonly provenanceRef: string;
}

export interface DemoWatchlist {
  readonly id: string;
  readonly name: string;
  readonly symbols: ReadonlyArray<string>;
  readonly source: 'demo_snapshot';
  readonly provenanceRef: string;
}

export interface DemoHistoryPoint {
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
}

export interface DemoHistorySeries {
  readonly symbol: string;
  readonly currency: DemoCurrency;
  readonly interval: '1d';
  readonly dataAsOf: string;
  readonly realtime: false;
  readonly quality: 'demo';
  readonly points: ReadonlyArray<DemoHistoryPoint>;
  readonly provenanceRef: string;
}

export interface DemoPortfolioHistoryPoint {
  readonly date: string;
  readonly total: number;
  readonly cash: number;
  readonly stocks: number;
  readonly etfs: number;
  readonly crypto: number;
  readonly metals: number;
}

export interface DemoShariahExample {
  readonly assetSymbol: string;
  readonly status: ShariahDecisionStatus;
  readonly methodology: 'investatlas_transparent_demo_methodology';
  readonly evidenceState: 'complete' | 'requires_review' | 'missing';
  readonly requiresManualReview: boolean;
  readonly religiousAuthorityClaimed: false;
  readonly reason: string;
  readonly checkedAt: string;
  readonly source: 'synthetic_methodology_example';
  readonly provenanceRef: string;
}

export type DemoPurificationExample =
  | {
      readonly assetSymbol: string;
      readonly status: 'available';
      readonly inputState: 'known';
      readonly amountEur: number;
      readonly reason: 'known_zero' | 'calculated_from_known_demo_inputs';
      readonly source: 'synthetic_methodology_example';
      readonly provenanceRef: string;
    }
  | {
      readonly assetSymbol: string;
      readonly status: 'review_required' | 'insufficient_data';
      readonly inputState: 'partial' | 'missing';
      readonly amountEur: null;
      readonly reason: 'manual_review_needed' | 'required_input_missing';
      readonly source: 'synthetic_methodology_example';
      readonly provenanceRef: string;
    };

export interface InvestAtlasShowcaseSnapshot {
  readonly manifest: DemoDatasetManifest;
  readonly provenance: DemoDatasetProvenance;
  readonly assets: ReadonlyArray<DemoAsset>;
  readonly transactions: ReadonlyArray<ShowcaseDemoTransaction>;
  readonly holdings: ReadonlyArray<ShowcaseDemoHolding>;
  readonly watchlists: ReadonlyArray<DemoWatchlist>;
  readonly history: Readonly<Record<string, DemoHistorySeries>>;
  readonly portfolioHistory: ReadonlyArray<DemoPortfolioHistoryPoint>;
  readonly portfolioHistoryProvenanceRef: string;
  readonly shariahExamples: ReadonlyArray<DemoShariahExample>;
  readonly purificationExamples: ReadonlyArray<DemoPurificationExample>;
}

// Frozen, illustrative prices calibrated to the 2026-11-03 market context.
// No live provider is ever contacted by demo. EUR per instrument; GOLD is EUR per fine gram.
const DATASET_VERSION = '2026-11-03-v2';
const DATA_AS_OF = '2026-11-03T18:00:00.000Z';
const PUBLISHED_AT = '2026-11-03T19:00:00.000Z';
const PROVENANCE_ID = 'investatlas-demo-2026-11-03-v2';
const SYNTHETIC_VENUE = 'InvestAtlas Synthetic Brokerage' as const;
const HISTORY_POINT_COUNT = 90;

const CURRENT_PRICES: Readonly<Record<string, number>> = {
  'DEMO-STOCK': 297,
  'DEMO-CIVIC': 58,
  'DEMO-ETF': 60.4,
  'DEMO-CRYPTO': 335,
  'DEMO-GOLD': 112.82,
  EUR: 1,
};

const ASSETS: ReadonlyArray<DemoAsset> = [
  {
    symbol: 'DEMO-STOCK',
    name: 'Apple (AAPL) illustrative stock',
    assetClass: 'stock',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
  {
    symbol: 'DEMO-CIVIC',
    name: 'Atlas Synthetic Civic Commerce',
    assetClass: 'stock',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
  {
    symbol: 'DEMO-ETF',
    name: 'Islamic UCITS ETF (ISWD) illustrative holding',
    assetClass: 'etf',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
  {
    symbol: 'DEMO-CRYPTO',
    name: 'Nur Synthetic Network',
    assetClass: 'crypto',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
  {
    symbol: 'DEMO-GOLD',
    name: 'Gold (XAU) illustrative fine-gram holding',
    assetClass: 'metal',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
  {
    symbol: 'EUR',
    name: 'Euro Demo Cash',
    assetClass: 'cash',
    nativeCurrency: 'EUR',
    fictional: true,
    provenanceRef: PROVENANCE_ID,
  },
];

const TRANSACTIONS: ReadonlyArray<ShowcaseDemoTransaction> = [
  {
    id: 'demo-2026-08-v1-deposit-001',
    date: '2026-01-05T09:00:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'deposit',
    asset: 'EUR',
    assetClass: 'cash',
    quote: 'EUR',
    amount: 25_000,
    price: 1,
    total: 25_000,
    fee: 0,
    taxType: 'cash_in',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-buy-stock-001',
    date: '2026-01-12T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'buy',
    asset: 'DEMO-STOCK',
    assetClass: 'stock',
    quote: 'EUR',
    amount: 40,
    price: 120,
    total: 4_800,
    fee: 4.8,
    taxType: 'acquisition',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-buy-civic-001',
    date: '2026-02-03T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'buy',
    asset: 'DEMO-CIVIC',
    assetClass: 'stock',
    quote: 'EUR',
    amount: 60,
    price: 70,
    total: 4_200,
    fee: 4.2,
    taxType: 'acquisition',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-buy-etf-001',
    date: '2026-02-18T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'buy',
    asset: 'DEMO-ETF',
    assetClass: 'etf',
    quote: 'EUR',
    amount: 80,
    price: 50,
    total: 4_000,
    fee: 4,
    taxType: 'acquisition',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-buy-crypto-001',
    date: '2026-03-02T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'buy',
    asset: 'DEMO-CRYPTO',
    assetClass: 'crypto',
    quote: 'EUR',
    amount: 12,
    price: 300,
    total: 3_600,
    fee: 3.6,
    taxType: 'acquisition',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-11-03-v2-buy-gold-001',
    date: '2026-03-16T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'buy',
    asset: 'DEMO-GOLD',
    assetClass: 'metal',
    metalFineness: 999.9,
    quote: 'EUR',
    amount: 10,
    price: 100,
    total: 1_000,
    fee: 1,
    taxType: 'acquisition',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-sell-stock-001',
    date: '2026-06-15T15:30:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'sell',
    asset: 'DEMO-STOCK',
    assetClass: 'stock',
    quote: 'EUR',
    amount: 5,
    price: 135,
    total: 675,
    fee: 1,
    taxType: 'disposal',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
  {
    id: 'demo-2026-08-v1-dividend-stock-001',
    date: '2026-07-01T09:00:00.000Z',
    venue: SYNTHETIC_VENUE,
    type: 'dividend',
    asset: 'DEMO-STOCK',
    assetClass: 'stock',
    quote: 'EUR',
    amount: 35,
    price: 1.2,
    total: 42,
    fee: 0,
    taxType: 'dividend_income',
    source: 'demo_snapshot',
    provenanceRef: PROVENANCE_ID,
  },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function dateOnly(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildHoldings(
  assets: ReadonlyArray<DemoAsset>,
  transactions: ReadonlyArray<ShowcaseDemoTransaction>,
): ShowcaseDemoHolding[] {
  const positions = new Map<string, { amount: number; costBasis: number; fineMetalAmount: number }>();
  let cash = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'deposit') {
      cash += transaction.total - transaction.fee;
      continue;
    }
    if (transaction.type === 'dividend') {
      cash += transaction.total - transaction.fee;
      continue;
    }

    const position = positions.get(transaction.asset) ?? {
      amount: 0,
      costBasis: 0,
      fineMetalAmount: 0,
    };
    if (transaction.assetClass === 'metal' && transaction.metalFineness === undefined) {
      throw new Error('Synthetic metal transactions require explicit fineness.');
    }
    const fineMetalAmount = transaction.assetClass === 'metal'
      ? transaction.amount * Number(transaction.metalFineness) / 1_000
      : 0;

    if (transaction.type === 'buy') {
      position.amount += transaction.amount;
      position.fineMetalAmount += fineMetalAmount;
      position.costBasis += transaction.total + transaction.fee;
      cash -= transaction.total + transaction.fee;
    } else {
      const avgCost = position.amount > 0
        ? position.costBasis / position.amount
        : 0;
      position.amount -= transaction.amount;
      position.fineMetalAmount -= fineMetalAmount;
      position.costBasis -= avgCost * transaction.amount;
      cash += transaction.total - transaction.fee;
    }

    positions.set(transaction.asset, position);
  }

  positions.set('EUR', { amount: cash, costBasis: cash, fineMetalAmount: 0 });

  const withoutAllocation = assets.flatMap((asset) => {
    const position = positions.get(asset.symbol);
    if (!position || position.amount <= 0) return [];

    const currentPrice = CURRENT_PRICES[asset.symbol];
    const value = (asset.assetClass === 'metal' ? position.fineMetalAmount : position.amount) * currentPrice;
    const pnl = asset.assetClass === 'cash' ? 0 : value - position.costBasis;
    const pnlPct = asset.assetClass === 'cash' || position.costBasis === 0
      ? 0
      : (pnl / position.costBasis) * 100;

    return [{
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      amount: round(position.amount, 8),
      ...(asset.assetClass === 'metal' ? { fineMetalAmount: round(position.fineMetalAmount, 8) } : {}),
      avgCost: round(position.costBasis / position.amount, 8),
      currentPrice: round(currentPrice, 8),
      costBasis: round(position.costBasis),
      value: round(value),
      pnl: round(pnl),
      pnlPct: round(pnlPct),
      allocation: 0,
      currency: 'EUR' as const,
      venue: SYNTHETIC_VENUE,
      source: 'demo_snapshot' as const,
      provenanceRef: PROVENANCE_ID,
    }];
  });

  const totalValue = withoutAllocation.reduce(
    (sum, holding) => sum + holding.value,
    0,
  );

  return withoutAllocation.map((holding) => ({
    ...holding,
    allocation: round((holding.value / totalValue) * 100, 6),
  }));
}

interface HistoryShape {
  readonly startRatio: number;
  readonly wave: number;
  readonly phase: number;
  readonly baseVolume: number | null;
}

const HISTORY_SHAPES: Readonly<Record<string, HistoryShape>> = {
  'DEMO-STOCK': { startRatio: 0.83, wave: 0.025, phase: 0.4, baseVolume: 680_000 },
  'DEMO-CIVIC': { startRatio: 1.2, wave: 0.035, phase: 1.1, baseVolume: 420_000 },
  'DEMO-ETF': { startRatio: 0.91, wave: 0.012, phase: 2.2, baseVolume: 155_000 },
  'DEMO-CRYPTO': { startRatio: 0.72, wave: 0.065, phase: 0.8, baseVolume: 2_400_000 },
  'DEMO-GOLD': { startRatio: 0.89, wave: 0.009, phase: 0.3, baseVolume: null },
  EUR: { startRatio: 1, wave: 0, phase: 0, baseVolume: null },
};

function buildHistorySeries(asset: DemoAsset): DemoHistorySeries {
  const shape = HISTORY_SHAPES[asset.symbol];
  const currentPrice = CURRENT_PRICES[asset.symbol];
  const endDate = dateOnly(DATA_AS_OF);
  const startDate = addUtcDays(endDate, -(HISTORY_POINT_COUNT - 1));
  const lastIndex = HISTORY_POINT_COUNT - 1;

  const rawValue = (index: number) => {
    if (asset.assetClass === 'cash') return 1;
    const progress = index / lastIndex;
    const linear = shape.startRatio + (1 - shape.startRatio) * progress;
    const taper = Math.sin(Math.PI * progress);
    const wave = Math.sin((index + shape.phase) / 4.2) * shape.wave * taper;
    const secondaryWave = Math.cos((index + shape.phase) / 9.5) * shape.wave * 0.35 * taper;
    return linear + wave + secondaryWave;
  };

  const finalRaw = rawValue(lastIndex);
  let previousClose = round((currentPrice * rawValue(0)) / finalRaw, 4);
  const points: DemoHistoryPoint[] = [];

  for (let index = 0; index < HISTORY_POINT_COUNT; index += 1) {
    const close = index === lastIndex
      ? currentPrice
      : round((currentPrice * rawValue(index)) / finalRaw, 4);
    const open = asset.assetClass === 'cash'
      ? 1
      : index === 0
        ? round(close * 0.998, 4)
        : previousClose;
    const spread = asset.assetClass === 'cash'
      ? 0
      : 0.004 + Math.abs(Math.sin(index + shape.phase)) * 0.004;
    const high = round(Math.max(open, close) * (1 + spread), 4);
    const low = round(Math.min(open, close) * (1 - spread * 0.82), 4);
    const volume = shape.baseVolume === null
      ? null
      : Math.round(
          shape.baseVolume
          * (1 + Math.sin((index + shape.phase) / 3.3) * 0.18)
          * (1 + (index % 7) * 0.012),
        );

    points.push({
      date: addUtcDays(startDate, index),
      open,
      high,
      low,
      close,
      volume,
    });
    previousClose = close;
  }

  return {
    symbol: asset.symbol,
    currency: 'EUR',
    interval: '1d',
    dataAsOf: DATA_AS_OF,
    realtime: false,
    quality: 'demo',
    points,
    provenanceRef: PROVENANCE_ID,
  };
}

function buildPortfolioHistory(
  holdings: ReadonlyArray<ShowcaseDemoHolding>,
  history: Readonly<Record<string, DemoHistorySeries>>,
): DemoPortfolioHistoryPoint[] {
  const cash = holdings.find((holding) => holding.assetClass === 'cash')?.value ?? 0;
  const marketHoldings = holdings.filter((holding) => holding.assetClass !== 'cash');

  return history['DEMO-STOCK'].points.map((point, index) => {
    const values = marketHoldings.map((holding) => ({
      assetClass: holding.assetClass,
      value: (holding.assetClass === 'metal' ? holding.fineMetalAmount ?? 0 : holding.amount)
        * history[holding.symbol].points[index].close,
    }));
    const stocks = values
      .filter((value) => value.assetClass === 'stock')
      .reduce((sum, value) => sum + value.value, 0);
    const etfs = values
      .filter((value) => value.assetClass === 'etf')
      .reduce((sum, value) => sum + value.value, 0);
    const crypto = values
      .filter((value) => value.assetClass === 'crypto')
      .reduce((sum, value) => sum + value.value, 0);
    const metals = values
      .filter((value) => value.assetClass === 'metal')
      .reduce((sum, value) => sum + value.value, 0);

    return {
      date: point.date,
      total: round(cash + stocks + etfs + crypto + metals),
      cash: round(cash),
      stocks: round(stocks),
      etfs: round(etfs),
      crypto: round(crypto),
      metals: round(metals),
    };
  });
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  Object.freeze(value);
}

export function createInvestAtlasShowcaseSnapshot(): InvestAtlasShowcaseSnapshot {
  const assets = ASSETS.map((asset) => ({ ...asset }));
  const transactions = TRANSACTIONS.map((transaction) => ({ ...transaction }));
  const holdings = buildHoldings(assets, transactions);
  const history = Object.fromEntries(
    assets.map((asset) => [asset.symbol, buildHistorySeries(asset)]),
  );

  const snapshot: InvestAtlasShowcaseSnapshot = {
    manifest: {
      datasetVersion: DATASET_VERSION,
      dataAsOf: DATA_AS_OF,
      publishedAt: PUBLISHED_AT,
      mode: 'demo_snapshot',
      realtime: false,
      synthetic: true,
      readOnly: true,
      personalData: false,
      provenanceId: PROVENANCE_ID,
      disclosure: 'Synthetic InvestAtlas showcase data: illustrative values calibrated near the 2026-11-03 market context, not actual sourced closing prices. GOLD is EUR per fine gram, not a troy-ounce quote. Static and read-only; not live market or personal data.',
    },
    provenance: {
      id: PROVENANCE_ID,
      datasetVersion: DATASET_VERSION,
      sourceKind: 'investatlas_authored_synthetic',
      sourceName: 'InvestAtlas synthetic showcase data',
      quality: 'demo',
      externalProvider: null,
      externalSourceUrl: null,
      realtime: false,
      synthetic: true,
      personalData: false,
      asOf: DATA_AS_OF,
    },
    assets,
    transactions,
    holdings,
    watchlists: [{
      id: 'demo-2026-08-v1-watchlist-core',
      name: 'Synthetic showcase assets',
      symbols: ['DEMO-STOCK', 'DEMO-CIVIC', 'DEMO-ETF', 'DEMO-CRYPTO', 'DEMO-GOLD'],
      source: 'demo_snapshot',
      provenanceRef: PROVENANCE_ID,
    }],
    history,
    portfolioHistory: buildPortfolioHistory(holdings, history),
    portfolioHistoryProvenanceRef: PROVENANCE_ID,
    shariahExamples: [
      {
        assetSymbol: 'DEMO-STOCK',
        status: 'compliant',
        methodology: 'investatlas_transparent_demo_methodology',
        evidenceState: 'complete',
        requiresManualReview: false,
        religiousAuthorityClaimed: false,
        reason: 'Synthetic evidence satisfies every required field in the implemented demo methodology.',
        checkedAt: DATA_AS_OF,
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-CIVIC',
        status: 'non_compliant',
        methodology: 'investatlas_transparent_demo_methodology',
        evidenceState: 'complete',
        requiresManualReview: false,
        religiousAuthorityClaimed: false,
        reason: 'A synthetic core-activity input fails the implemented demo methodology.',
        checkedAt: DATA_AS_OF,
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-ETF',
        status: 'review_required',
        methodology: 'investatlas_transparent_demo_methodology',
        evidenceState: 'requires_review',
        requiresManualReview: true,
        religiousAuthorityClaimed: false,
        reason: 'The synthetic ETF certificate evidence is intentionally marked for manual review.',
        checkedAt: DATA_AS_OF,
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-CRYPTO',
        status: 'insufficient_data',
        methodology: 'investatlas_transparent_demo_methodology',
        evidenceState: 'missing',
        requiresManualReview: true,
        religiousAuthorityClaimed: false,
        reason: 'Required synthetic protocol evidence is intentionally absent; no positive result is inferred.',
        checkedAt: DATA_AS_OF,
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
    ],
    purificationExamples: [
      {
        assetSymbol: 'DEMO-STOCK',
        status: 'available',
        inputState: 'known',
        amountEur: 0,
        reason: 'known_zero',
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-ETF',
        status: 'available',
        inputState: 'known',
        amountEur: 1.44,
        reason: 'calculated_from_known_demo_inputs',
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-CIVIC',
        status: 'review_required',
        inputState: 'partial',
        amountEur: null,
        reason: 'manual_review_needed',
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
      {
        assetSymbol: 'DEMO-CRYPTO',
        status: 'insufficient_data',
        inputState: 'missing',
        amountEur: null,
        reason: 'required_input_missing',
        source: 'synthetic_methodology_example',
        provenanceRef: PROVENANCE_ID,
      },
    ],
  };

  deepFreeze(snapshot);
  return snapshot;
}

/**
 * An inert, read-only fixture. Runtime workspaces must opt in explicitly; this
 * module is intentionally not imported by Local Workspace or Firebase stores.
 */
export const INVESTATLAS_SHOWCASE_SNAPSHOT = createInvestAtlasShowcaseSnapshot();

export function getDemoSnapshotAsOfDay(
  transactions: ReadonlyArray<{ source?: unknown }>,
): string | undefined {
  return transactions.length > 0
    && transactions.every(
      (transaction) => transaction.source === 'demo'
        || transaction.source === 'demo_snapshot',
    )
    ? INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf.slice(0, 10)
    : undefined;
}
