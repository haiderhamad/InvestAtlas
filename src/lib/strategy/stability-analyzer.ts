/**
 * Stability Analyzer
 * Tests strategies across time segments (4Y chunks, 2Y rolling windows)
 * to detect regime-dependent performance and parameter drift.
 */

import { runBacktest } from './backtest-engine';
import type { BacktestParameters } from '@/lib/strategy/models';
import type { FullAnalysisResult } from './types';

export interface SegmentResult {
  segmentLabel: string;
  startDate: string;
  endDate: string;
  dataPoints: number;
  bestStrategy: { label: string; returnPct: number; winRate: number; maxDD: number; compositeScore: number; params: BacktestParameters } | null;
  top5: { label: string; returnPct: number; compositeScore: number }[];
}

export interface StabilityReport {
  fullPeriod: { startDate: string; endDate: string; dataPoints: number };
  segments4Y: SegmentResult[];
  segments2Y: SegmentResult[];
  stabilityScores: StrategyStability[];
  parameterDrift: ParameterDrift[];
}

export interface StrategyStability {
  strategyLabel: string;
  params: BacktestParameters;
  overallScore: number;
  overallReturn: number;
  segmentScores: { segment: string; score: number; returnPct: number }[];
  scoreVariance: number;
  stabilityFlag: 'stable' | 'mixed' | 'regime_dependent';
}

export interface ParameterDrift {
  segment: string;
  bestSmaPeriod: number | null;
  bestCombo: string;
  bestReturn: number;
}

/**
 * Split price data into segments of N years
 */
function addCalendarYears(timestamp: number, years: number): number {
  const date = new Date(timestamp);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime();
}

function firstIndexAtOrAfter(
  timestamps: number[],
  target: number,
  fromIndex = 0,
): number {
  let low = Math.max(0, fromIndex);
  let high = timestamps.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (timestamps[middle] < target) low = middle + 1;
    else high = middle;
  }

  return low;
}

function splitIntoSegments(
  prices: number[],
  dates: string[],
  yearsPerSegment: number,
  rolling: boolean = false
): { prices: number[]; dates: string[]; label: string }[] {
  const segments: { prices: number[]; dates: string[]; label: string }[] = [];
  if (
    prices.length !== dates.length
    || prices.length === 0
    || !Number.isInteger(yearsPerSegment)
    || yearsPerSegment <= 0
  ) {
    return segments;
  }

  const timestamps = dates.map((date) => Date.parse(date));
  if (
    timestamps.some(
      (timestamp, index) =>
        !Number.isFinite(timestamp)
        || (index > 0 && timestamp <= timestamps[index - 1]),
    )
  ) {
    return segments;
  }

  const appendSegment = (start: number, end: number) => {
    if (end - start < 60) return;
    segments.push({
      prices: prices.slice(start, end),
      dates: dates.slice(start, end),
      label: `${dates[start].slice(0, 4)} – ${dates[end - 1].slice(0, 4)}`,
    });
  };

  if (rolling) {
    let windowStart = timestamps[0];
    const finalTimestamp = timestamps[timestamps.length - 1];

    while (true) {
      const windowEnd = addCalendarYears(windowStart, yearsPerSegment);
      if (windowEnd > finalTimestamp) break;

      const start = firstIndexAtOrAfter(timestamps, windowStart);
      const end = firstIndexAtOrAfter(timestamps, windowEnd, start);
      appendSegment(start, end);

      const nextWindowStart = addCalendarYears(windowStart, 1);
      if (nextWindowStart <= windowStart) break;
      windowStart = nextWindowStart;
    }
  } else {
    let start = 0;
    while (start < timestamps.length) {
      const segmentEnd = addCalendarYears(
        timestamps[start],
        yearsPerSegment,
      );
      const end = firstIndexAtOrAfter(
        timestamps,
        segmentEnd,
        start + 1,
      );
      appendSegment(start, end);
      start = end;
    }
  }

  return segments;
}

/**
 * Run top strategies from full optimization on a single segment
 */
function runStrategiesOnSegment(
  topStrategies: FullAnalysisResult[],
  segment: { prices: number[]; dates: string[]; label: string },
  asset: string
): SegmentResult {
  const results: { label: string; returnPct: number; winRate: number; maxDD: number; compositeScore: number; params: BacktestParameters }[] = [];

  for (const strat of topStrategies.slice(0, 20)) {
    try {
      const r = runBacktest(segment.prices, segment.dates, strat.result.parameters, asset);
      results.push({
        label: strat.strategyLabel,
        returnPct: r.metrics.totalReturnPct,
        winRate: r.metrics.winRate,
        maxDD: r.metrics.maxDrawdownPct,
        compositeScore: r.metrics.compositeScore,
        params: r.parameters,
      });
    } catch {
      // Skip if segment too short for this strategy's parameters
    }
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    segmentLabel: segment.label,
    startDate: segment.dates[0] || '',
    endDate: segment.dates[segment.dates.length - 1] || '',
    dataPoints: segment.prices.length,
    bestStrategy: results[0] || null,
    top5: results.slice(0, 5).map(r => ({ label: r.label, returnPct: r.returnPct, compositeScore: r.compositeScore })),
  };
}

