/**
 * Performance Metrics Calculator
 * Computes all performance metrics for backtest results
 */

import type { SimulatedTrade } from '@/lib/strategy/models';
import type { BacktestMetrics } from './types';

const DAYS_PER_YEAR = 365.2425;
const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_YEAR = DAYS_PER_YEAR * MILLISECONDS_PER_DAY;

function getFallbackBarsPerYear(interval: string): number {
  if (interval === '1m') return 365 * 24 * 60;
  if (interval === '5m') return 365 * 24 * 12;
  if (interval === '15m') return 365 * 24 * 4;
  if (interval === '1h') return 365 * 24;
  if (interval === '4h') return 365 * 6;
  if (interval === '1w') return DAYS_PER_YEAR / 7;
  return 365;
}

function resolveTimeBasis(
  totalBars: number,
  dates: string[],
  interval: string,
): { years: number; barsPerYear: number } {
  const observedBars = Math.max(0, Math.min(totalBars, dates.length));
  if (observedBars >= 2) {
    const start = Date.parse(dates[0]);
    const end = Date.parse(dates[observedBars - 1]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const years = (end - start) / MILLISECONDS_PER_YEAR;
      return {
        years,
        barsPerYear: (observedBars - 1) / years,
      };
    }
  }

  const barsPerYear = getFallbackBarsPerYear(interval);
  return {
    years: Math.max(0, totalBars - 1) / barsPerYear,
    barsPerYear,
  };
}

/**
 * Calculate comprehensive performance metrics from simulated trades
 */
