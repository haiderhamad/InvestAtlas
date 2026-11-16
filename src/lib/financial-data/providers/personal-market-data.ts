import type { ProviderStoreUser } from '@/lib/ai/provider-store';
import {
  getAssetConfig,
  type QuoteCurrency,
} from '@/lib/config/supported-assets';
import {
  availableField,
  createMoney,
  deriveResultStatus,
  unavailableField,
  type CurrencyCode,
  type DataField,
  type FieldProvenance,
  type Money,
  type QuoteSnapshot,
} from '@/lib/financial-data/contracts';
import {
  convertMoneyWithFx,
  fetchEcbCurrentFx,
  fetchEcbFxHistory,
  resolveHistoricalFx,
  type FxObservation,
} from '@/lib/financial-data/fx/ecb';
import type {
  CurrentPriceSnapshot,
  CurrentQuoteIssue,
} from '@/lib/financial-data/quotes/current-quote-service';
import { evaluateHistoryRecency } from '@/lib/financial-data/history/recency';
import { isFinancialDataProviderActive } from './catalog';
import {
  listFinancialCredentialsRaw,
  type FinancialProviderCredential,
} from './credential-store';
import {
  fetchTiingoDailyPrices,
  TiingoProviderError,
  type TiingoDailyPrice,
} from './tiingo';

const SIMPLE_US_TICKER = /^[A-Z][A-Z0-9.-]{0,15}$/;
const MAX_QUOTE_AGE_MS = 7 * 86_400_000;
const MIN_COMPLETE_FOUR_YEAR_DAILY_OBSERVATIONS = 800;
const PERSONAL_QUOTE_CONCURRENCY = 4;
const PERSONAL_QUOTE_REQUEST_TIMEOUT_MS = 8_000;
const PERSONAL_HISTORY_REQUEST_TIMEOUT_MS = 12_000;

type PersonalTiingoCredential = FinancialProviderCredential & {
  credentialRevision: number;
};

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currencyCode(currency: QuoteCurrency): CurrencyCode {
  return currency.toUpperCase() as CurrencyCode;
}

function provenance(retrievedAt: string): FieldProvenance {
  return {
    providerId: 'tiingo_byok',
    providerName: 'Tiingo (personal provider)',
    retrievedAt,
  };
}

function sourceMoney(
  amount: number,
  observedAt: string,
  retrievedAt: string,
): DataField<Money> {
  return availableField(createMoney(amount, 'USD'), {
    quality: 'observed',
    freshness: 'fresh',
    observedAt,
    asOf: observedAt,
    provenance: provenance(retrievedAt),
    limitations: ['single_source', 'delayed'],
  });
}

async function outputMoney(
  amount: number,
  observedAt: string,
  retrievedAt: string,
  currency: QuoteCurrency,
  fx?: FxObservation,
): Promise<DataField<Money>> {
  const field = sourceMoney(amount, observedAt, retrievedAt);
  if (currency === 'usd') return field;
  return field.status === 'available' && fx
    ? convertMoneyWithFx(field.value, fx, field.provenance)
    : unavailableField('fx_unavailable');
}

function providerTicker(symbol: string): string | null {
  const asset = getAssetConfig(symbol);
  if (!asset || (asset.assetClass !== 'stock' && asset.assetClass !== 'etf')) {
    return null;
  }
  // v1.2 intentionally supports Tiingo's US daily feed only. European listing
  // mappings need an independently verified exchange/ticker mapping later.
  if (asset.nativeCurrency !== 'usd') return null;
  const ticker = (asset.yahooSymbol ?? asset.symbol).toUpperCase();
  return SIMPLE_US_TICKER.test(ticker) ? ticker : null;
}

async function resolveCredential(
  user: ProviderStoreUser,
  capability: 'quote' | 'history',
  signal?: AbortSignal,
): Promise<PersonalTiingoCredential | null> {
  return (await listFinancialCredentialsRaw(user, signal)).find(
    (candidate) => candidate.id === 'tiingo'
      && candidate.enabled
      && candidate.status === 'connected'
      && candidate.detectedCapabilities.includes(capability),
  ) ?? null;
}

