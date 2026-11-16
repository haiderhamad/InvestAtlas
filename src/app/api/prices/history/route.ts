import { NextResponse } from 'next/server';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';
import { SUPPORTED_ASSETS } from '@/lib/config/supported-assets';
import {
  HistoryRequestValidationError,
  normalizeHistoryRequest,
} from '@/lib/data/history-request';
import {
  enforceRateLimit,
  AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import {
  type FieldProvenance,
} from '@/lib/financial-data/contracts';
import {
  getFirebaseUserFromToken,
  getOptionalFirebaseAuthToken,
  ProviderStoreAuthError,
} from '@/lib/ai/provider-store';
import { getPersonalHistory } from '@/lib/financial-data/providers/personal-market-data';
import { FinancialCredentialStoreError } from '@/lib/financial-data/providers/credential-store';
import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT = {
  bucket: 'financial-auth-verification',
  limit: 60,
  windowMs: 60_000,
} as const;

type CompactHistorySource = FieldProvenance & {
  ref: string;
  kind: 'market' | 'fx';
};

function findBarProvenance(
  date: string,
  segments: Awaited<ReturnType<typeof buildConsolidatedHistory>>['provenance'],
  providerId?: string,
  providerName?: string,
  retrievedAt?: string,
): FieldProvenance {
  const segment = segments.find(
    (candidate) =>
      candidate.startDate <= date && candidate.endDate >= date,
  );
  return {
    providerId: providerId ?? segment?.providerId ?? 'unknown_provider',
    providerName: providerName ?? segment?.providerName ?? 'Unknown provider',
    retrievedAt: retrievedAt ?? segment?.retrievedAt ?? null,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const metadataOnly = searchParams.get('metadata') === 'true';
  const currency = searchParams.get('currency') || 'eur';
  const interval = searchParams.get('interval') || '1d';

  if (!symbol && !metadataOnly) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const token = getOptionalFirebaseAuthToken(req);
  if (token) {
    const authLimited = enforceRateLimit(
      req,
      FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT,
    );
    if (authLimited) return authLimited;
  }

  try {
    const user = token ? await getFirebaseUserFromToken(token) : null;
    const limited = enforceRateLimit(
      req,
      user ? AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT : PUBLIC_HISTORY_RATE_LIMIT,
      user?.uid,
    );
    if (limited) return limited;

    if (metadataOnly) {
      const assetMetadata = SUPPORTED_ASSETS.map((asset) => ({
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
        source: 'Available provider selected at request time',
        firstDate: null,
        lastDate: null,
        dataPoints: null,
        isComplete: null,
        lastSyncAt: null,
        warnings: ['Persistent history coverage is not measured.'],
      }));

      return NextResponse.json({
        assets: assetMetadata,
        coins: assetMetadata,
      });
    }

    if (user) {
      const normalized = normalizeHistoryRequest(symbol!, currency, interval);
      if (!isFinancialDataProviderActive('tiingo_byok')) {
        return NextResponse.json({
          contractVersion: 'history.v2',
          status: 'unavailable',
          symbol: normalized.symbol,
          currency: normalized.currency,
          prices: [],
          sources: [],
          provenance: [],
          warnings: ['No active personal provider can supply this history.'],
          cache: { status: 'miss' },
          freshness: 'unknown',
          latestObservationAt: null,
          isComplete: false,
          generatedAt: new Date().toISOString(),
          dataMode: 'personal_provider',
          synthetic: false,
        }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
      }
      if (normalized.interval !== '1d') {
        return NextResponse.json({
          contractVersion: 'history.v2',
          status: 'unavailable',
          symbol: normalized.symbol,
          currency: normalized.currency,
          prices: [],
          sources: [],
          dataMode: 'personal_provider',
          synthetic: false,
          error: 'The connected provider does not support this interval.',
        }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
      }
      const personal = await getPersonalHistory(
        user,
        normalized.symbol,
        normalized.currency,
        req.signal,
      );
      return NextResponse.json(personal ?? {
        contractVersion: 'history.v2',
        status: 'unavailable',
        symbol: normalized.symbol,
        currency: normalized.currency,
        prices: [],
        sources: [],
        provenance: [],
        warnings: ['No connected personal provider can supply this history.'],
        cache: { status: 'miss' },
        freshness: 'unknown',
        latestObservationAt: null,
        isComplete: false,
        generatedAt: new Date().toISOString(),
        dataMode: 'personal_provider',
        synthetic: false,
      }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    }

    const normalized = normalizeHistoryRequest(symbol!, currency, interval);
    const history = await buildConsolidatedHistory(
      normalized.symbol,
      normalized.currency,
      normalized.interval,
      false,
      req.signal,
    );

    // Keep provenance auditable without repeating the same provider object for
    // every field of every bar. The previous field-level expansion made a
    // normal ten-year FX-converted series exceed Vercel's response limit.
    const sources: CompactHistorySource[] = [];
    const sourceRefs = new Map<string, string>();
    const registerSource = (
      kind: CompactHistorySource['kind'],
      source: FieldProvenance,
    ): string => {
      const key = JSON.stringify([
        kind,
        source.providerId,
        source.providerName,
        source.retrievedAt,
        source.publicSourceUrl ?? null,
        source.method ?? null,
      ]);
      const existing = sourceRefs.get(key);
      if (existing) return existing;

      const ref = `${kind}_${sources.length + 1}`;
      sourceRefs.set(key, ref);
      sources.push({
        ref,
        kind,
        providerId: source.providerId,
        providerName: source.providerName,
        retrievedAt: source.retrievedAt,
        ...(source.publicSourceUrl
          ? { publicSourceUrl: source.publicSourceUrl }
          : {}),
        ...(source.method ? { method: source.method } : {}),
      });
      return ref;
    };

    const mappedPrices = history.prices.map((price) => {
      const closeOnly = price.quality === 'close_only';
      const volumeAvailable = price.volumeAvailable !== false;
      const sourceProvenance = findBarProvenance(
        price.date,
        history.provenance,
        price.providerId,
        price.providerName,
        price.retrievedAt,
      );
      const sourceRef = registerSource('market', sourceProvenance);
      const converted = Boolean(
        price.fx
        && price.sourceCurrency
        && price.currency
        && price.sourceCurrency !== price.currency,
      );
      const conversion = converted && price.fx && price.sourceCurrency
        ? {
            sourceCurrency: price.sourceCurrency,
            rate: price.fx.rate,
            asOf: price.fx.asOf,
            sourceRef: registerSource('fx', {
              providerId: price.fx.providerId,
              providerName: price.fx.providerName,
              retrievedAt: price.fx.retrievedAt,
              ...(price.fx.method ? { method: price.fx.method } : {}),
            }),
          }
        : undefined;

      return {
        date: price.date,
        close: price.close,
        open: closeOnly ? null : price.open,
        high: closeOnly ? null : price.high,
        low: closeOnly ? null : price.low,
        volume: volumeAvailable ? price.volume : null,
        dataQuality: price.quality ?? 'ohlc',
        priceQuality: converted ? 'calculated' : 'observed',
        sourceRef,
        ...(conversion ? { conversion } : {}),
      };
    });
    const status = mappedPrices.length === 0
      ? 'unavailable'
      : history.cache?.status !== 'hit_stale'
        && history.freshness !== 'stale'
        && history.isComplete
        && history.provenance.every((segment) => segment.status === 'structurally_valid')
        ? 'complete'
        : 'partial';

    return NextResponse.json({
      contractVersion: 'history.v2',
      status,
      symbol: normalized.symbol,
      currency: normalized.currency,
      prices: mappedPrices,
      sources,
      provenance: history.provenance,
      warnings: history.warnings,
      cache: history.cache,
      freshness: history.freshness ?? 'unknown',
      latestObservationAt: history.latestObservationAt ?? null,
      isComplete: history.isComplete,
      generatedAt: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': history.cache?.status === 'hit_stale'
          || history.freshness === 'stale'
          ? 'no-store'
          : 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });

  } catch (error) {
    if (error instanceof HistoryRequestValidationError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    if (error instanceof ProviderStoreAuthError) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof FinancialCredentialStoreError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    console.error('Historical market-data request failed');
    return NextResponse.json(
      { error: 'Historical market data is temporarily unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
