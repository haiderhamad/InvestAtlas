import {
  getAssetConfig,
  SUPPORTED_ETF_ASSETS,
  type EtfPurificationConfig,
} from '@/lib/config/supported-assets';
import {
  DEFAULT_PURIFICATION_SETTINGS,
  type PurificationSettings,
  type StockPurificationMethod,
} from '@/lib/purification/purification-store';
import { normalizeTransactionToEur } from '@/lib/fx/quote-rates';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

export interface EtfPurificationRow {
  symbol: string;
  name: string;
  selfPurified: boolean;
  unitsHeld: number;
  nativeCurrency: 'eur' | 'usd' | 'unknown';
  perSharePurificationNative?: number;
  perSharePurificationEur?: number;
  purificationEur: number | null;
  ratePeriod?: string;
  source?: string;
  hasRate: boolean;
  status: 'calculated' | 'self_purified' | 'insufficient_data';
  missingReason?:
    | 'missing_rate'
    | 'stale_rate'
    | 'missing_fx'
    | 'unverified_self_purification'
    | 'unknown_asset'
    | 'invalid_ledger';
}

export interface StockPurificationSummary {
  method: StockPurificationMethod;
  basisEur: number | null;
  ratio: number;
  purificationEur: number | null;
  status: 'calculated' | 'insufficient_data';
  missingReason?:
    | 'unconfirmed_ratio'
    | 'missing_fx'
    | 'unknown_cost_basis'
    | 'invalid_ledger'
    | 'invalid_ratio';
}

export interface PurificationOverview {
  year: number;
  etfRows: EtfPurificationRow[];
  etfTotalEur: number | null;
  stocks: StockPurificationSummary;
  grandTotalEur: number | null;
}

function resolveEtfConfig(
  symbol: string,
  settings: PurificationSettings,
): EtfPurificationConfig | undefined {
  const override = settings.etfOverrides[symbol.trim().toUpperCase()];
  if (override) return override;
  return getAssetConfig(symbol)?.purification;
}

function endOfYearIso(year: number): string {
  return `${year}-12-31T23:59:59.999Z`;
}

const POSITION_EPSILON = 0.0000001;

interface UnitsHeldResult {
  units: number;
  invalidLedger: boolean;
}

function computeUnitsHeld(
  transactions: InvestmentTransaction[],
  symbol: string,
  year: number,
): UnitsHeldResult {
  const cutoff = new Date(endOfYearIso(year)).getTime();
  let units = 0;
  const normalizedSymbol = symbol.trim().toUpperCase();

  const relevantTransactions = transactions
    .filter(
      (tx) =>
        tx.assetClass === 'etf'
        && tx.asset.trim().toUpperCase() === normalizedSymbol,
    )
    .map((tx, inputIndex) => ({
      tx,
      inputIndex,
      timestamp: new Date(tx.date).getTime(),
    }))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp
        || left.inputIndex - right.inputIndex,
    );

  for (const { tx, timestamp } of relevantTransactions) {
    if (!Number.isFinite(timestamp)) {
      return { units, invalidLedger: true };
    }
    if (timestamp > cutoff) continue;
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      return { units, invalidLedger: true };
    }

    if (
      tx.type === 'buy' ||
      tx.type === 'deposit' ||
      (tx.type === 'transfer' && tx.taxType === 'transfer_in') ||
      tx.type === 'adjustment'
    ) {
      units += tx.amount;
    } else if (
      tx.type === 'sell' ||
      tx.type === 'withdrawal' ||
      (tx.type === 'transfer' && tx.taxType === 'transfer_out')
    ) {
      units -= tx.amount;
    } else {
      continue;
    }

    if (units < -POSITION_EPSILON) {
      return { units, invalidLedger: true };
    }
  }

  return {
    units: Math.abs(units) <= POSITION_EPSILON ? 0 : units,
    invalidLedger: false,
  };
}

type StockBasisMissingReason =
  | 'missing_fx'
  | 'unknown_cost_basis'
  | 'invalid_ledger';

interface StockBasisResult {
  value: number | null;
  missingReason?: StockBasisMissingReason;
}

function computeStockDividendsEur(
  transactions: InvestmentTransaction[],
  year: number,
): StockBasisResult {
  let total = 0;
  for (const tx of transactions) {
    if (
      tx.type !== 'dividend' ||
      tx.assetClass !== 'stock' ||
      new Date(tx.date).getUTCFullYear() !== year
    ) {
      continue;
    }
    const converted = normalizeTransactionToEur(tx.total, tx);
    if (converted === null) {
      return { value: null, missingReason: 'missing_fx' };
    }
    total += converted;
  }
  return { value: total };
}