async function allSettledWithConcurrency<Item, Result>(
  items: Item[],
  concurrency: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Array<PromiseSettledResult<Result>>> {
  const results = new Array<PromiseSettledResult<Result>>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(items[index]),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => runWorker(),
    ),
  );
  return results;
}

async function loadRows(input: {
  uid: string;
  ticker: string;
  credential: PersonalTiingoCredential;
  startDate: string;
  endDate: string;
  signal?: AbortSignal;
}): Promise<{
  rows: TiingoDailyPrice[];
} | null> {
  try {
    const rows = await fetchTiingoDailyPrices({
      apiKey: input.credential.apiKey,
      healthKey: `${input.uid}:${input.credential.id}:${input.credential.credentialRevision}`,
      symbol: input.ticker,
      startDate: input.startDate,
      endDate: input.endDate,
      signal: input.signal,
    });
    // Personal Tiingo rows are intentionally request-bound. In particular,
    // Starter/Trial terms do not permit raw provider data to survive the
    // operation in a process-global or other persistent/durable cache.
    return { rows };
  } catch (error) {
    if (error instanceof TiingoProviderError) return null;
    throw error;
  }
}

export async function getPersonalCurrentQuotes(
  user: ProviderStoreUser,
  symbols: string[],
  currency: QuoteCurrency,
  signal?: AbortSignal,
): Promise<{
  status: 'complete' | 'partial' | 'unavailable';
  prices: Record<string, CurrentPriceSnapshot>;
  issues: CurrentQuoteIssue[];
  verificationLogs: string[];
}> {
  const prices: Record<string, CurrentPriceSnapshot> = {};
  const issues: CurrentQuoteIssue[] = [];
  const requested = [...new Set(symbols)];
  if (!isFinancialDataProviderActive('tiingo_byok')) {
    return {
      status: 'unavailable',
      prices,
      issues: requested.map((symbol) => ({
        symbol,
        code: 'provider_unavailable',
      })),
      verificationLogs: [],
    };
  }
  const supported = requested.flatMap((symbol) => {
    const ticker = providerTicker(symbol);
    return ticker ? [{ symbol, ticker }] : [];
  });
  const unsupported = new Set(
    requested.filter((symbol) => !supported.some((item) => item.symbol === symbol)),
  );
  issues.push(
    ...[...unsupported].map((symbol) => ({
      symbol,
      code: 'provider_unavailable' as const,
    })),
  );

  const timeoutSignal = AbortSignal.timeout(PERSONAL_QUOTE_REQUEST_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const credential = supported.length > 0
    ? await resolveCredential(user, 'quote', requestSignal)
    : null;
  if (!credential) {
    issues.push(
      ...supported.map(({ symbol }) => ({
        symbol,
        code: 'provider_unavailable' as const,
      })),
    );
    return {
      status: 'unavailable',
      prices,
      issues,
      verificationLogs: [],
    };
  }

  let fx: FxObservation | undefined;
  if (currency === 'eur') {
    try {
      fx = await fetchEcbCurrentFx('USD', 'EUR', new Date(), requestSignal);
    } catch {
      fx = undefined;
    }
  }
  if (
    currency === 'eur'
    && (
      !fx
      || fx.rate.status !== 'available'
      || fx.rate.freshness === 'stale'
    )
  ) {
    issues.push(
      ...supported.map(({ symbol }) => ({
        symbol,
        code: 'fx_unavailable' as const,
      })),
    );
    return {
      status: 'unavailable',
      prices,
      issues,
      verificationLogs: [],
    };
  }
  const outcomes = await allSettledWithConcurrency(
    supported,
    PERSONAL_QUOTE_CONCURRENCY,
    async ({ symbol, ticker }) => {
      const loaded = await loadRows({
        uid: user.uid,
        ticker,
        credential,
        startDate: dateOffset(-14),
        endDate: dateOffset(0),
        signal: requestSignal,
      });
      const latest = loaded?.rows.at(-1);
      const previous = loaded?.rows.at(-2);
      const observedAt = latest?.date;
      if (
        !loaded
        || !latest
        || !previous
        || !observedAt
        || Date.now() - Date.parse(observedAt) > MAX_QUOTE_AGE_MS
      ) {
        return { symbol, snapshot: null };
      }
      const retrievedAt = new Date().toISOString();
      const [priceField, previousField] = await Promise.all([
        outputMoney(latest.close, observedAt, retrievedAt, currency, fx),
        outputMoney(previous.close, previous.date, retrievedAt, currency, fx),
      ]);
      if (priceField.status !== 'available') {
        return { symbol, snapshot: null };
      }
      const change = ((latest.close - previous.close) / previous.close) * 100;
      const fields: QuoteSnapshot = {
        assetId: symbol,
        listingCurrency: 'USD',
        outputCurrency: currencyCode(currency),
        price: priceField,
        previousClose: previousField,
        changePercent: availableField(change, {
          quality: 'calculated',
          freshness: 'fresh',
          observedAt,
          asOf: observedAt,
          provenance: {
            providerId: 'investatlas_calculation',
            providerName: 'InvestAtlas',
            retrievedAt,
            method: 'percentage change between two sourced Tiingo daily closes',
            derivedFrom: [provenance(retrievedAt)],
          },
          limitations: ['delayed'],
        }),
        volume: availableField(latest.volume, {
          quality: 'observed',
          freshness: 'fresh',
          observedAt,
          asOf: observedAt,
          provenance: provenance(retrievedAt),
          limitations: ['single_source', 'delayed'],
        }),
        marketCap: unavailableField('not_provided'),
        yearHigh: unavailableField('not_provided'),
        yearLow: unavailableField('not_provided'),
      };
      return {
        symbol,
        snapshot: {
          price: priceField.value.amount,
          change24h: change,
          volume24h: latest.volume,
          marketCap: null,
          yearHigh: null,
          yearLow: null,
          displayName: getAssetConfig(symbol)?.name,
          instrumentType: getAssetConfig(symbol)?.assetClass ?? null,
          verified: false,
          source: 'Tiingo (personal provider)',
          currency,
          dataStatus: deriveResultStatus(Object.values(fields)),
          changePeriod: 'session',
          fields,
          dataMode: 'personal_provider',
        } satisfies CurrentPriceSnapshot,
      };
    },
  );

  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    const symbol = supported[index].symbol;
    if (outcome.status === 'fulfilled' && outcome.value.snapshot) {
      prices[symbol] = outcome.value.snapshot;
    } else {
      issues.push({ symbol, code: 'provider_unavailable' });
    }
  }
  const hasPartialSnapshot = Object.values(prices).some(
    (snapshot) => snapshot.dataStatus !== 'complete',
  );
  return {
    status: Object.keys(prices).length === 0
      ? 'unavailable'
      : Object.keys(prices).length === requested.length
          && issues.length === 0
          && !hasPartialSnapshot
        ? 'complete'
        : 'partial',
    prices,
    issues,
    verificationLogs: [],
  };
}

