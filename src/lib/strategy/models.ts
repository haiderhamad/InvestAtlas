export type StrategyType = 'single_sma' | 'dual_sma';
export type BacktestFeeMode = 'percent' | 'flat';
export type QuoteCurrency = 'eur' | 'usd';

export interface BacktestParameters {
  strategyType: StrategyType;
  smaPeriod?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  interval?: string;
  minBarsBetweenSignals?: number;
  candleConfirmation?: number;
  feePercent: number;
  feeMode?: BacktestFeeMode;
  flatFeeAmount?: number;
  quoteCurrency?: QuoteCurrency;
  slippagePercent: number;
  initialCapital: number;
}

export interface SimulatedTrade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  type: 'long';
  amount: number;
  entryValue: number;
  exitValue: number;
  profit: number;
  profitPercent: number;
  entryFeePaid: number;
  exitFeePaid: number;
  totalFeesPaid: number;
  holdingBars: number;
  exitReason: 'signal';
}
