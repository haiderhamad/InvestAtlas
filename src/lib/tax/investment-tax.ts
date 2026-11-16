import {
  ASSET_CLASS_LABELS,
  ASSET_CLASS_ORDER,
  isCapitalIncomeAssetClass,
  type AssetClass,
} from '@/lib/config/supported-assets';
import {
  normalizeTransactionToEur,
  type TransactionFxSource,
} from '@/lib/fx/quote-rates';
import {
  buildGermanyTaxProfile,
  DEFAULT_TAX_PROFILE_SETTINGS,
  getEffectiveTaxProfile,
  type EffectiveTaxProfile,
  type TaxProfileSettings,
} from '@/lib/tax/tax-profile';

export type InvestmentTransactionType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'transfer'
  | 'fee'
  | 'adjustment';

export type InvestmentTaxType =
  | 'acquisition'
  | 'disposal'
  | 'transfer_in'
  | 'transfer_out'
  | 'dividend_income'
  | 'fee_expense'
  | 'adjustment'
  | 'cash_in'
  | 'cash_out';

export type FeeInputMode = 'none' | 'percent' | 'flat';

export interface InvestmentTransaction {
  id: string;
  date: string;
  venue: string;
  settlementVenue?: string;
  type: InvestmentTransactionType;
  asset: string;
  assetName?: string;
  assetClass: AssetClass | 'cash';
  quote: string;
  amount: number;
  price: number;
  total: number;
  fee: number;
  taxAmount?: number;
  taxType: InvestmentTaxType;
  source?: 'demo' | 'manual' | 'broker';
  notes?: string;
  updatedAt?: string;
  feeMode?: FeeInputMode;
  transferGroupId?: string;
  transferredCostBasisEur?: number;
  transferredCostBasisStatus?: 'known' | 'unknown';
  /** Metal purity in parts per thousand. Required for newly written metal rows. */
  metalFineness?: number;
  /** Explicit historical conversion of the transaction quote into EUR. */
  fxRateToEur?: number;
  fxRateSource?: TransactionFxSource;
  /** Calendar date of the observed FX rate. */
  fxRateDate?: string;
}

export interface InvestmentLot {
  id: string;
  asset: string;
  assetClass: AssetClass;
  acquisitionDate: string;
  venue: string;
  originalAmount: number;
  remainingAmount: number;
  costBasisPerUnit: number;
}

export interface DisposalBreakdown {
  id: string;
  asset: string;
  assetClass: AssetClass;
  lotId: string;
  disposalDate: string;
  acquisitionDate: string;
  disposedAmount: number;
  costBasisUsed: number;
  proceedsUsed: number;
  realizedGain: number;
  holdingDays: number;
  isTaxFree: boolean;
  regime: 'private_sale' | 'capital_income';
  year: number;
}

export interface CategoryTaxSummary {
  assetClass: AssetClass;
  label: string;
  regime: 'private_sale' | 'capital_income';
  realizedNet: number;
  taxFreeGains: number;
  taxablePositiveGains: number;
  taxableLosses: number;
  netTaxableBeforeAllowance: number;
  allowanceApplied: number;
  taxableBase: number;
  estimatedTax: number;
  effectiveTaxRate: number;
}

export interface RegimeTaxSummary {
  regime: 'private_sale' | 'capital_income';
  label: string;
  allowance: number;
  allowanceRemaining: number;
  taxFreeCapacity: number;
  taxablePositiveGains: number;
  taxableLosses: number;
  netBeforeAllowance: number;
  lossOffsetApplied: number;
  lossCarryforwardPotential: number;
  taxableBase: number;
  estimatedTax: number;
}

export interface OpenLotSummary {
  asset: string;
  assetClass: AssetClass;
  acquisitionDate: string;
  venue: string;
  remainingAmount: number;
  costBasisPerUnit: number;
  holdingDays: number;
  isTaxFreeIfSoldToday: boolean;
}

export interface YearlyTaxOverview {
  year: number;
  categories: CategoryTaxSummary[];
  privateSale: RegimeTaxSummary;
  capitalIncome: RegimeTaxSummary;
  totalEstimatedTax: number;
}

