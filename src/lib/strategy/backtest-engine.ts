/**
 * Backtest Engine
 * Core simulation engine for SMA-based strategies
 * Supports single-SMA, dual-SMA, and filtered strategies
 */

import { calculateSMA, detectSMACrossover, detectDualSMACrossover } from '@/lib/indicators/sma';
import { calculateMetrics, calculateDrawdownCurve } from './metrics';
import { calculateBacktestFee } from './fee-model';
import type { BacktestParameters, SimulatedTrade } from '@/lib/strategy/models';
import type { BacktestResult, StrategySignal } from './types';
import { assertValidBacktestInput } from './validation';

/**
 * Run a single backtest with given parameters
 */
export function runBacktest(
  prices: number[],
  dates: string[],
  params: BacktestParameters,
  asset: string,
  volumes?: (number | null)[]
): BacktestResult {
  assertValidBacktestInput(prices, dates, params, volumes);

  // Generate signals based on strategy type
  const signals = generateSignals(prices, dates, params, volumes);
  
  // Simulate trades from signals
  const { trades, equityCurve } = simulateTrades(prices, dates, signals, params);
  
  // Calculate performance metrics
  const metrics = calculateMetrics(trades, equityCurve, prices, params.initialCapital, prices.length, dates, params.interval || '1d');
  
  // Calculate drawdown curve
  const drawdownCurve = calculateDrawdownCurve(equityCurve);
  
  return {
    parameters: params,
    asset,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    signals,
    trades,
    metrics,
    equityCurve,
    drawdownCurve,
  };
}

/**
 * Generate buy/sell signals based on strategy type
 */
function generateSignals(
  prices: number[],
  dates: string[],
  params: BacktestParameters,
  volumes?: (number | null)[]
): StrategySignal[] {
  const signals: StrategySignal[] = [];
  let rawSignals: number[];
  let regime: number[];
  
  switch (params.strategyType) {
    case 'single_sma': {
      const sma = calculateSMA(prices, params.smaPeriod!);
      rawSignals = detectSMACrossover(prices, sma);
      regime = sma.map((value, index) => {
        if (value === null) return 0;
        return prices[index] > value ? 1 : -1;
      });
      break;
    }
    case 'dual_sma': {
      const fastSMA = calculateSMA(prices, params.fastPeriod!);
      const slowSMA = calculateSMA(prices, params.slowPeriod!);
      rawSignals = detectDualSMACrossover(fastSMA, slowSMA);
      regime = fastSMA.map((fastValue, index) => {
        const slowValue = slowSMA[index];
        if (fastValue === null || slowValue === null) return 0;
        return fastValue > slowValue ? 1 : -1;
      });
      break;
    }
    default:
      rawSignals = new Array(prices.length).fill(0);
      regime = new Array(prices.length).fill(0);
  }
  
  // Apply minimum bars between signals
  const minBars = Math.max(1, Math.trunc(params.minBarsBetweenSignals || 1));
  let lastSignalIndex = -minBars;
  
  // A crossover is a one-bar event. Confirmation therefore checks whether the
  // new regime persists after that event instead of waiting for repeated
  // crossover impulses, which can never occur on consecutive bars.
  const confirmation = Math.max(1, Math.trunc(params.candleConfirmation || 1));
  let confirmationCount = 0;
  let pendingSignalType: 'buy' | 'sell' | null = null;
  
  for (let i = 0; i < rawSignals.length; i++) {
    if (rawSignals[i] !== 0) {
      pendingSignalType = rawSignals[i] === 1 ? 'buy' : 'sell';
      confirmationCount = 1;
    } else if (pendingSignalType) {
      const expectedRegime = pendingSignalType === 'buy' ? 1 : -1;
      if (regime[i] === expectedRegime) {
        confirmationCount++;
      } else {
        pendingSignalType = null;
        confirmationCount = 0;
      }
    }

    if (
      pendingSignalType
      && confirmationCount >= confirmation
    ) {
      if (i - lastSignalIndex >= minBars) {
        signals.push({
          index: i,
          date: dates[i],
          type: pendingSignalType,
          price: prices[i],
          reason: getSignalReason(params, pendingSignalType),
        });
        lastSignalIndex = i;
      }

      pendingSignalType = null;
      confirmationCount = 0;
    }
  }
  
  return signals;
}



/**
 * Simulate trades from signals, calculating equity curve
 */