function computeStockHoldingsEur(
  transactions: InvestmentTransaction[],
  year: number,
): StockBasisResult {
  const cutoff = new Date(endOfYearIso(year)).getTime();
  const bySymbol = new Map<string, { units: number; costEur: number }>();

  const ordered = transactions
    .filter((tx) => tx.assetClass === 'stock')
    .map((tx, inputIndex) => ({
      tx,
      inputIndex,
      timestamp: new Date(tx.date).getTime(),
    }))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp
        || left.inputIndex - right.inputIndex,
    );

  for (const { tx, timestamp } of ordered) {
    if (!Number.isFinite(timestamp)) {
      return { value: null, missingReason: 'invalid_ledger' };
    }
    if (timestamp > cutoff) continue;
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      return { value: null, missingReason: 'invalid_ledger' };
    }

    const symbol = tx.asset.trim().toUpperCase();
    const entry = bySymbol.get(symbol) ?? { units: 0, costEur: 0 };

    if (tx.type === 'buy') {
      const cost = normalizeTransactionToEur(tx.total + tx.fee, tx);
      if (cost === null) {
        return { value: null, missingReason: 'missing_fx' };
      }
      entry.units += tx.amount;
      entry.costEur += cost;
    } else if (
      tx.type === 'sell'
      || tx.type === 'withdrawal'
      || (tx.type === 'transfer' && tx.taxType === 'transfer_out')
    ) {
      if (tx.amount > entry.units + POSITION_EPSILON) {
        return { value: null, missingReason: 'invalid_ledger' };
      }
      const avgCost = entry.units > 0 ? entry.costEur / entry.units : 0;
      entry.units -= tx.amount;
      entry.costEur -= avgCost * tx.amount;
      if (entry.units <= POSITION_EPSILON) {
        entry.units = 0;
        entry.costEur = 0;
      }
    } else if (
      tx.type === 'deposit'
      || tx.type === 'adjustment'
      || (tx.type === 'transfer' && tx.taxType === 'transfer_in')
    ) {
      if (
        tx.transferredCostBasisStatus !== 'known'
        || !Number.isFinite(tx.transferredCostBasisEur)
        || (tx.transferredCostBasisEur as number) < 0
      ) {
        return { value: null, missingReason: 'unknown_cost_basis' };
      }
      entry.units += tx.amount;
      entry.costEur += tx.transferredCostBasisEur as number;
    } else {
      continue;
    }

    bySymbol.set(symbol, entry);
  }

  let total = 0;
  for (const { units, costEur } of bySymbol.values()) {
    if (units > POSITION_EPSILON && costEur >= 0) {
      total += costEur;
    }
  }
  return { value: total };
}

