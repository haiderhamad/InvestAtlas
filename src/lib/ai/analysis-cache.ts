import type {
  AIAnalysisResponse,
  IndicatorReading,
  SignalPoint,
} from './analyzer';

export type StoredAnalysisEntry = AIAnalysisResponse & {
  id: string;
  asset: string;
  date: string;
};

export const AI_ANALYSIS_STORAGE_KEY = 'investatlas.ai-analysis-v2';

const SUMMARY_KEYS = new Set([
  'Supplied technical inputs currently show a positive posture; this is not an instruction to act.',
  'Supplied technical inputs currently show a negative posture; this is not an instruction to act.',
  'Supplied technical inputs currently show a neutral posture with mixed evidence.',
  'The supplied technical inputs are insufficient for a directional posture.',
]);
const REASONING_KEY = 'This interpretation was generated deterministically from the supplied technical inputs. No AI-provider prose was used.';
const WARNING_KEY = 'At least two independent indicator families are required for a directional posture.';
const SUMMARY_BY_POSTURE = {
  positive: 'Supplied technical inputs currently show a positive posture; this is not an instruction to act.',
  negative: 'Supplied technical inputs currently show a negative posture; this is not an instruction to act.',
  neutral: 'Supplied technical inputs currently show a neutral posture with mixed evidence.',
  uncertain: 'The supplied technical inputs are insufficient for a directional posture.',
} as const;
const TOP_LEVEL_KEYS = new Set([
  'id', 'asset', 'date', 'provider', 'model', 'trendDirection', 'signalQuality',
  'score', 'confidence', 'technicalPosture', 'summary', 'indicators',
  'bullishSignals', 'bearishSignals', 'reasoning', 'warnings', 'latencyMs',
  'isFree', 'assetClass',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isShortText(value: unknown, maximum = 120): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[<>\u0000-\u001F\u007F]/u.test(value);
}

function isIndicator(value: unknown): value is IndicatorReading {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => (
    key === 'label'
    || key === 'kind'
    || key === 'status'
    || key === 'value'
    || key === 'detail'
    || key === 'numbers'
  ))) return false;
  if (value.numbers !== undefined) {
    if (!isRecord(value.numbers)) return false;
    const numberKeys = Object.keys(value.numbers);
    if (
      !numberKeys.every((key) => (
        key === 'current'
        || key === 'reference'
        || key === 'min'
        || key === 'max'
      ))
      || !Object.values(value.numbers).every((item) => (
        typeof item === 'number'
        && Number.isFinite(item)
        && Math.abs(item) <= 1_000_000_000_000_000
      ))
    ) return false;
  }
  return (
    typeof value.label === 'string'
    && /^(?:Price vs SMA\d+|RSI\(14\)|MACD|\d+-day momentum)$/u.test(value.label)
    && ['price_vs_ma', 'rsi', 'macd', 'momentum', 'generic'].includes(String(value.kind))
    && ['bullish', 'bearish', 'neutral'].includes(String(value.status))
    && isShortText(value.value, 40)
    && (value.detail === undefined || isShortText(value.detail, 120))
  );
}

function isSignal(value: unknown): value is SignalPoint {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every((key) => key === 'label' || key === 'detail')) {
    return false;
  }
  return (
    typeof value.label === 'string'
    && /^(?:Price (?:above|below) SMA\d+|RSI (?:overbought|oversold)|MACD line (?:above|below) signal|\d+-day net (?:gain|loss))$/u.test(value.label)
    && (value.detail === undefined || isShortText(value.detail, 40))
  );
}

export function parseStoredAnalysis(raw: string | null): StoredAnalysisEntry | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const keys = Object.keys(parsed);
  if (!keys.every((key) => TOP_LEVEL_KEYS.has(key))) return null;
  const posture = String(parsed.technicalPosture) as keyof typeof SUMMARY_BY_POSTURE;
  const postureMatchesTrend = (
    (posture === 'positive' && parsed.trendDirection === 'bullish')
    || (posture === 'negative' && parsed.trendDirection === 'bearish')
    || (posture === 'neutral' && parsed.trendDirection === 'neutral')
    || (posture === 'uncertain' && parsed.trendDirection === 'uncertain')
  );
  const postureMatchesScore = (
    (posture === 'positive' && typeof parsed.score === 'number' && parsed.score >= 55)
    || (posture === 'negative' && typeof parsed.score === 'number' && parsed.score <= 45)
    || (posture === 'neutral' && typeof parsed.score === 'number' && parsed.score > 45 && parsed.score < 55)
    || posture === 'uncertain'
  );

  if (
    parsed.provider !== 'InvestAtlas'
    || parsed.model !== 'technical-evidence-v2'
    || typeof parsed.id !== 'string'
    || typeof parsed.asset !== 'string'
    || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(parsed.asset)
    || typeof parsed.date !== 'string'
    || !Number.isFinite(Date.parse(parsed.date))
    || !['bullish', 'bearish', 'neutral', 'uncertain'].includes(String(parsed.trendDirection))
    || !['strong', 'moderate', 'weak'].includes(String(parsed.signalQuality))
    || !['positive', 'neutral', 'negative', 'uncertain'].includes(String(parsed.technicalPosture))
    || !isFiniteRange(parsed.score, 0, 100)
    || !isFiniteRange(parsed.confidence, 0, 100)
    || typeof parsed.summary !== 'string'
    || !SUMMARY_KEYS.has(parsed.summary)
    || parsed.summary !== SUMMARY_BY_POSTURE[posture]
    || !postureMatchesTrend
    || !postureMatchesScore
    || (posture === 'uncertain' && parsed.signalQuality !== 'weak')
    || parsed.reasoning !== REASONING_KEY
    || !Array.isArray(parsed.indicators)
    || parsed.indicators.length > 20
    || !parsed.indicators.every(isIndicator)
    || !Array.isArray(parsed.bullishSignals)
    || parsed.bullishSignals.length > 20
    || !parsed.bullishSignals.every(isSignal)
    || !Array.isArray(parsed.bearishSignals)
    || parsed.bearishSignals.length > 20
    || !parsed.bearishSignals.every(isSignal)
    || !Array.isArray(parsed.warnings)
    || parsed.warnings.length > 1
    || !parsed.warnings.every((warning) => warning === WARNING_KEY)
    || parsed.warnings.length !== (posture === 'uncertain' ? 1 : 0)
    || parsed.latencyMs !== 0
    || parsed.isFree !== true
  ) {
    return null;
  }

  return parsed as unknown as StoredAnalysisEntry;
}
