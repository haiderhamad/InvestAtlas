/**
 * Data contracts used by the legacy FIFO calculator.
 *
 * These types are backend-neutral. The calculator is local and does not depend
 * on a Supabase runtime or schema.
 */

export type TransactionType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'fee'
  | 'staking_reward'
  | 'airdrop';

export type TaxType =
  | 'acquisition'
  | 'disposal'
  | 'transfer_in'
  | 'transfer_out'
  | 'fee'
  | 'income';

export interface Transaction {
  id: string;
  user_id: string;
  raw_transaction_id: string | null;
  exchange: string;
  type: TransactionType;
  base_asset: string;
  quote_asset: string | null;
  amount: number;
  price: number | null;
  total: number | null;
  fee_amount: number;
  fee_asset: string | null;
  timestamp: string;
  tax_type: TaxType | null;
  lot_assigned: boolean;
  notes: string | null;
  created_at: string;
}

export interface TaxLot {
  id: string;
  user_id: string;
  asset: string;
  acquisition_date: string;
  acquisition_tx_id: string | null;
  original_amount: number;
  remaining_amount: number;
  cost_basis_per_unit: number;
  total_cost_basis: number;
  fee_included: number;
  exchange: string | null;
  is_fully_disposed: boolean;
  created_at: string;
}

export interface TaxDisposal {
  id: string;
  user_id: string;
  lot_id: string;
  disposal_tx_id: string | null;
  disposed_amount: number;
  proceeds_per_unit: number;
  total_proceeds: number;
  cost_basis_used: number;
  realized_gain: number;
  holding_days: number;
  is_tax_free: boolean;
  tax_year: number;
  disposal_date: string;
  created_at: string;
}

export interface TaxYearSummary {
  year: number;
  totalRealizedGain: number;
  taxFreeGains: number;
  taxableGains: number;
  totalLosses: number;
  netTaxableGain: number;
  freigrenze: number;
  estimatedTax: number;
  disposalCount: number;
}

export interface TaxSettings {
  tax: {
    feeOnBuy: 'addToCostBasis' | 'ignore';
    feeOnSell: 'subtractFromProceeds' | 'ignore';
    cryptoToCrypto: 'taxableDisposal' | 'nonTaxable';
    transferFees: 'notDisposal' | 'disposal';
    valuationSource: string;
    freigrenze: Record<string, number>;
  };
  backtest: {
    defaultFeePercent: number;
    defaultSlippagePercent: number;
    defaultInitialCapital: number;
  };
}