export function calculatePurification(
  transactions: InvestmentTransaction[],
  settings: PurificationSettings,
  year: number,
): PurificationOverview {
  const heldEtfSymbols = new Map<string, { name?: string; quote: string }>();
  for (const tx of transactions) {
    if (
      tx.assetClass === 'etf'
      && (
        tx.type === 'buy'
        || tx.type === 'sell'
        || tx.type === 'deposit'
        || tx.type === 'withdrawal'
        || tx.type === 'transfer'
        || tx.type === 'adjustment'
      )
    ) {
      heldEtfSymbols.set(tx.asset.trim().toUpperCase(), {
        name: tx.assetName,
        quote: tx.quote,
      });
    }
  }

  const etfRows: EtfPurificationRow[] = [];

  for (const [symbol, transactionMetadata] of heldEtfSymbols) {
    const assetConfig = getAssetConfig(symbol);
    const unitsResult = computeUnitsHeld(transactions, symbol, year);
    const unitsHeld = unitsResult.units;
    if (!unitsResult.invalidLedger && unitsHeld <= 0) continue;

    const config = resolveEtfConfig(symbol, settings);
    const selfPurified = config?.selfPurified ?? false;
    const perShareNative = config?.perSharePurificationNative;
    const nativeCurrency: EtfPurificationRow['nativeCurrency'] =
      assetConfig?.assetClass === 'etf'
        ? assetConfig.nativeCurrency
        : transactionMetadata.quote.trim().toUpperCase() === 'EUR'
          ? 'eur'
          : transactionMetadata.quote.trim().toUpperCase() === 'USD'
            ? 'usd'
            : 'unknown';
    const hasRate = (
      typeof perShareNative === 'number'
      && Number.isFinite(perShareNative)
      && perShareNative >= 0
    );
    const hasCurrentRate = Boolean(
      hasRate &&
      config?.ratePeriod?.startsWith(String(year)) &&
      config?.source?.trim(),
    );
    const hasCurrentSelfPurificationEvidence = Boolean(
      selfPurified &&
      config?.ratePeriod?.startsWith(String(year)) &&
      config?.source?.trim(),
    );
    const hasKnownFx = nativeCurrency === 'eur' || perShareNative === 0;
    const perShareEur =
      hasRate && hasKnownFx ? perShareNative : undefined;

    let status: EtfPurificationRow['status'];
    let missingReason: EtfPurificationRow['missingReason'];
    let purificationEur: number | null;
    if (unitsResult.invalidLedger) {
      status = 'insufficient_data';
      missingReason = 'invalid_ledger';
      purificationEur = null;
    } else if (!assetConfig || assetConfig.assetClass !== 'etf') {
      status = 'insufficient_data';
      missingReason = 'unknown_asset';
      purificationEur = null;
    } else if (hasCurrentSelfPurificationEvidence) {
      status = 'self_purified';
      purificationEur = 0;
    } else if (selfPurified) {
      status = 'insufficient_data';
      missingReason = 'unverified_self_purification';
      purificationEur = null;
    } else if (!hasRate) {
      status = 'insufficient_data';
      missingReason = 'missing_rate';
      purificationEur = null;
    } else if (!hasCurrentRate) {
      status = 'insufficient_data';
      missingReason = 'stale_rate';
      purificationEur = null;
    } else if (!hasKnownFx || typeof perShareEur !== 'number') {
      status = 'insufficient_data';
      missingReason = 'missing_fx';
      purificationEur = null;
    } else {
      status = 'calculated';
      purificationEur = Number((unitsHeld * perShareEur).toFixed(2));
    }

    etfRows.push({
      symbol: assetConfig?.assetClass === 'etf' ? assetConfig.symbol : symbol,
      name:
        assetConfig?.assetClass === 'etf'
          ? assetConfig.name
          : transactionMetadata.name?.trim() || symbol,
      selfPurified,
      unitsHeld,
      nativeCurrency,
      perSharePurificationNative: perShareNative,
      perSharePurificationEur: perShareEur,
      purificationEur,
      ratePeriod: config?.ratePeriod,
      source: config?.source,
      hasRate,
      status,
      missingReason,
    });
  }

  etfRows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const etfTotalEur = etfRows.some((row) => row.purificationEur === null)
    ? null
    : Number(
        etfRows
          .reduce((sum, row) => sum + (row.purificationEur ?? 0), 0)
          .toFixed(2),
      );

  const configuredRatio = settings.stockImpermissibleIncomeRatio;
  const ratioIsValid = (
    Number.isFinite(configuredRatio)
    && configuredRatio >= 0
    && configuredRatio <= 1
  );
  const ratio = ratioIsValid
    ? configuredRatio
    : DEFAULT_PURIFICATION_SETTINGS.stockImpermissibleIncomeRatio;
  const method = settings.stockPurificationMethod;
  const basisResult =
    method === 'dividends'
      ? computeStockDividendsEur(transactions, year)
      : computeStockHoldingsEur(transactions, year);
  const basisEur = basisResult.value;
  const cutoff = new Date(endOfYearIso(year)).getTime();
  const hasRelevantStockInput = transactions.some(
    (tx) =>
      tx.assetClass === 'stock' &&
      (
        (
          method === 'dividends'
          && tx.type === 'dividend'
          && new Date(tx.date).getUTCFullYear() === year
        )
        || (
          method === 'holdings'
          && Number.isFinite(new Date(tx.date).getTime())
          && new Date(tx.date).getTime() <= cutoff
        )
      ),
  );
  const ratioConfirmed = Boolean(
    settings.stockRatioConfirmedAt
    && Number.isFinite(Date.parse(settings.stockRatioConfirmedAt)),
  );
  const stockStatus: StockPurificationSummary['status'] =
    basisEur === null
    || (hasRelevantStockInput && (!ratioIsValid || !ratioConfirmed))
      ? 'insufficient_data'
      : 'calculated';
  const stockMissingReason: StockPurificationSummary['missingReason'] =
    basisEur === null
      ? basisResult.missingReason
      : hasRelevantStockInput && !ratioIsValid
        ? 'invalid_ratio'
        : stockStatus === 'insufficient_data'
        ? 'unconfirmed_ratio'
        : undefined;
  const stockPurificationEur =
    stockStatus === 'calculated' && basisEur !== null
      ? Number((basisEur * ratio).toFixed(2))
      : null;

  const stocks: StockPurificationSummary = {
    method,
    basisEur: basisEur === null ? null : Number(basisEur.toFixed(2)),
    ratio,
    purificationEur: stockPurificationEur,
    status: stockStatus,
    missingReason: stockMissingReason,
  };

  return {
    year,
    etfRows,
    etfTotalEur,
    stocks,
    grandTotalEur:
      etfTotalEur === null || stockPurificationEur === null
        ? null
        : Number((etfTotalEur + stockPurificationEur).toFixed(2)),
  };
}

export function listSupportedEtfDefaults(): Array<{
  symbol: string;
  name: string;
  defaults: EtfPurificationConfig | undefined;
  nativeCurrency: 'eur' | 'usd';
}> {
  return SUPPORTED_ETF_ASSETS.map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
    defaults: asset.purification,
    nativeCurrency: asset.nativeCurrency,
  }));
}
