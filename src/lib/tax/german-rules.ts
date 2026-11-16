/**
 * German Tax Rules for Private Crypto Transactions
 * FIFO-based lot tracking with 1-year holding period
 * 
 * IMPORTANT ASSUMPTIONS (all configurable):
 * - FIFO (First In, First Out) is used for lot assignment
 * - Holding period >= 365 days = tax-free (§ 23 EStG)
 * - Crypto-to-crypto trades are taxable disposals
 * - Buy fees are added to cost basis
 * - Sell fees are subtracted from proceeds
 * - Freigrenze: 600€ (until 2023), 1000€ (2024+)
 */

import type {
  TaxDisposal,
  TaxLot,
  TaxSettings,
  TaxYearSummary,
  Transaction,
} from '@/lib/tax/legacy-types';

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  tax: {
    feeOnBuy: 'addToCostBasis',
    feeOnSell: 'subtractFromProceeds',
    cryptoToCrypto: 'taxableDisposal',
    transferFees: 'notDisposal',
    valuationSource: 'coingecko_daily_close',
    freigrenze: {
      '2020': 600, '2021': 600, '2022': 600, '2023': 600,
      '2024': 1000, '2025': 1000, '2026': 1000,
    },
  },
  backtest: {
    defaultFeePercent: 0.25,
    defaultSlippagePercent: 0.1,
    defaultInitialCapital: 100,
  },
};

/**
 * Calculate holding period in days
 */