export interface InvestmentTaxOverview {
  calculationStatus: 'calculated' | 'insufficient_fx_data' | 'invalid_ledger';
  missingFxQuotes: string[];
  lots: InvestmentLot[];
  disposals: DisposalBreakdown[];
  openLots: OpenLotSummary[];
  yearly: YearlyTaxOverview[];
}

function requireEurValue(
  value: number,
  transaction: InvestmentTransaction,
): number {
  const converted = normalizeTransactionToEur(value, transaction);
  if (converted === null) {
    throw new Error(`Missing FX conversion for ${transaction.quote}`);
  }
  return converted;
}

function calculateHoldingDays(acquisitionDate: string, disposalDate: string): number {
  const acquisition = new Date(acquisitionDate);
  const disposal = new Date(disposalDate);
  return Math.floor((disposal.getTime() - acquisition.getTime()) / 86_400_000);
}

function getAssetClassLabel(assetClass: AssetClass): string {
  return ASSET_CLASS_LABELS[assetClass];
}

function isPrivateSaleTaxFree(
  assetClass: AssetClass,
  holdingDays: number,
  holdingPeriodDays: number,
): boolean {
  if (isCapitalIncomeAssetClass(assetClass)) return false;
  if (holdingPeriodDays <= 0) return false;
  return holdingDays > holdingPeriodDays;
}

function isAssetTransaction(
  transaction: InvestmentTransaction,
): transaction is InvestmentTransaction & { assetClass: AssetClass } {
  return transaction.assetClass !== 'cash';
}

const LOT_EPSILON = 0.0000001;

interface ProcessedTaxLedger {
  allLots: InvestmentLot[];
  openLots: InvestmentLot[];
  disposals: DisposalBreakdown[];
  invalid: boolean;
}

function hasValidTaxAmounts(transaction: InvestmentTransaction): boolean {
  if (
    !Number.isFinite(transaction.amount)
    || transaction.amount <= 0
    || !Number.isFinite(transaction.total)
    || transaction.total < 0
    || !Number.isFinite(transaction.fee)
    || transaction.fee < 0
  ) {
    return false;
  }

  return transaction.type !== 'sell' || transaction.total - transaction.fee >= 0;
}

