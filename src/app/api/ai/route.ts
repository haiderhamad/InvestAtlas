import { analyzeMarket, getAvailableProviders } from '@/lib/ai/analyzer';
import type { AIAnalysisRequest } from '@/lib/ai/analyzer';
import { ProviderStoreAuthError, requireFirebaseUser } from '@/lib/ai/provider-store';
import {
  ApiPayloadError,
  isBoundedString,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
  AUTHENTICATED_AI_READ_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';

const MAX_ANALYSIS_BODY_BYTES = 64 * 1024;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

function isFiniteRecord(
  value: unknown,
  maximumEntries: number,
): value is Record<string, number> {
  return (
    isPlainObject(value)
    && Object.keys(value).length <= maximumEntries
    && Object.entries(value).every(
      ([key, item]) =>
        key.length <= 16
        && typeof item === 'number'
        && Number.isFinite(item)
        && item > 0,
    )
  );
}

function isAnalysisRequest(value: unknown): value is AIAnalysisRequest {
  if (!isPlainObject(value)) return false;
  const macd = value.macd;

  return (
    isBoundedString(value.asset, 32)
    && ASSET_PATTERN.test(value.asset.trim().toUpperCase())
    && typeof value.currentPrice === 'number'
    && Number.isFinite(value.currentPrice)
    && value.currentPrice > 0
    && value.currentPrice <= 1_000_000_000_000_000
    && isFiniteRecord(value.smaValues, 20)
    && (
      value.emaValues === undefined
      || isFiniteRecord(value.emaValues, 20)
    )
    && Array.isArray(value.recentPrices)
    && value.recentPrices.length <= 100
    && value.recentPrices.every(
      (price) =>
        typeof price === 'number'
        && Number.isFinite(price)
        && price > 0,
    )
    && (
      value.currency === undefined
      || value.currency === 'eur'
      || value.currency === 'usd'
    )
    && (
      value.assetClass === undefined
      || ['crypto', 'stock', 'etf', 'metal'].includes(String(value.assetClass))
    )
    && (
      value.locale === undefined
      || ['en', 'de', 'ar'].includes(String(value.locale))
    )
    && (
      value.rsi === undefined
      || (
        typeof value.rsi === 'number'
        && Number.isFinite(value.rsi)
        && value.rsi >= 0
        && value.rsi <= 100
      )
    )
    && (
      macd === undefined
      || (
        isPlainObject(macd)
        && ['macd', 'signal', 'histogram'].every(
          (key) =>
            typeof macd[key] === 'number'
            && Number.isFinite(macd[key]),
        )
      )
    )
  );
}

function handleProviderError(error: unknown) {
  if (error instanceof ApiPayloadError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof ProviderStoreAuthError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  return privateJson({ error: 'AI analysis failed' }, { status: 502 });
}

/**
 * GET /api/ai — Returns available AI providers and their status
 */
export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_READ_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const providers = await getAvailableProviders(user);
    return privateJson({ providers });
  } catch (error) {
    return handleProviderError(error);
  }
}

/**
 * POST /api/ai — Run AI analysis on market data
 */
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const body = await readBoundedJson(request, MAX_ANALYSIS_BODY_BYTES);

    if (!isAnalysisRequest(body)) {
      return privateJson(
        { error: 'Invalid analysis input' },
        { status: 400 }
      );
    }

    const result = await analyzeMarket(
      body,
      user,
      AbortSignal.timeout(30_000),
    );

    return privateJson({
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleProviderError(error);
  }
}