export function calculateMetrics(
  trades: SimulatedTrade[],
  equityCurve: number[],
  prices: number[],
  initialCapital: number,
  totalBars: number,
  dates: string[],
  interval: string = '1d'
): BacktestMetrics {
  const lastEquity = equityCurve[equityCurve.length - 1];
  const finalEquity = Number.isFinite(lastEquity)
    ? lastEquity
    : initialCapital;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;
  
  // Use the actual observation dates whenever possible. Daily stock histories
  // have roughly 252 observations per calendar year while 24/7 assets have
  // roughly 365; treating both as 365 bars materially distorts annual returns.
  const { years, barsPerYear } = resolveTimeBasis(totalBars, dates, interval);

  // Annualized return (only meaningful if we have at least ~30 days of data)
  let annualizedReturn: number;
  if (finalEquity === initialCapital) {
    annualizedReturn = 0;
  } else if (years < 0.08) {
    // Less than ~1 month: annualization is meaningless, just show total return
    annualizedReturn = totalReturnPct;
  } else if (years > 0) {
    annualizedReturn = (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100;
    // Cap to prevent display overflow
    annualizedReturn = Math.max(-9999, Math.min(99999, annualizedReturn));
  } else {
    annualizedReturn = totalReturnPct;
  }
  
  // Buy and hold return
  const buyHoldReturn = prices.length >= 2
    ? ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100
    : 0;
  
  // Win/loss analysis
  const winningTrades = trades.filter(t => t.profit > 0);
  const losingTrades = trades.filter(t => t.profit <= 0);
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  
  // Average gains/losses
  const avgGain = winningTrades.length > 0
    ? winningTrades.reduce((s, t) => s + t.profitPercent, 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((s, t) => s + t.profitPercent, 0) / losingTrades.length
    : 0;
  
  // Profit Factor
  const totalGains = winningTrades.reduce((s, t) => s + t.profit, 0);
  const totalLosses = Math.abs(losingTrades.reduce((s, t) => s + t.profit, 0));
  const profitFactor = totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? Infinity : 0;
  
  // Max Drawdown
  const maxDrawdown = calculateMaxDrawdown(equityCurve);
  
  // Per-bar returns for risk metrics
  const barReturns = calculateBarReturns(equityCurve);
  
  // Raw (non-annualised) standard deviation of bar returns
  const rawStdDev = calculateRawStdDev(barReturns);
  
  // Annualised volatility in percentage points for UI display.
  const volatility = rawStdDev * Math.sqrt(barsPerYear) * 100;
  
  // Sharpe Ratio (annualised, risk-free rate = 0)
  // Formula: (avgBarReturn / rawStdDev) * √barsPerYear
  // This is equivalent to: annualisedReturn / annualisedVol (single annualisation)
  const avgBarReturn = barReturns.length > 0
    ? barReturns.reduce((s, r) => s + r, 0) / barReturns.length
    : 0;
  const sharpeRatio = rawStdDev > 0
    ? (avgBarReturn / rawStdDev) * Math.sqrt(barsPerYear)
    : 0;
  
  // Sortino Ratio (CFA Institute standard)
  // Downside deviation: √( Σ min(r_i - target, 0)² / N ) where N = total periods
  const downsideDeviation = calculateDownsideDeviation(barReturns, 0);
  const sortinoRatio = downsideDeviation > 0
    ? (avgBarReturn / downsideDeviation) * Math.sqrt(barsPerYear)
    : 0;
  
  // Advanced Risk Metrics
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : annualizedReturn > 0 ? Infinity : 0;
  const drawdownDurationDays = calculateDrawdownDuration(equityCurve, dates, interval);
  
  // Beta vs Benchmark (Buy & Hold)
  const bhBarReturns = calculateBarReturns(prices);
  const beta = calculateBeta(barReturns, bhBarReturns);
  
  // Annual Performance
  const { bestYear, worstYear } = calculateBestWorstYears(equityCurve, dates);
  
  // Time in market
  const barsInMarket = trades.reduce((s, t) => s + t.holdingBars, 0);
  const timeInMarketPct = totalBars > 0 ? (barsInMarket / totalBars) * 100 : 0;
  
  // False signal rate (trades with negative returns)
  const falseSignalRate = trades.length > 0
    ? (losingTrades.length / trades.length) * 100
    : 0;
  
  // Average holding period
  const avgHoldingPeriod = trades.length > 0
    ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length
    : 0;
  
  
  // Composite score (weighted)
  const compositeScore = calculateCompositeScore({
    totalReturnPct,
    annualizedReturnPct: annualizedReturn,
    winRate,
    maxDrawdownPct: maxDrawdown,
    sharpeRatio,
    profitFactor,
    falseSignalRate,
    volatility,
  });
  
  return {
    totalReturnPct,
    annualizedReturnPct: annualizedReturn,
    buyHoldReturnPct: buyHoldReturn,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor: isFinite(profitFactor) ? profitFactor : 999,
    maxDrawdownPct: maxDrawdown,
    volatility,
    sharpeRatio,
    sortinoRatio,
    falseSignalRate,
    timeInMarketPct: timeInMarketPct,
    avgGainPerTrade: avgGain,
    avgLossPerTrade: avgLoss,
    avgHoldingPeriod,
    compositeScore,
    drawdownDurationDays,
    beta,
    calmarRatio,
    bestYear,
    worstYear,
  };
}

/**
 * Calculate maximum drawdown from equity curve
 */
export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const drawdown = ((peak - value) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  return maxDrawdown;
}

/**
 * Calculate drawdown curve
 */
export function calculateDrawdownCurve(equityCurve: number[]): number[] {
  if (equityCurve.length === 0) return [];
  
  const drawdowns: number[] = [];
  let peak = equityCurve[0];
  
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    drawdowns.push(((peak - value) / peak) * -100);
  }
  
  return drawdowns;
}

function calculateBarReturns(equityCurve: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] > 0) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
  }
  return returns;
}

/**
 * Raw (non-annualised) sample standard deviation of returns.
 * Used as building block for Sharpe, Sortino, and annualised volatility.
 */