function processTransactionsChronologically(
  transactions: InvestmentTransaction[],
  privateSaleHoldingPeriodDays: number,
): ProcessedTaxLedger {
  const allLots: InvestmentLot[] = [];
  const workingLots: InvestmentLot[] = [];
  const disposals: DisposalBreakdown[] = [];

  const ordered = transactions
    .map((transaction, inputIndex) => ({
      transaction,
      inputIndex,
      timestamp: new Date(transaction.date).getTime(),
    }))
    .filter(
      (entry): entry is typeof entry & {
        transaction: InvestmentTransaction & { assetClass: AssetClass };
      } =>
        isAssetTransaction(entry.transaction)
        && (entry.transaction.type === 'buy' || entry.transaction.type === 'sell'),
    )
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp
        || left.inputIndex - right.inputIndex,
    );

  for (const entry of ordered) {
    const transaction = entry.transaction;
    if (!Number.isFinite(entry.timestamp) || !hasValidTaxAmounts(transaction)) {
      return { allLots: [], openLots: [], disposals: [], invalid: true };
    }

    const asset = transaction.asset.trim().toUpperCase();

    if (transaction.type === 'buy') {
      const totalCostEur = requireEurValue(
        transaction.total + transaction.fee,
        transaction,
      );
      const costBasisPerUnit = totalCostEur / transaction.amount;
      if (!Number.isFinite(costBasisPerUnit) || costBasisPerUnit < 0) {
        return { allLots: [], openLots: [], disposals: [], invalid: true };
      }

      const lot: InvestmentLot = {
        id: `lot-${transaction.id}`,
        asset,
        assetClass: transaction.assetClass,
        acquisitionDate: transaction.date,
        venue: transaction.venue,
        originalAmount: transaction.amount,
        remainingAmount: transaction.amount,
        costBasisPerUnit,
      };
      workingLots.push(lot);
      allLots.push({ ...lot });
      continue;
    }

    const sale = transaction;
    let remainingAmount = sale.amount;
    const proceedsPerUnit =
      requireEurValue(sale.total - sale.fee, sale) / sale.amount;
    if (!Number.isFinite(proceedsPerUnit) || proceedsPerUnit < 0) {
      return { allLots: [], openLots: [], disposals: [], invalid: true };
    }

    const matchingLots = workingLots
      .filter(
        (lot) =>
          lot.asset === asset
          && lot.assetClass === sale.assetClass
          && lot.remainingAmount > LOT_EPSILON,
      )
      .sort((left, right) => new Date(left.acquisitionDate).getTime() - new Date(right.acquisitionDate).getTime());

    const availableAmount = matchingLots.reduce(
      (sum, lot) => sum + lot.remainingAmount,
      0,
    );
    if (availableAmount + LOT_EPSILON < remainingAmount) {
      return { allLots: [], openLots: [], disposals: [], invalid: true };
    }

    for (const lot of matchingLots) {
      if (remainingAmount <= LOT_EPSILON) break;

      const consumed = Math.min(remainingAmount, lot.remainingAmount);
      const holdingDays = calculateHoldingDays(lot.acquisitionDate, sale.date);
      const isTaxFree = isPrivateSaleTaxFree(lot.assetClass, holdingDays, privateSaleHoldingPeriodDays);
      const costBasisUsed = lot.costBasisPerUnit * consumed;
      const proceedsUsed = proceedsPerUnit * consumed;

      disposals.push({
        id: `disp-${sale.id}-${lot.id}`,
        asset: sale.asset,
        assetClass: lot.assetClass,
        lotId: lot.id,
        disposalDate: sale.date,
        acquisitionDate: lot.acquisitionDate,
        disposedAmount: consumed,
        costBasisUsed,
        proceedsUsed,
        realizedGain: proceedsUsed - costBasisUsed,
        holdingDays,
        isTaxFree,
        regime: isCapitalIncomeAssetClass(lot.assetClass) ? 'capital_income' : 'private_sale',
        year: new Date(sale.date).getUTCFullYear(),
      });

      lot.remainingAmount -= consumed;
      if (lot.remainingAmount <= LOT_EPSILON) {
        lot.remainingAmount = 0;
      }
      remainingAmount -= consumed;
    }

    if (remainingAmount > LOT_EPSILON) {
      return { allLots: [], openLots: [], disposals: [], invalid: true };
    }
  }

  return {
    allLots,
    openLots: workingLots,
    disposals,
    invalid: false,
  };
}

function summarizeAssetClass(
  disposals: DisposalBreakdown[],
  assetClass: AssetClass,
): CategoryTaxSummary {
  const relevant = disposals.filter((disposal) => disposal.assetClass === assetClass);
  const regime = isCapitalIncomeAssetClass(assetClass) ? 'capital_income' : 'private_sale';
  const taxFreeGains = relevant
    .filter((disposal) => disposal.isTaxFree)
    .reduce((sum, disposal) => sum + Math.max(0, disposal.realizedGain), 0);
  const taxablePositiveGains = relevant
    .filter((disposal) => !disposal.isTaxFree && disposal.realizedGain > 0)
    .reduce((sum, disposal) => sum + disposal.realizedGain, 0);
  const taxableLosses = relevant
    .filter((disposal) => !disposal.isTaxFree && disposal.realizedGain < 0)
    .reduce((sum, disposal) => sum + Math.abs(disposal.realizedGain), 0);

  return {
    assetClass,
    label: getAssetClassLabel(assetClass),
    regime,
    realizedNet: relevant.reduce((sum, disposal) => sum + disposal.realizedGain, 0),
    taxFreeGains,
    taxablePositiveGains,
    taxableLosses,
    netTaxableBeforeAllowance: taxablePositiveGains - taxableLosses,
    allowanceApplied: 0,
    taxableBase: 0,
    estimatedTax: 0,
    effectiveTaxRate: 0,
  };
}