function simulateTrades(
  prices: number[],
  dates: string[],
  signals: StrategySignal[],
  params: BacktestParameters
): { trades: SimulatedTrade[]; equityCurve: number[] } {
  const trades: SimulatedTrade[] = [];
  const equityCurve: number[] = new Array(prices.length).fill(params.initialCapital);
  
  let capital = params.initialCapital;
  let position: { entryPrice: number; entryDate: string; entryIndex: number; amount: number; maxPrice?: number; capitalBeforeBuy: number } | null = null;
  let signalIndex = 0;
  const slippageRate = params.slippagePercent / 100;
  
  for (let i = 0; i < prices.length; i++) {
    // Signals are derived from a bar's closing value. Execute on the next
    // available bar so the simulation never trades on information that only
    // became known at the same close.
    while (signalIndex < signals.length && signals[signalIndex].index + 1 === i) {
      const signal = signals[signalIndex];
      
      if (signal.type === 'buy' && !position) {
        // Enter position
        const effectivePrice = prices[i] * (1 + slippageRate);
        const entryFeePaid = calculateBacktestFee(capital, params);
        const investAmount = Math.max(0, capital - entryFeePaid);
        if (investAmount <= 0) {
          signalIndex++;
          continue;
        }
        const amount = investAmount / effectivePrice;
        
        position = {
          entryPrice: effectivePrice,
          entryDate: dates[i],
          entryIndex: i,
          amount,
          capitalBeforeBuy: capital,
        };
      } else if (signal.type === 'sell' && position) {
        // Exit position check
        const effectiveExitPrice = prices[i] * (1 - slippageRate);
        const grossExitValue = position.amount * effectiveExitPrice;
        const exitFeePaid = calculateBacktestFee(grossExitValue, params);
        const exitValue = Math.max(0, grossExitValue - exitFeePaid);
        const netProfitPercent = ((exitValue / position.capitalBeforeBuy) - 1) * 100;
        
        trades.push({
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: dates[i],
          exitPrice: effectiveExitPrice,
          type: 'long',
          amount: position.amount,
          entryValue: position.capitalBeforeBuy,
          exitValue,
          profit: exitValue - position.capitalBeforeBuy,
          profitPercent: netProfitPercent,
          entryFeePaid: Math.max(0, position.capitalBeforeBuy - position.amount * position.entryPrice),
          exitFeePaid,
          totalFeesPaid: Math.max(0, position.capitalBeforeBuy - position.amount * position.entryPrice) + exitFeePaid,
          holdingBars: i - position.entryIndex,
          exitReason: 'signal',
        });
        
        capital = exitValue;
        position = null;
      }
      
      signalIndex++;
    }
    
    // Update equity curve (mark-to-market with estimated exit fee for realism)
    if (position) {
      const grossMarkToMarket = position.amount * prices[i];
      equityCurve[i] = Math.max(0, grossMarkToMarket - calculateBacktestFee(grossMarkToMarket, params));
    } else {
      equityCurve[i] = capital;
    }
  }
  
  // Close any open position at the end (with slippage + fee)
  if (position) {
    const lastPrice = prices[prices.length - 1];
    const effectiveExitPrice = lastPrice * (1 - slippageRate);
    const grossExitValue = position.amount * effectiveExitPrice;
    const exitFeePaid = calculateBacktestFee(grossExitValue, params);
    const exitValue = Math.max(0, grossExitValue - exitFeePaid);
    
    trades.push({
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: dates[dates.length - 1],
      exitPrice: effectiveExitPrice,
      type: 'long',
      amount: position.amount,
      entryValue: position.capitalBeforeBuy,
      exitValue,
      profit: exitValue - position.capitalBeforeBuy,
      profitPercent: ((exitValue / position.capitalBeforeBuy) - 1) * 100,
      entryFeePaid: Math.max(0, position.capitalBeforeBuy - position.amount * position.entryPrice),
      exitFeePaid,
      totalFeesPaid: Math.max(0, position.capitalBeforeBuy - position.amount * position.entryPrice) + exitFeePaid,
      holdingBars: prices.length - 1 - position.entryIndex,
      exitReason: 'signal',
    });
    
    equityCurve[prices.length - 1] = exitValue;
  }
  
  return { trades, equityCurve };
}

function getSignalReason(params: BacktestParameters, type: 'buy' | 'sell'): string {
  switch (params.strategyType) {
    case 'single_sma':
      return type === 'buy'
        ? `Price crossed above SMA(${params.smaPeriod})`
        : `Price crossed below SMA(${params.smaPeriod})`;
    case 'dual_sma':
      return type === 'buy'
        ? `Golden Cross: SMA(${params.fastPeriod}) > SMA(${params.slowPeriod})`
        : `Death Cross: SMA(${params.fastPeriod}) < SMA(${params.slowPeriod})`;

    default:
      return 'Signal';
  }
}