export function calculateHoldingDays(acquisitionDate: string, disposalDate: string): number {
  const acq = new Date(acquisitionDate);
  const disp = new Date(disposalDate);
  const diffMs = disp.getTime() - acq.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check if a holding period qualifies as tax-free
 * German rule: >= 365 days (1 full year)
 */
export function isTaxFreeByHoldingPeriod(holdingDays: number): boolean {
  return holdingDays >= 365;
}

/**
 * Get the tax year from a date string.
 * Uses UTC so a transaction at 2023-12-31T23:59Z stays in 2023 regardless of local TZ.
 */
export function getTaxYear(dateStr: string): number {
  return new Date(dateStr).getUTCFullYear();
}

/**
 * Get the Freigrenze (tax-free allowance) for a given year
 */
export function getFreigrenze(year: number, settings: TaxSettings): number {
  return settings.tax.freigrenze[year.toString()] ?? 1000;
}

/**
 * Build tax lots from acquisition transactions (FIFO order)
 */
export function buildTaxLots(
  transactions: Transaction[],
  settings: TaxSettings
): TaxLot[] {
  const lots: TaxLot[] = [];
  
  // Filter and sort acquisitions by timestamp (oldest first for FIFO)
  const acquisitions = transactions
    .filter(tx => tx.tax_type === 'acquisition')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  for (const tx of acquisitions) {
    let costBasisPerUnit = tx.price || 0;
    
    // Add fees to cost basis if configured
    if (settings.tax.feeOnBuy === 'addToCostBasis' && tx.fee_amount > 0 && tx.amount > 0) {
      // Fee-adjusted cost basis
      const totalCost = (tx.price || 0) * tx.amount + tx.fee_amount;
      costBasisPerUnit = totalCost / tx.amount;
    }
    
    const lot: TaxLot = {
      id: crypto.randomUUID ? crypto.randomUUID() : `lot-${Date.now()}-${Math.random()}`,
      user_id: tx.user_id,
      asset: tx.base_asset,
      acquisition_date: tx.timestamp,
      acquisition_tx_id: tx.id,
      original_amount: tx.amount,
      remaining_amount: tx.amount,
      cost_basis_per_unit: costBasisPerUnit,
      total_cost_basis: costBasisPerUnit * tx.amount,
      fee_included: tx.fee_amount,
      exchange: tx.exchange,
      is_fully_disposed: false,
      created_at: new Date().toISOString(),
    };
    
    lots.push(lot);
  }
  
  return lots;
}

/**
 * Process disposals using FIFO principle
 * Returns updated lots and disposal records
 */
export function processDisposals(
  transactions: Transaction[],
  lots: TaxLot[],
  settings: TaxSettings
): { updatedLots: TaxLot[]; disposals: TaxDisposal[] } {
  const lotsCopy = lots.map(l => ({ ...l }));
  const disposals: TaxDisposal[] = [];
  
  // Get disposal transactions sorted by timestamp
  const disposalTxs = transactions
    .filter(tx => tx.tax_type === 'disposal')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  for (const tx of disposalTxs) {
    let remainingAmount = tx.amount;
    
    // Calculate proceeds per unit
    let proceedsPerUnit = tx.price || 0;
    
    // Subtract fees from proceeds if configured
    if (settings.tax.feeOnSell === 'subtractFromProceeds' && tx.fee_amount > 0 && tx.amount > 0) {
      const totalProceeds = (tx.price || 0) * tx.amount - tx.fee_amount;
      proceedsPerUnit = totalProceeds / tx.amount;
    }
    
    // FIFO: consume oldest lots first
    const assetLots = lotsCopy
      .filter(l => l.asset === tx.base_asset && l.remaining_amount > 0)
      .sort((a, b) => new Date(a.acquisition_date).getTime() - new Date(b.acquisition_date).getTime());
    
    for (const lot of assetLots) {
      if (remainingAmount <= 0) break;
      
      const consumed = Math.min(lot.remaining_amount, remainingAmount);
      const holdingDays = calculateHoldingDays(lot.acquisition_date, tx.timestamp);
      const taxFree = isTaxFreeByHoldingPeriod(holdingDays);
      
      const costBasisUsed = lot.cost_basis_per_unit * consumed;
      const totalProceeds = proceedsPerUnit * consumed;
      const realizedGain = totalProceeds - costBasisUsed;
      
      const disposal: TaxDisposal = {
        id: crypto.randomUUID ? crypto.randomUUID() : `disp-${Date.now()}-${Math.random()}`,
        user_id: tx.user_id,
        lot_id: lot.id,
        disposal_tx_id: tx.id,
        disposed_amount: consumed,
        proceeds_per_unit: proceedsPerUnit,
        total_proceeds: totalProceeds,
        cost_basis_used: costBasisUsed,
        realized_gain: realizedGain,
        holding_days: holdingDays,
        is_tax_free: taxFree,
        tax_year: getTaxYear(tx.timestamp),
        disposal_date: tx.timestamp,
        created_at: new Date().toISOString(),
      };
      
      disposals.push(disposal);
      
      lot.remaining_amount -= consumed;
      if (lot.remaining_amount <= 0.000000000001) {
        lot.remaining_amount = 0;
        lot.is_fully_disposed = true;
      }
      
      remainingAmount -= consumed;
    }
    
    // Warning: disposed more than available lots (data issue)
    if (remainingAmount > 0.000000000001) {
      console.warn(`Warning: Disposal of ${tx.base_asset} exceeds available lots by ${remainingAmount}`);
    }
  }
  
  return { updatedLots: lotsCopy, disposals };
}

/**
 * Aggregate disposals into tax year summaries
 */
export function calculateTaxYearSummaries(
  disposals: TaxDisposal[],
  settings: TaxSettings
): TaxYearSummary[] {
  const yearMap = new Map<number, TaxDisposal[]>();
  
  for (const d of disposals) {
    if (!yearMap.has(d.tax_year)) {
      yearMap.set(d.tax_year, []);
    }
    yearMap.get(d.tax_year)!.push(d);
  }
  
  const summaries: TaxYearSummary[] = [];
  
  for (const [year, yearDisposals] of yearMap) {
    const taxFreeGains = yearDisposals
      .filter(d => d.is_tax_free)
      .reduce((sum, d) => sum + d.realized_gain, 0);
    
    const taxableGains = yearDisposals
      .filter(d => !d.is_tax_free && d.realized_gain > 0)
      .reduce((sum, d) => sum + d.realized_gain, 0);
    
    const totalLosses = yearDisposals
      .filter(d => !d.is_tax_free && d.realized_gain < 0)
      .reduce((sum, d) => sum + Math.abs(d.realized_gain), 0);
    
    const totalRealizedGain = yearDisposals.reduce((sum, d) => sum + d.realized_gain, 0);
    const netTaxableGain = Math.max(0, taxableGains - totalLosses);
    const freigrenze = getFreigrenze(year, settings);
    
    // Estimated tax: if net gain <= Freigrenze, no tax
    // Above Freigrenze, entire amount is taxable (not just the excess!)
    // This is a Freigrenze, not a Freibetrag
    const estimatedTax = netTaxableGain > freigrenze
      ? netTaxableGain * 0.25 // Rough estimate, depends on personal income tax rate
      : 0;
    
    summaries.push({
      year,
      totalRealizedGain,
      taxFreeGains,
      taxableGains,
      totalLosses,
      netTaxableGain,
      freigrenze,
      estimatedTax,
      disposalCount: yearDisposals.length,
    });
  }
  
  return summaries.sort((a, b) => b.year - a.year);
}

/**
 * Calculate unrealized gains for current holdings
 */
export function calculateUnrealizedGains(
  lots: TaxLot[],
  currentPrices: Map<string, number>
): {
  asset: string;
  amount: number;
  costBasis: number;
  currentValue: number;
  unrealizedGain: number;
  holdingDays: number;
  isTaxFree: boolean;
  lotId: string;
}[] {
  const now = new Date().toISOString();
  
  return lots
    .filter(l => l.remaining_amount > 0)
    .map(l => {
      const currentPrice = currentPrices.get(l.asset) || 0;
      const currentValue = l.remaining_amount * currentPrice;
      const costBasis = l.remaining_amount * l.cost_basis_per_unit;
      const holdingDays = calculateHoldingDays(l.acquisition_date, now);
      
      return {
        asset: l.asset,
        amount: l.remaining_amount,
        costBasis,
        currentValue,
        unrealizedGain: currentValue - costBasis,
        holdingDays,
        isTaxFree: isTaxFreeByHoldingPeriod(holdingDays),
        lotId: l.id,
      };
    });
}