function allocatePoolTax(
  categories: CategoryTaxSummary[],
  regime: 'private_sale' | 'capital_income',
  allowance: number,
  taxRate: number,
  allowanceMode: 'all_or_nothing' | 'allowance_exemption',
  label: string,
): RegimeTaxSummary {
  const regimeCategories = categories.filter((category) => category.regime === regime);
  const taxablePositiveGains = regimeCategories.reduce((sum, category) => sum + category.taxablePositiveGains, 0);
  const taxableLosses = regimeCategories.reduce((sum, category) => sum + category.taxableLosses, 0);
  const poolNet = taxablePositiveGains - taxableLosses;
  const positivePoolNet = Math.max(0, poolNet);
  const lossOffsetApplied = Math.min(taxablePositiveGains, taxableLosses);
  const lossCarryforwardPotential = Math.max(0, taxableLosses - taxablePositiveGains);

  let taxableBase = 0;
  let allowanceApplied = 0;

  if (regime === 'capital_income' || allowanceMode === 'allowance_exemption') {
    allowanceApplied = Math.min(positivePoolNet, allowance);
    taxableBase = Math.max(0, positivePoolNet - allowanceApplied);
  } else if (positivePoolNet > allowance) {
    taxableBase = positivePoolNet;
    allowanceApplied = 0;
  } else {
    allowanceApplied = positivePoolNet;
    taxableBase = 0;
  }

  const allowanceRemaining =
    regime !== 'capital_income' && allowanceMode === 'all_or_nothing' && positivePoolNet > allowance
      ? 0
      : Math.max(0, allowance - allowanceApplied);
  const taxFreeCapacity = allowanceRemaining;
  const estimatedTax = taxableBase * taxRate;
  const positiveNetTotal = regimeCategories.reduce(
    (sum, category) => sum + Math.max(0, category.netTaxableBeforeAllowance),
    0,
  );

  for (const category of regimeCategories) {
    const share = positiveNetTotal > 0 ? Math.max(0, category.netTaxableBeforeAllowance) / positiveNetTotal : 0;
    const categoryAllowance = allowanceApplied * share;
    category.allowanceApplied = Number(categoryAllowance.toFixed(2));
    category.taxableBase = Number((taxableBase * share).toFixed(2));
    category.estimatedTax = Number((estimatedTax * share).toFixed(2));
    category.effectiveTaxRate = taxRate;
  }

  return {
    regime,
    label,
    allowance,
    allowanceRemaining: Number(allowanceRemaining.toFixed(2)),
    taxFreeCapacity: Number(taxFreeCapacity.toFixed(2)),
    taxablePositiveGains: Number(taxablePositiveGains.toFixed(2)),
    taxableLosses: Number(taxableLosses.toFixed(2)),
    netBeforeAllowance: Number(poolNet.toFixed(2)),
    lossOffsetApplied: Number(lossOffsetApplied.toFixed(2)),
    lossCarryforwardPotential: Number(lossCarryforwardPotential.toFixed(2)),
    taxableBase: Number(taxableBase.toFixed(2)),
    estimatedTax: Number(estimatedTax.toFixed(2)),
  };
}

function buildOpenLots(lots: InvestmentLot[], privateSaleHoldingPeriodDays: number): OpenLotSummary[] {
  const today = new Date().toISOString();

  return lots
    .filter((lot) => lot.remainingAmount > 0.0000001)
    .map((lot) => {
      const holdingDays = calculateHoldingDays(lot.acquisitionDate, today);
      return {
        asset: lot.asset,
        assetClass: lot.assetClass,
        acquisitionDate: lot.acquisitionDate,
        venue: lot.venue,
        remainingAmount: Number(lot.remainingAmount.toFixed(8)),
        costBasisPerUnit: Number(lot.costBasisPerUnit.toFixed(2)),
        holdingDays,
        isTaxFreeIfSoldToday: isPrivateSaleTaxFree(lot.assetClass, holdingDays, privateSaleHoldingPeriodDays),
      };
    })
    .sort((left, right) => new Date(left.acquisitionDate).getTime() - new Date(right.acquisitionDate).getTime());
}