export async function getPersonalHistory(
  user: ProviderStoreUser,
  symbol: string,
  currency: QuoteCurrency,
  signal?: AbortSignal,
) {
  if (!isFinancialDataProviderActive('tiingo_byok')) return null;
  const ticker = providerTicker(symbol);
  if (!ticker) return null;
  const timeoutSignal = AbortSignal.timeout(PERSONAL_HISTORY_REQUEST_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const credential = await resolveCredential(user, 'history', requestSignal);
  if (!credential) return null;
  const loaded = await loadRows({
    uid: user.uid,
    ticker,
    credential,
    startDate: dateOffset(-1_825),
    endDate: dateOffset(0),
    signal: requestSignal,
  });
  if (!loaded) return null;
  const retrievedAt = new Date().toISOString();
  const startDate = loaded.rows[0]?.date.slice(0, 10);
  const endDate = loaded.rows.at(-1)?.date.slice(0, 10);
  if (!startDate || !endDate) return null;
  let fxHistory: FxObservation[] = [];
  if (currency === 'eur') {
    try {
      fxHistory = await fetchEcbFxHistory(
        'USD',
        'EUR',
        startDate,
        endDate,
        new Date(),
        requestSignal,
      );
    } catch {
      return null;
    }
  }
  const mappedRows = loaded.rows.flatMap((row) => {
    const date = row.date.slice(0, 10);
    if (currency === 'usd') {
      return [{
        date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        dataQuality: 'ohlc',
        priceQuality: 'observed',
        sourceRef: 'personal_1',
      }];
    }
    const fx = resolveHistoricalFx(fxHistory, date);
    if (fx?.rate.status !== 'available') return [];
    return [{
      date,
      open: row.open * fx.rate.value,
      high: row.high * fx.rate.value,
      low: row.low * fx.rate.value,
      close: row.close * fx.rate.value,
      volume: row.volume,
      dataQuality: 'ohlc',
      priceQuality: 'calculated',
      sourceRef: 'personal_1',
      conversion: {
        sourceCurrency: 'USD',
        rate: fx.rate.value,
        asOf: fx.rate.asOf,
        sourceRef: 'fx_1',
      },
    }];
  });
  if (mappedRows.length === 0) return null;
  const assetClass = getAssetConfig(symbol)?.assetClass ?? 'stock';
  const recency = evaluateHistoryRecency(mappedRows, '1d', assetClass);
  const mappedStartDate = mappedRows[0].date;
  const mappedEndDate = mappedRows.at(-1)?.date ?? '';
  const firstObservation = Date.parse(mappedStartDate);
  const lastObservation = Date.parse(mappedEndDate);
  const hasFourYears = Number.isFinite(firstObservation)
    && Number.isFinite(lastObservation)
    && lastObservation - firstObservation >= 4 * 365 * 86_400_000;
  const hasSufficientObservationDensity =
    mappedRows.length >= MIN_COMPLETE_FOUR_YEAR_DAILY_OBSERVATIONS;
  const hasCompleteFxCoverage = currency === 'usd'
    || mappedRows.length === loaded.rows.length;
  const isComplete = recency.freshness === 'fresh'
    && hasFourYears
    && hasSufficientObservationDensity
    && hasCompleteFxCoverage;
  const warnings = [
    'Personal Tiingo daily data; availability and delay depend on the user-owned plan.',
    ...(!hasFourYears
      ? ['Historical coverage is shorter than four years.']
      : []),
    ...(!hasSufficientObservationDensity
      ? ['Historical coverage is too sparse to be considered complete.']
      : []),
    ...(!hasCompleteFxCoverage
      ? ['Historical FX coverage is incomplete.']
      : []),
    ...(recency.freshness === 'stale'
      ? ['Latest personal-provider history is stale.']
      : []),
  ];
  return {
    contractVersion: 'history.v2',
    status: isComplete ? 'complete' : 'partial',
    symbol,
    currency,
    prices: mappedRows,
    sources: [
      {
        ref: 'personal_1',
        kind: 'market',
        ...provenance(retrievedAt),
      },
      ...(currency === 'eur' ? [{
        ref: 'fx_1',
        kind: 'fx',
        providerId: 'ecb_reference_rates',
        providerName: 'European Central Bank',
        retrievedAt,
        method: 'date-aligned ECB EUR reference-rate conversion',
      }] : []),
    ],
    provenance: [{
      startDate: mappedStartDate,
      endDate: mappedEndDate,
      providerId: 'tiingo_byok',
      providerName: 'Tiingo (personal provider)',
      role: 'personal_provider',
      dataPoints: mappedRows.length,
      status: isComplete ? 'structurally_valid' : 'partial',
      retrievedAt,
    }],
    warnings,
    cache: { status: 'miss' },
    freshness: recency.freshness,
    latestObservationAt: recency.latestObservationAt,
    isComplete,
    generatedAt: retrievedAt,
    dataMode: 'personal_provider',
    synthetic: false,
    realtime: false,
  };
}
