/**
 * Deterministic technical-analysis synthesis.
 *
 * Provider-generated prose is intentionally excluded from this boundary. The
 * configured AI provider registry remains available to separately scoped AI
 * features, but cannot override or decorate the technical result below.
 */

import { getActiveProviders } from './provider-store';
import type { ProviderStoreUser } from './provider-store';

export interface AIProvider {
  name: string;
  model: string;
  isFree: boolean;
  isAvailable: boolean;
  maxTokens: number;
  rateLimit: string;
}

export interface AIAnalysisRequest {
  asset: string;
  currentPrice: number;
  currency?: string;
  assetClass?: string;
  locale?: 'en' | 'de' | 'ar';
  smaValues: Record<string, number>;
  emaValues?: Record<string, number>;
  macd?: { macd: number; signal: number; histogram: number };
  rsi?: number;
  recentPrices: number[];
}

export type TechnicalPosture = 'positive' | 'neutral' | 'negative' | 'uncertain';
export type IndicatorStatus = 'bullish' | 'bearish' | 'neutral';

export interface IndicatorReading {
  /** Short label, e.g. "Price vs SMA50" */
  label: string;
  /** Indicator family — used by the UI to pick a renderer */
  kind: 'price_vs_ma' | 'rsi' | 'macd' | 'momentum' | 'generic';
  status: IndicatorStatus;
  /** Primary numeric or formatted value (e.g. "-2.1%", "50.4", "+188") */
  value: string;
  /** Optional secondary detail (e.g. "€59,614 vs €60,893") */
  detail?: string;
  /** Optional structured numbers — used by visual renderers */
  numbers?: {
    current?: number;
    reference?: number;
    min?: number;
    max?: number;
  };
}

export interface SignalPoint {
  label: string;
  detail?: string;
}

export interface AIAnalysisResponse {
  provider: string;
  model: string;
  trendDirection: 'bullish' | 'bearish' | 'neutral' | 'uncertain';
  signalQuality: 'strong' | 'moderate' | 'weak';
  score: number;
  confidence: number;
  /** Neutral technical posture derived only from supplied indicators. */
  technicalPosture: TechnicalPosture;
  /** One-sentence interpretation of the supplied technical evidence. */
  summary: string;
  /** Structured indicator readings — used by the visual indicator panel */
  indicators: IndicatorReading[];
  /** Structured bullish signal bullets */
  bullishSignals: SignalPoint[];
  /** Structured bearish signal bullets */
  bearishSignals: SignalPoint[];
  /** Long-form reasoning, kept for the collapsed disclosure */
  reasoning: string;
  warnings: string[];
  latencyMs: number;
  isFree: boolean;
  /** Which asset class this analysis was run for */
  assetClass?: string;
}

type DeterministicAnalysis = Pick<
  AIAnalysisResponse,
  | 'trendDirection'
  | 'signalQuality'
  | 'score'
  | 'confidence'
  | 'technicalPosture'
  | 'summary'
  | 'indicators'
  | 'bullishSignals'
  | 'bearishSignals'
>;

/**
 * Get list of available AI providers (from dynamic store)
 */
export async function getAvailableProviders(user: ProviderStoreUser): Promise<AIProvider[]> {
  const active = await getActiveProviders(user);
  return active.map(p => ({
    name: p.name,
    model: p.model || 'auto',
    isFree: true,
    isAvailable: true,
    maxTokens: 8192,
    rateLimit: 'varies',
  }));
}

/**
 * Deterministic technical synthesizer.
 * Takes the raw market data and produces structured indicator readings + signal lists
 * directly from the numbers. These are the authoritative UI values; provider
 * output never replaces them.
 */