function isTaxProfileSettings(
  value: number | EffectiveTaxProfile | TaxProfileSettings | undefined,
): value is TaxProfileSettings {
  return typeof value === 'object' && value !== null && 'mode' in value;
}

function isEffectiveTaxProfile(
  value: number | EffectiveTaxProfile | TaxProfileSettings | undefined,
): value is EffectiveTaxProfile {
  return typeof value === 'object' && value !== null && 'sourceLabel' in value;
}

function resolveCurrentTaxProfile(
  input: number | EffectiveTaxProfile | TaxProfileSettings | undefined,
): EffectiveTaxProfile {
  if (isEffectiveTaxProfile(input)) {
    return input;
  }

  if (isTaxProfileSettings(input)) {
    return getEffectiveTaxProfile(input, new Date().getUTCFullYear());
  }

  return buildGermanyTaxProfile(new Date().getUTCFullYear(), typeof input === 'number' ? input * 100 : 32);
}

export function calculateInvestmentTaxOverview(
  transactions: InvestmentTransaction[],
  taxProfileInput: number | EffectiveTaxProfile | TaxProfileSettings = DEFAULT_TAX_PROFILE_SETTINGS,
): InvestmentTaxOverview {
  const missingFxQuotes = Array.from(new Set(
    transactions
      .filter(
        (transaction) =>
          transaction.assetClass !== 'cash'
          && (transaction.type === 'buy' || transaction.type === 'sell')
          && normalizeTransactionToEur(1, transaction) === null,
      )
      .map((transaction) => transaction.quote.trim().toUpperCase()),
  )).sort();

  if (missingFxQuotes.length > 0) {
    return {
      calculationStatus: 'insufficient_fx_data',
      missingFxQuotes,
      lots: [],
      disposals: [],
      openLots: [],
      yearly: [],
    };
  }

  const currentTaxProfile = resolveCurrentTaxProfile(taxProfileInput);
  const processed = processTransactionsChronologically(
    transactions,
    currentTaxProfile.privateSaleHoldingPeriodDays,
  );
  if (processed.invalid) {
    return {
      calculationStatus: 'invalid_ledger',
      missingFxQuotes: [],
      lots: [],
      disposals: [],
      openLots: [],
      yearly: [],
    };
  }

  const years = [...new Set(processed.disposals.map((disposal) => disposal.year))].sort((left, right) => right - left);

  const yearly = years.map((year) => {
    const yearDisposals = processed.disposals.filter((disposal) => disposal.year === year);
    const taxProfile = isTaxProfileSettings(taxProfileInput)
      ? getEffectiveTaxProfile(taxProfileInput, year)
      : isEffectiveTaxProfile(taxProfileInput)
      ? taxProfileInput
      : buildGermanyTaxProfile(year, typeof taxProfileInput === 'number' ? taxProfileInput * 100 : 32);
    const categories = ASSET_CLASS_ORDER.map((assetClass) =>
      summarizeAssetClass(yearDisposals, assetClass),
    );

    const privateSale = allocatePoolTax(
      categories,
      'private_sale',
      taxProfile.privateSaleAllowance,
      taxProfile.personalIncomeTaxRate,
      taxProfile.privateSaleAllowanceMode,
      'Private Sales Pool',
    );
    const capitalIncome = allocatePoolTax(
      categories,
      'capital_income',
      taxProfile.capitalIncomeAllowance,
      taxProfile.capitalIncomeTaxRate,
      'allowance_exemption',
      'Capital Income Pool',
    );

    return {
      year,
      categories,
      privateSale,
      capitalIncome,
      totalEstimatedTax: Number((privateSale.estimatedTax + capitalIncome.estimatedTax).toFixed(2)),
    };
  });

  return {
    calculationStatus: 'calculated',
    missingFxQuotes: [],
    lots: processed.allLots,
    disposals: processed.disposals,
    openLots: buildOpenLots(processed.openLots, currentTaxProfile.privateSaleHoldingPeriodDays),
    yearly,
  };
}