/**
 * Compute stability scores for top strategies across segments
 */
function computeStabilityScores(
  topStrategies: FullAnalysisResult[],
  segmentResults4Y: SegmentResult[],
  segmentResults2Y: SegmentResult[],
  allSegments4Y: { prices: number[]; dates: string[]; label: string }[],
  allSegments2Y: { prices: number[]; dates: string[]; label: string }[],
  asset: string
): StrategyStability[] {
  const stabilities: StrategyStability[] = [];
  const allSegs = [...allSegments4Y, ...allSegments2Y];
  const allLabels = [...segmentResults4Y.map(s => s.segmentLabel), ...segmentResults2Y.map(s => s.segmentLabel)];

  for (const strat of topStrategies.slice(0, 15)) {
    const segScores: { segment: string; score: number; returnPct: number }[] = [];
    let failedSegments = 0;

    for (let i = 0; i < allSegs.length; i++) {
      try {
        const r = runBacktest(allSegs[i].prices, allSegs[i].dates, strat.result.parameters, asset);
        segScores.push({
          segment: allLabels[i],
          score: r.metrics.compositeScore,
          returnPct: r.metrics.totalReturnPct,
        });
      } catch {
        failedSegments += 1;
        segScores.push({ segment: allLabels[i], score: 0, returnPct: 0 });
      }
    }

    const scores = segScores
      .map((segment) => segment.score)
      .filter(Number.isFinite);
    const mean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const variance = scores.length > 1
      ? scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length
      : 0;
    const standardDeviation = Math.sqrt(variance);
    const cv = Math.abs(mean) > Number.EPSILON
      ? standardDeviation / Math.abs(mean)
      : standardDeviation > 0
        ? Number.POSITIVE_INFINITY
        : 0;

    let flag: 'stable' | 'mixed' | 'regime_dependent' = 'stable';
    if (failedSegments > 0 || scores.length < 2 || cv > 0.6) {
      flag = 'regime_dependent';
    }
    else if (cv > 0.3) flag = 'mixed';

    stabilities.push({
      strategyLabel: strat.strategyLabel,
      params: strat.result.parameters,
      overallScore: strat.result.metrics.compositeScore,
      overallReturn: strat.result.metrics.totalReturnPct,
      segmentScores: segScores,
      scoreVariance: variance,
      stabilityFlag: flag,
    });
  }

  stabilities.sort((a, b) => {
    // Prioritize stable strategies, then by overall score
    const flagOrder = { stable: 0, mixed: 1, regime_dependent: 2 };
    if (flagOrder[a.stabilityFlag] !== flagOrder[b.stabilityFlag]) {
      return flagOrder[a.stabilityFlag] - flagOrder[b.stabilityFlag];
    }
    return b.overallScore - a.overallScore;
  });

  return stabilities;
}

/**
 * Detect parameter drift — best SMA and combo per segment
 */
function detectParameterDrift(segmentResults: SegmentResult[]): ParameterDrift[] {
  return segmentResults.map(seg => {
    const best = seg.bestStrategy;
    return {
      segment: seg.segmentLabel,
      bestSmaPeriod: best?.params.smaPeriod || best?.params.fastPeriod || null,
      bestCombo: best?.label || '—',
      bestReturn: best?.returnPct || 0,
    };
  });
}

/**
 * Run full stability analysis
 */
export function runStabilityAnalysis(
  topStrategies: FullAnalysisResult[],
  prices: number[],
  dates: string[],
  asset: string
): StabilityReport {
  // Split into segments
  const segs4Y = splitIntoSegments(prices, dates, 4, false);
  const segs2Y = splitIntoSegments(prices, dates, 2, true);

  // Run strategies on each segment
  const results4Y = segs4Y.map(seg => runStrategiesOnSegment(topStrategies, seg, asset));
  const results2Y = segs2Y.map(seg => runStrategiesOnSegment(topStrategies, seg, asset));

  // Stability scores
  const stabilityScores = computeStabilityScores(topStrategies, results4Y, results2Y, segs4Y, segs2Y, asset);

  // Parameter drift
  const parameterDrift = detectParameterDrift([...results4Y, ...results2Y]);

  return {
    fullPeriod: {
      startDate: dates[0] || '',
      endDate: dates[dates.length - 1] || '',
      dataPoints: prices.length,
    },
    segments4Y: results4Y,
    segments2Y: results2Y,
    stabilityScores,
    parameterDrift,
  };
}