function synthesizeStructured(request: AIAnalysisRequest): {
  indicators: IndicatorReading[];
  bullishSignals: SignalPoint[];
  bearishSignals: SignalPoint[];
} {
  const indicators: IndicatorReading[] = [];
  const bullish: SignalPoint[] = [];
  const bearish: SignalPoint[] = [];
  const price = request.currentPrice;

  // Price vs each SMA
  for (const [period, smaRaw] of Object.entries(request.smaValues || {})) {
    const sma = Number(smaRaw);
    if (!isFinite(sma) || sma <= 0) continue;
    const deviation = ((price - sma) / sma) * 100;
    const status: IndicatorStatus =
      Math.abs(deviation) < 0.3 ? 'neutral' : deviation > 0 ? 'bullish' : 'bearish';
    indicators.push({
      label: `Price vs SMA${period}`,
      kind: 'price_vs_ma',
      status,
      value: `${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%`,
      detail: `${price.toFixed(2)} vs ${sma.toFixed(2)}`,
      numbers: { current: price, reference: sma },
    });
    const point: SignalPoint = {
      label: `Price ${deviation >= 0 ? 'above' : 'below'} SMA${period}`,
      detail: `${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%`,
    };
    if (status === 'bullish') bullish.push(point);
    else if (status === 'bearish') bearish.push(point);
  }

  // RSI
  if (typeof request.rsi === 'number' && isFinite(request.rsi)) {
    const r = request.rsi;
    const status: IndicatorStatus = r >= 70 ? 'bearish' : r <= 30 ? 'bullish' : 'neutral';
    indicators.push({
      label: 'RSI(14)',
      kind: 'rsi',
      status,
      value: r.toFixed(1),
      detail: r >= 70 ? 'overbought' : r <= 30 ? 'oversold' : 'neutral',
      numbers: { current: r, min: 0, max: 100 },
    });
    if (r >= 70) bearish.push({ label: 'RSI overbought', detail: r.toFixed(1) });
    else if (r <= 30) bullish.push({ label: 'RSI oversold', detail: r.toFixed(1) });
  }

  // MACD
  if (request.macd) {
    const { macd, signal, histogram } = request.macd;
    const lineStatus: IndicatorStatus = macd > signal ? 'bullish' : macd < signal ? 'bearish' : 'neutral';
    const histTrend = histogram > 0 ? 'positive' : histogram < 0 ? 'negative' : 'flat';
    indicators.push({
      label: 'MACD',
      kind: 'macd',
      status: lineStatus,
      value: macd.toFixed(2),
      detail: `Histogram ${histogram >= 0 ? '+' : ''}${histogram.toFixed(2)} · ${histTrend}`,
      numbers: { current: macd, reference: signal },
    });
    if (lineStatus === 'bullish') bullish.push({ label: 'MACD line above signal', detail: macd.toFixed(2) });
    else if (lineStatus === 'bearish') bearish.push({ label: 'MACD line below signal', detail: macd.toFixed(2) });
  }

  // Recent momentum (sum of recent daily changes)
  if (request.recentPrices && request.recentPrices.length >= 2) {
    const first = request.recentPrices[0];
    const last = request.recentPrices[request.recentPrices.length - 1];
    if (first > 0) {
      const pct = ((last - first) / first) * 100;
      const status: IndicatorStatus = Math.abs(pct) < 0.5 ? 'neutral' : pct > 0 ? 'bullish' : 'bearish';
      indicators.push({
        label: `${request.recentPrices.length}-day momentum`,
        kind: 'momentum',
        status,
        value: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        detail: `${first.toFixed(2)} → ${last.toFixed(2)}`,
        numbers: { current: pct },
      });
      const point: SignalPoint = {
        label: `${request.recentPrices.length}-day net ${pct >= 0 ? 'gain' : 'loss'}`,
        detail: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      };
      if (status === 'bullish') bullish.push(point);
      else if (status === 'bearish') bearish.push(point);
    }
  }

  return { indicators, bullishSignals: bullish, bearishSignals: bearish };
}

function deriveTechnicalPosture(
  score: number,
  evidenceFamilyCount: number,
): TechnicalPosture {
  if (evidenceFamilyCount < 2) return 'uncertain';
  if (score >= 55) return 'positive';
  if (score <= 45) return 'negative';
  return 'neutral';
}

function deriveDeterministicAnalysis(
  synth: ReturnType<typeof synthesizeStructured>,
): DeterministicAnalysis {
  const directionalReadings = synth.indicators.reduce(
    (total, indicator) =>
      total + (
        indicator.status === 'bullish'
          ? 1
          : indicator.status === 'bearish'
            ? -1
            : 0
      ),
    0,
  );
  const indicatorCount = synth.indicators.length;
  const evidenceFamilyCount = new Set(
    synth.indicators.map((indicator) => indicator.kind),
  ).size;
  const directionalStrength =
    indicatorCount > 0 ? Math.abs(directionalReadings) / indicatorCount : 0;
  const score =
    indicatorCount > 0
      ? Math.round(
          Math.max(
            0,
            Math.min(100, 50 + (directionalReadings / indicatorCount) * 35),
          ),
        )
      : 50;
  const confidence =
    indicatorCount > 0
      ? Math.min(
          90,
          Math.round(
            25 + Math.min(indicatorCount, 5) * 9 + directionalStrength * 20,
          ),
        )
      : 0;
  const trendDirection: AIAnalysisResponse['trendDirection'] =
    evidenceFamilyCount < 2
      ? 'uncertain'
      : score >= 55
        ? 'bullish'
        : score <= 45
          ? 'bearish'
          : 'neutral';
  const scoreDistance = Math.abs(score - 50);
  const signalQuality: AIAnalysisResponse['signalQuality'] =
    evidenceFamilyCount < 2
      ? 'weak'
      : confidence >= 70 && scoreDistance >= 18
      ? 'strong'
      : confidence >= 45 && scoreDistance >= 8
        ? 'moderate'
        : 'weak';
  const summary =
    trendDirection === 'bullish'
      ? 'Supplied technical inputs currently show a positive posture; this is not an instruction to act.'
      : trendDirection === 'bearish'
        ? 'Supplied technical inputs currently show a negative posture; this is not an instruction to act.'
        : trendDirection === 'neutral'
          ? 'Supplied technical inputs currently show a neutral posture with mixed evidence.'
          : 'The supplied technical inputs are insufficient for a directional posture.';

  return {
    trendDirection,
    signalQuality,
    score,
    confidence,
    technicalPosture: deriveTechnicalPosture(score, evidenceFamilyCount),
    summary,
    indicators: synth.indicators,
    bullishSignals: synth.bullishSignals,
    bearishSignals: synth.bearishSignals,
  };
}

/** Build a deterministic result without accepting any provider-generated prose. */
export async function analyzeMarket(
  request: AIAnalysisRequest,
  _user: ProviderStoreUser,
  _signal?: AbortSignal,
): Promise<AIAnalysisResponse> {
  const synth = synthesizeStructured(request);
  const deterministic = deriveDeterministicAnalysis(synth);

  return {
    provider: 'InvestAtlas',
    model: 'technical-evidence-v2',
    ...deterministic,
    reasoning: 'This interpretation was generated deterministically from the supplied technical inputs. No AI-provider prose was used.',
    warnings: deterministic.technicalPosture === 'uncertain'
      ? ['At least two independent indicator families are required for a directional posture.']
      : [],
    latencyMs: 0,
    isFree: true,
    assetClass: request.assetClass,
  };
}
