import type { AssetClass } from '@/lib/config/supported-assets';

export interface DemoHolding {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  amount: number;
  avgCost: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPct: number;
  allocation: number;
  venue: string;
}

export interface DemoTransaction {
  id: string;
  date: string;
  venue: string;
  type: 'buy' | 'sell' | 'deposit' | 'dividend';
  asset: string;
  assetClass: AssetClass | 'cash';
  quote: string;
  amount: number;
  price: number;
  total: number;
  fee: number;
  taxType: 'acquisition' | 'disposal' | 'transfer_in' | 'dividend_income';
}

export interface PortfolioGrowthPoint {
  date: string;
  total: number;
  crypto: number;
  stocks: number;
  etfs?: number;
  metals: number;
}

export const DEMO_TRANSACTIONS: DemoTransaction[] = [];

function generateGrowthData(): PortfolioGrowthPoint[] {
  return [];
}

export const DEMO_PORTFOLIO_GROWTH: PortfolioGrowthPoint[] = generateGrowthData();

export const DEMO_HOLDINGS: DemoHolding[] = [];
