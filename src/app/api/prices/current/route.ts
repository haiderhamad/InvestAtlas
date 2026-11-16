import { NextResponse } from 'next/server';
import {
  getAssetConfig,
  SUPPORTED_CRYPTO_ASSETS,
} from '@/lib/config/supported-assets';
import {
  MarketRequestValidationError,
  parseMarketSymbols,
  parseQuoteCurrency,
} from '@/lib/api/market-request';
import {
  enforceRateLimit,
  AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT,
  PUBLIC_CURRENT_PRICE_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import { getCurrentQuotes } from '@/lib/financial-data/quotes/current-quote-service';
import {
  getFirebaseUserFromToken,
  getOptionalFirebaseAuthToken,
  ProviderStoreAuthError,
} from '@/lib/ai/provider-store';
import { getPersonalCurrentQuotes } from '@/lib/financial-data/providers/personal-market-data';
import { FinancialCredentialStoreError } from '@/lib/financial-data/providers/credential-store';
import {
  hasActivePublicFinancialDataProvider,
  isFinancialDataProviderActive,
} from '@/lib/financial-data/providers/catalog';

const FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT = {
  bucket: 'financial-auth-verification',
  limit: 60,
  windowMs: 60_000,
} as const;

/**
 * GET /api/prices/current?symbols=BTC,ETH,SOL,AAPL,GOLD
 *
 * Legacy scalar fields remain additive-compatible while `fields` carries the
 * v1.2 source, currency, freshness, and availability contract.
 */
export async function GET(request: Request) {
  const token = getOptionalFirebaseAuthToken(request);
  if (token) {
    const authLimited = enforceRateLimit(
      request,
      FINANCIAL_AUTH_VERIFICATION_RATE_LIMIT,
    );
    if (authLimited) return authLimited;
  }

  try {
    const user = token ? await getFirebaseUserFromToken(token) : null;
    const limited = enforceRateLimit(
      request,
      user ? AUTHENTICATED_FINANCIAL_COMPUTE_RATE_LIMIT : PUBLIC_CURRENT_PRICE_RATE_LIMIT,
      user?.uid,
    );
    if (limited) return limited;
    const { searchParams } = new URL(request.url);
    const symbols = parseMarketSymbols(
      searchParams.get('symbols'),
      'BTC,ETH,SOL',
    );
    const currency = parseQuoteCurrency(searchParams.get('currency'));
    const validSymbols = symbols.filter((symbol) => Boolean(getAssetConfig(symbol)));
    if (validSymbols.length === 0 || validSymbols.length !== symbols.length) {
      return NextResponse.json(
        { error: 'One or more symbols are unsupported' },
        { status: 400 },
      );
    }

    const routeCanProvideQuotes = user
      ? isFinancialDataProviderActive('tiingo_byok')
      : hasActivePublicFinancialDataProvider('quote');
    const result = routeCanProvideQuotes
      ? user
        ? await getPersonalCurrentQuotes(user, validSymbols, currency, request.signal)
        : await getCurrentQuotes(validSymbols, currency, request.signal)
      : {
          status: 'unavailable' as const,
          prices: {},
          issues: validSymbols.map((symbol) => ({
            symbol,
            code: 'provider_unavailable' as const,
          })),
          verificationLogs: [],
        };
    const sources = new Set(
      Object.values(result.prices)
        .map((snapshot) => snapshot.source)
        .filter(Boolean),
    );

    return NextResponse.json({
      status: result.status,
      prices: result.prices,
      currency,
      timestamp: new Date().toISOString(),
      source: [...sources].join(' + ') || 'n/a',
      issues: result.issues.length > 0 ? result.issues : undefined,
      verificationLogs:
        result.verificationLogs.length > 0
          ? result.verificationLogs
          : undefined,
      availableCryptoAssets: SUPPORTED_CRYPTO_ASSETS.length,
      dataMode: user ? 'personal_provider' : 'official_open_data',
      refreshPolicy: routeCanProvideQuotes ? 'poll_when_visible' : 'manual_only',
      synthetic: false,
    }, {
      headers: user
        ? { 'Cache-Control': 'private, no-store, max-age=0' }
        : undefined,
    });
  } catch (error) {
    if (error instanceof MarketRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
    console.error('Current-price request failed');
    return NextResponse.json(
      { error: 'Current market data is temporarily unavailable' },
      { status: 502 },
    );
  }
}