function calculateRawStdDev(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/**
 * Downside deviation per CFA Institute standard.
 * Uses ALL periods as divisor (positive returns contribute 0 to the sum).
 * target = minimum acceptable return (typically 0)
 */
function calculateDownsideDeviation(returns: number[], target: number): number {
  if (returns.length < 2) return 0;
  let sumSquared = 0;
  for (const r of returns) {
    const diff = r - target;
    if (diff < 0) {
      sumSquared += diff * diff;
    }
  }
  return Math.sqrt(sumSquared / returns.length);
}

/**
 * Advanced Risk metrics implementations
 */

function fallbackElapsedDays(
  startIndex: number,
  endIndex: number,
  interval: string,
): number {
  const bars = Math.max(0, endIndex - startIndex);
  if (interval === '1m') return bars / (24 * 60);
  if (interval === '5m') return bars / (24 * 12);
  if (interval === '15m') return bars / (24 * 4);
  if (interval === '1h') return bars / 24;
  if (interval === '4h') return bars / 6;
  if (interval === '1w') return bars * 7;
  return bars;
}

function elapsedDays(
  dates: string[],
  startIndex: number,
  endIndex: number,
  interval: string,
): number {
  const start = Date.parse(dates[startIndex] ?? '');
  const end = Date.parse(dates[endIndex] ?? '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return (end - start) / MILLISECONDS_PER_DAY;
  }
  return fallbackElapsedDays(startIndex, endIndex, interval);
}

function calculateDrawdownDuration(
  equityCurve: number[],
  dates: string[],
  interval: string,
): number {
  if (equityCurve.length < 2) return 0;
  
  let peak = equityCurve[0];
  let peakIndex = 0;
  let maxDuration = 0;
  let isUnderwater = false;
  
  for (let index = 1; index < equityCurve.length; index++) {
    const value = equityCurve[index];
    if (value >= peak) {
      if (isUnderwater) {
        maxDuration = Math.max(
          maxDuration,
          elapsedDays(dates, peakIndex, index, interval),
        );
      }
      peak = value;
      peakIndex = index;
      isUnderwater = false;
    } else {
      isUnderwater = true;
      maxDuration = Math.max(
        maxDuration,
        elapsedDays(dates, peakIndex, index, interval),
      );
    }
  }
  
  return maxDuration;
}

function calculateBeta(strategyReturns: number[], benchmarkReturns: number[]): number {
  if (strategyReturns.length < 2 || benchmarkReturns.length < 2) return 1;
  
  // Ensure we compare arrays of the same length
  const len = Math.min(strategyReturns.length, benchmarkReturns.length);
  const strat = strategyReturns.slice(0, len);
  const bench = benchmarkReturns.slice(0, len);
  
  const stratMean = strat.reduce((s, r) => s + r, 0) / len;
  const benchMean = bench.reduce((s, r) => s + r, 0) / len;
  
  let covariance = 0;
  let benchVariance = 0;
  
  for (let i = 0; i < len; i++) {
    const stratDev = strat[i] - stratMean;
    const benchDev = bench[i] - benchMean;
    covariance += stratDev * benchDev;
    benchVariance += benchDev * benchDev;
  }
  
  if (benchVariance === 0) return 1;
  return covariance / benchVariance;
}

function calculateBestWorstYears(equityCurve: number[], dates: string[]): { bestYear: { year: string; returnPct: number }; worstYear: { year: string; returnPct: number } } {
  if (equityCurve.length < 2 || dates.length !== equityCurve.length) {
    return { 
      bestYear: { year: '-', returnPct: 0 }, 
      worstYear: { year: '-', returnPct: 0 } 
    };
  }

  const yearMap = new Map<string, { start: number; end: number }>();
  
  for (let i = 0; i < dates.length; i++) {
    const year = dates[i].substring(0, 4);
    if (!yearMap.has(year)) {
      yearMap.set(year, { start: equityCurve[i], end: equityCurve[i] });
    } else {
      yearMap.get(year)!.end = equityCurve[i];
    }
  }

  let bestYear = { year: '-', returnPct: -Infinity };
  let worstYear = { year: '-', returnPct: Infinity };

  for (const [year, data] of Array.from(yearMap.entries())) {
    const returnPct = ((data.end - data.start) / data.start) * 100;
    if (returnPct > bestYear.returnPct) {
      bestYear = { year, returnPct };
    }
    if (returnPct < worstYear.returnPct) {
      worstYear = { year, returnPct };
    }
  }

  // Handle defaults if there is no data
  if (bestYear.returnPct === -Infinity) bestYear.returnPct = 0;
  if (worstYear.returnPct === Infinity) worstYear.returnPct = 0;

  return { bestYear, worstYear };
}

/**
 * Calculate composite score for ranking strategies
 * Higher = better
 */
function calculateCompositeScore(params: {
  totalReturnPct: number;
  annualizedReturnPct: number;
  winRate: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  falseSignalRate: number;
  volatility: number;
}): number {
  // Normalize each metric to 0-100 range with weights
  const returnScore = Math.min(Math.max(params.annualizedReturnPct, -100), 200) / 2; // 0-100
  const sharpeScore = Math.min(Math.max(params.sharpeRatio * 25, 0), 100); // 0-100
  const winRateScore = params.winRate; // Already 0-100
  const drawdownPenalty = Math.min(params.maxDrawdownPct, 100); // 0-100
  const profitFactorScore = Math.min(params.profitFactor * 20, 100); // 0-100
  
  return (
    returnScore * 0.30 +
    sharpeScore * 0.25 +
    winRateScore * 0.15 +
    profitFactorScore * 0.15 -
    drawdownPenalty * 0.10 -
    params.falseSignalRate * 0.05
  );
}
