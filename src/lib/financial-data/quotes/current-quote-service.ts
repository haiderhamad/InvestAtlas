import type { QuoteCurrency } from '@/lib/config/supported-assets';
import {
  getAssetConfig,
  type AssetConfig,
} from '@/lib/config/supported-assets';
import { fetchProvider } from '@/lib/data/provider-fetch';
import {
  availableField,
  createMoney,
  deriveResultStatus,
  unavailableField,
  type AvailableDataField,
  type CurrencyCode,
  type DataField,
  type FieldProvenance,
  type Money,
  type QuoteSnapshot,
  type ResultStatus,
} from '@/lib/financial-data/contracts';
import {
  convertMoneyWithFx,
  fetchEcbCurrentFx,
  type FxObservation,
} from '@/lib/financial-data/fx/ecb';
import { fetchBitfinexPrice } from '@/lib/prices/bitfinex';
import { fetchYahooCurrentQuote, type YahooCurrentQuote } from '@/lib/prices/yahoo';
import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const MAX_EXCHANGE_FALLBACKS = 8;
const MAX_CONCURRENT_PROVIDER_REQUESTS = 4;
const CURRENT_PROVIDER_TIMEOUT_MS = 5_000;
const CURRENT_QUOTE_REQUEST_TIMEOUT_MS = 8_000;
const FRESH_CRYPTO_QUOTE_AGE_MS = 5 * 60_000;
const MAX_CRYPTO_QUOTE_AGE_MS = 15 * 60_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 5 * 60_000;

export interface CurrentPriceSnapshot {
  price: number;
  /** Expiry in Unix milliseconds when the source can prove the remaining freshness. */
  freshUntil?: number;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  displayName?: string;
  instrumentType?: string | null;
  verified?: boolean;
  divergence?: number;
  source: string;
  currency: QuoteCurrency;
  dataStatus: ResultStatus;
  changePeriod: '24h' | 'session' | 'unavailable';
  fields: QuoteSnapshot;
  dataMode?: 'personal_provider' | 'cached_personal' | 'official_open_data' | 'public_market_api' | 'demo_snapshot';
  priceTiming?: 'end_of_day' | 'delayed' | 'realtime' | 'unknown';
  realtime?: boolean;
}

export interface CurrentQuoteIssue {
  symbol: string;
  code: 'provider_unavailable' | 'rate_limited' | 'fx_unavailable';
}

export interface CurrentQuoteResult {
  status: ResultStatus;
  prices: Record<string, CurrentPriceSnapshot>;
  issues: CurrentQuoteIssue[];
  verificationLogs: string[];
}

interface InternalSnapshot extends CurrentPriceSnapshot {
  sourceSymbol?: string;
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

function finiteMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function outputCurrency(currency: QuoteCurrency): CurrencyCode {
  return currency.toUpperCase() as CurrencyCode;
}

function sourceProvenance(
  providerId: string,
  providerName: string,
  retrievedAt: string,
): FieldProvenance {
  return { providerId, providerName, retrievedAt };
}

function numericField(
  value: number | null | undefined,
  provenance: FieldProvenance,
  options: {
    quality?: 'observed' | 'reported' | 'calculated';
    freshness?: 'fresh' | 'stale' | 'unknown';
    observedAt?: string | null;
    asOf?: string | null;
    reason?: 'not_provided' | 'fx_unavailable';
    method?: string;
    derivedFrom?: FieldProvenance[];
  } = {},
): DataField<number> {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return unavailableField(options.reason ?? 'not_provided');
  }
  return availableField(value, {
    quality: options.quality ?? 'reported',
    freshness: options.freshness ?? 'unknown',
    observedAt: options.observedAt ?? null,
    asOf: options.asOf ?? null,
    provenance: {
      ...provenance,
      ...(options.method ? { method: options.method } : {}),
      ...(options.derivedFrom
        ? { derivedFrom: options.derivedFrom.map((source) => ({ ...source })) }
        : {}),
    },
    limitations: ['single_source'],
  });
}

function moneyField(
  value: number | null | undefined,
  currency: CurrencyCode,
  provenance: FieldProvenance,
  options: Parameters<typeof numericField>[2] = {},
): DataField<Money> {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return unavailableField(options.reason ?? 'not_provided');
  }
  return availableField(createMoney(value, currency), {
    quality: options.quality ?? 'reported',
    freshness: options.freshness ?? 'unknown',
    observedAt: options.observedAt ?? null,
    asOf: options.asOf ?? null,
    provenance: {
      ...provenance,
      ...(options.method ? { method: options.method } : {}),
      ...(options.derivedFrom
        ? { derivedFrom: options.derivedFrom.map((source) => ({ ...source })) }
        : {}),
    },
    limitations: ['single_source'],
  });
}

function buildQuoteSnapshot(input: {
  assetId: string;
  listingCurrency: CurrencyCode | null;
  outputCurrency: CurrencyCode;
  price: DataField<Money>;
  previousClose?: DataField<Money>;
  changePercent?: DataField<number>;
  volume?: DataField<number>;
  marketCap?: DataField<Money>;
  yearHigh?: DataField<Money>;
  yearLow?: DataField<Money>;
}): QuoteSnapshot {
  return {
    assetId: input.assetId,
    listingCurrency: input.listingCurrency,
    outputCurrency: input.outputCurrency,
    price: input.price,
    previousClose: input.previousClose ?? unavailableField('not_provided'),
    changePercent: input.changePercent ?? unavailableField('not_provided'),
    volume: input.volume ?? unavailableField('not_provided'),
    marketCap: input.marketCap ?? unavailableField('not_provided'),
    yearHigh: input.yearHigh ?? unavailableField('not_provided'),
    yearLow: input.yearLow ?? unavailableField('not_provided'),
  };
}

function resultStatus(fields: QuoteSnapshot): ResultStatus {
  return deriveResultStatus([
    fields.price,
    fields.previousClose,
    fields.changePercent,
    fields.volume,
    fields.marketCap,
    fields.yearHigh,
    fields.yearLow,
  ]);
}

function buildCoinGeckoSnapshot(
  asset: AssetConfig,
  data: Record<string, unknown>,
  currency: QuoteCurrency,
  retrievedAt: string,
): InternalSnapshot | null {
  const price = finiteMetric(data[currency]);
  if (price === null || price <= 0) return null;

  const updatedAtSeconds = finiteMetric(data.last_updated_at);
  const retrievedAtMs = Date.parse(retrievedAt);
  if (
    updatedAtSeconds === null
    || !Number.isSafeInteger(updatedAtSeconds)
    || !Number.isFinite(retrievedAtMs)
  ) {
    return null;
  }
  const observedAtMs = updatedAtSeconds * 1_000;
  const age = retrievedAtMs - observedAtMs;
  if (
    !Number.isSafeInteger(observedAtMs)
    || age < -MAX_PROVIDER_CLOCK_SKEW_MS
    || age > MAX_CRYPTO_QUOTE_AGE_MS
  ) {
    return null;
  }
  const observedAt = new Date(observedAtMs).toISOString();
  const freshness = age <= FRESH_CRYPTO_QUOTE_AGE_MS ? 'fresh' : 'stale';

  const code = outputCurrency(currency);
  const provenance = sourceProvenance(
    'coingecko_public',
    'CoinGecko',
    retrievedAt,
  );
  const change = finiteMetric(data[`${currency}_24h_change`]);
  const volume = finiteMetric(data[`${currency}_24h_vol`]);
  const marketCap = finiteMetric(data[`${currency}_market_cap`]);
  const fields = buildQuoteSnapshot({
    assetId: asset.symbol,
    listingCurrency: null,
    outputCurrency: code,
    price: moneyField(price, code, provenance, {
      freshness,
      observedAt,
      asOf: observedAt,
    }),
    changePercent: numericField(change, provenance, {
      freshness,
      observedAt,
      asOf: observedAt,
    }),
    volume: numericField(volume, provenance, {
      freshness,
      observedAt,
      asOf: observedAt,
    }),
    marketCap: moneyField(marketCap, code, provenance, {
      freshness,
      observedAt,
      asOf: observedAt,
    }),
  });

  return {
    price,
    freshUntil: observedAtMs + FRESH_CRYPTO_QUOTE_AGE_MS,
    change24h: change,
    volume24h: volume,
    marketCap,
    source: 'CoinGecko',
    currency,
    dataStatus: resultStatus(fields),
    changePeriod: '24h',
    fields,
  };
}

async function fetchCryptoSnapshots(
  symbols: string[],
  currency: QuoteCurrency,
  issues: CurrentQuoteIssue[],
  signal: AbortSignal,
): Promise<Record<string, InternalSnapshot>> {
  const cryptoAssets = symbols
    .map((symbol) => getAssetConfig(symbol))
    .filter(
      (asset): asset is AssetConfig =>
        Boolean(asset && asset.assetClass === 'crypto' && asset.coinGeckoId),
    );
  if (cryptoAssets.length === 0) return {};

  const ids = cryptoAssets.map((asset) => asset.coinGeckoId!).join(',');
  try {
    const response = await fetchProvider(
      `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=${currency}&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true&include_last_updated_at=true`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 30 },
        signal,
      },
      CURRENT_PROVIDER_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(String(response.status));

    const data = await response.json() as Record<string, Record<string, unknown>>;
    const retrievedAt = new Date().toISOString();
    const prices: Record<string, InternalSnapshot> = {};
    for (const asset of cryptoAssets) {
      const coinData = data[asset.coinGeckoId!];
      if (!coinData) {
        issues.push({ symbol: asset.symbol, code: 'provider_unavailable' });
        continue;
      }
      const snapshot = buildCoinGeckoSnapshot(
        asset,
        coinData,
        currency,
        retrievedAt,
      );
      if (snapshot) {
        prices[asset.symbol] = snapshot;
      } else {
        issues.push({ symbol: asset.symbol, code: 'provider_unavailable' });
      }
    }
    return prices;
  } catch {
    // The bounded fallback below is intentionally exchange-specific and
    // supplies only the exact USD spot field it can prove.
  }

  if (!isFinancialDataProviderActive('coinbase_public')) {
    for (const asset of cryptoAssets) {
      issues.push({ symbol: asset.symbol, code: 'provider_unavailable' });
    }
    return {};
  }

  let fx: FxObservation | null = null;
  if (currency === 'eur') {
    fx = await fetchEcbCurrentFx('USD', 'EUR', new Date(), signal);
  }

  const prices: Record<string, InternalSnapshot> = {};
  const boundedAssets = cryptoAssets.slice(0, MAX_EXCHANGE_FALLBACKS);
  const attempts = await allSettledWithConcurrency(
    boundedAssets,
    MAX_CONCURRENT_PROVIDER_REQUESTS,
    async (asset) => {
      const response = await fetchProvider(
        `https://api.coinbase.com/v2/prices/${asset.symbol}-USD/spot`,
        { cache: 'no-store', signal },
        CURRENT_PROVIDER_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as {
        data?: { amount?: unknown; base?: unknown; currency?: unknown };
      };
      const parsedPrice = Number(data.data?.amount);
      if (
        data.data?.base !== asset.symbol
        || data.data?.currency !== 'USD'
        || typeof data.data?.amount !== 'string'
        || !/^\d+(?:\.\d+)?$/.test(data.data.amount)
        || !Number.isFinite(parsedPrice)
        || parsedPrice <= 0
      ) {
        throw new Error('invalid response');
      }
      return { asset, price: parsedPrice };
    },
  );

  attempts.forEach((attempt, index) => {
    const asset = boundedAssets[index];
    if (attempt.status === 'rejected') {
      issues.push({ symbol: asset.symbol, code: 'provider_unavailable' });
      return;
    }

    const provenance = sourceProvenance(
      'coinbase_public',
      'Coinbase USD spot',
      new Date().toISOString(),
    );
    const nativeMoney = createMoney(attempt.value.price, 'USD');
    const priceField = currency === 'usd'
      ? moneyField(attempt.value.price, 'USD', provenance, {
          quality: 'observed',
          freshness: 'fresh',
          asOf: provenance.retrievedAt,
        })
      : fx
        ? convertMoneyWithFx(nativeMoney, fx, provenance)
        : unavailableField('fx_unavailable');

    if (priceField.status !== 'available') {
      issues.push({ symbol: asset.symbol, code: 'fx_unavailable' });
      return;
    }
    const fields = buildQuoteSnapshot({
      assetId: asset.symbol,
      listingCurrency: 'USD',
      outputCurrency: outputCurrency(currency),
      price: priceField,
    });
    prices[asset.symbol] = {
      price: priceField.value.amount,
      change24h: null,
      volume24h: null,
      marketCap: null,
      verified: false,
      source: 'Coinbase USD spot',
      currency,
      dataStatus: resultStatus(fields),
      changePeriod: 'unavailable',
      fields,
    };
  });

  for (const asset of cryptoAssets.slice(MAX_EXCHANGE_FALLBACKS)) {
    issues.push({ symbol: asset.symbol, code: 'provider_unavailable' });
  }
  return prices;
}

function yahooMoneyField(
  value: number | null,
  quote: YahooCurrentQuote,
  currency: QuoteCurrency,
): DataField<Money> {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return unavailableField('not_provided');
  }
  const yahooSource = sourceProvenance(
    'yahoo_finance',
    'Yahoo Finance',
    quote.retrievedAt,
  );
  const converted = quote.nativeCurrency !== currency;
  const provenance = converted
    ? {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt: quote.retrievedAt,
        method: 'Yahoo source value multiplied by sourced FX rate',
        derivedFrom: [
          yahooSource,
          {
            providerId: quote.fx.providerId,
            providerName: quote.fx.providerName,
            retrievedAt: quote.retrievedAt,
            ...(quote.fx.method ? { method: quote.fx.method } : {}),
          },
        ],
      }
    : yahooSource;
  return moneyField(value, outputCurrency(currency), provenance, {
    quality: converted ? 'calculated' : 'observed',
    freshness:
      quote.marketFreshness === 'stale' || quote.fx.freshness === 'stale'
        ? 'stale'
        : quote.marketFreshness === 'fresh' && quote.fx.freshness === 'fresh'
          ? 'fresh'
          : 'unknown',
    observedAt: quote.asOf,
    asOf: quote.asOf,
  });
}

function buildYahooSnapshot(
  asset: AssetConfig,
  quote: YahooCurrentQuote,
  currency: QuoteCurrency,
): InternalSnapshot {
  const price = yahooMoneyField(quote.price, quote, currency);
  const previousClose = yahooMoneyField(quote.previousClose, quote, currency);
  const change =
    quote.previousClose !== null && quote.previousClose > 0
      ? ((quote.price - quote.previousClose) / quote.previousClose) * 100
      : null;
  const yahooSource = sourceProvenance(
    'yahoo_finance',
    'Yahoo Finance',
    quote.retrievedAt,
  );
  const fields = buildQuoteSnapshot({
    assetId: asset.symbol,
    listingCurrency: outputCurrency(quote.nativeCurrency),
    outputCurrency: outputCurrency(currency),
    price,
    previousClose,
    changePercent: numericField(change, yahooSource, {
      quality: 'calculated',
      freshness: quote.marketFreshness ?? 'unknown',
      observedAt: quote.asOf,
      asOf: quote.asOf,
      method: 'session price change from current and previous close',
    }),
    volume: numericField(quote.volume, yahooSource, {
      quality: 'observed',
      freshness: quote.marketFreshness ?? 'unknown',
      observedAt: quote.asOf,
      asOf: quote.asOf,
    }),
    marketCap: moneyField(quote.marketCap, outputCurrency(currency), yahooSource),
    yearHigh: yahooMoneyField(quote.fiftyTwoWeekHigh, quote, currency),
    yearLow: yahooMoneyField(quote.fiftyTwoWeekLow, quote, currency),
  });
  return {
    price: quote.price,
    change24h: change,
    volume24h: quote.volume,
    marketCap: quote.marketCap,
    yearHigh: quote.fiftyTwoWeekHigh,
    yearLow: quote.fiftyTwoWeekLow,
    displayName: quote.displayName,
    instrumentType: quote.instrumentType,
    source: 'Yahoo Finance',
    currency,
    dataStatus: resultStatus(fields),
    changePeriod: 'session',
    fields,
    sourceSymbol: quote.sourceSymbol,
  };
}

async function fetchStockSnapshots(
  symbols: string[],
  currency: QuoteCurrency,
  issues: CurrentQuoteIssue[],
  signal: AbortSignal,
): Promise<Record<string, InternalSnapshot>> {
  const assets = symbols
    .map((symbol) => getAssetConfig(symbol))
    .filter(
      (asset): asset is AssetConfig =>
        Boolean(asset && asset.assetClass !== 'crypto' && asset.yahooSymbol),
    );
  const settled = await allSettledWithConcurrency(
    assets,
    MAX_CONCURRENT_PROVIDER_REQUESTS,
    async (asset) => {
      const yahooSymbols = [asset.yahooSymbol!, asset.yahooFallbackSymbol]
        .filter(Boolean) as string[];
      const quote = await fetchYahooCurrentQuote(
        yahooSymbols,
        currency,
        new Date(),
        signal,
      );
      return [asset.symbol, buildYahooSnapshot(asset, quote, currency)] as const;
    },
  );
  const snapshots: Record<string, InternalSnapshot> = {};
  settled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') {
      snapshots[entry.value[0]] = entry.value[1];
    } else {
      issues.push({ symbol: assets[index].symbol, code: 'provider_unavailable' });
    }
  });
  return snapshots;
}

function worstFreshness(
  fields: Array<AvailableDataField<Money>>,
): 'fresh' | 'stale' | 'unknown' {
  if (fields.some((field) => field.freshness === 'stale')) return 'stale';
  if (fields.some((field) => field.freshness === 'unknown')) return 'unknown';
  return 'fresh';
}

async function buildMetalSnapshot(
  symbol: string,
  base: InternalSnapshot | undefined,
  currency: QuoteCurrency,
  verificationLogs: string[],
  signal: AbortSignal,
): Promise<InternalSnapshot | undefined> {
  const config = getAssetConfig(symbol);
  if (!config || config.assetClass !== 'metal') return base;

  const sources = new Map<string, {
    name: string;
    providerId: string;
    price: number;
    field: AvailableDataField<Money>;
  }>();
  if (base?.fields.price.status === 'available') {
    const isFallback = base.sourceSymbol === config.yahooFallbackSymbol;
    const name = isFallback ? 'Yahoo Futures' : 'Yahoo Spot';
    sources.set(`yahoo:${base.sourceSymbol ?? config.yahooSymbol}`, {
      name,
      providerId: 'yahoo_finance',
      price: base.price,
      field: base.fields.price,
    });
  }

  if (
    config.yahooFallbackSymbol
    && base?.sourceSymbol !== config.yahooFallbackSymbol
  ) {
    try {
      const quote = await fetchYahooCurrentQuote(
        config.yahooFallbackSymbol,
        currency,
        new Date(),
        signal,
      );
      const fallback = buildYahooSnapshot(config, quote, currency);
      if (fallback.fields.price.status === 'available') {
        sources.set(`yahoo:${quote.sourceSymbol}`, {
          name: 'Yahoo Futures',
          providerId: 'yahoo_finance',
          price: fallback.price,
          field: fallback.fields.price,
        });
      }
    } catch {
      // An unavailable cross-check must not remove the sourced base quote.
    }
  }

  if (symbol === 'GOLD') {
    const rawBitfinex = await fetchBitfinexPrice('GOLD', signal);
    if (rawBitfinex !== null) {
      const provider = sourceProvenance(
        'bitfinex_public',
        'Bitfinex',
        new Date().toISOString(),
      );
      let field: DataField<Money> = moneyField(
        rawBitfinex,
        'USD',
        provider,
        {
          quality: 'observed',
          freshness: 'fresh',
          asOf: provider.retrievedAt,
        },
      );
      if (currency === 'eur') {
        const fx = await fetchEcbCurrentFx('USD', 'EUR', new Date(), signal);
        field = convertMoneyWithFx(
          createMoney(rawBitfinex, 'USD'),
          fx,
          provider,
        );
      }
      if (field.status === 'available') {
        sources.set('bitfinex:XAUTUSD', {
          name: 'Bitfinex',
          providerId: 'bitfinex_public',
          price: field.value.amount,
          field,
        });
      }
    }
  }

  // One provider must not gain extra consensus weight merely because it
  // exposes multiple instruments (for example Yahoo spot and futures).
  const candidates = [...sources.values()].filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.providerId === candidate.providerId)
        === index,
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      ...(base ?? {
        price: only.price,
        change24h: null,
        volume24h: null,
        marketCap: null,
        currency,
        dataStatus: 'partial' as const,
        changePeriod: 'unavailable' as const,
        fields: buildQuoteSnapshot({
          assetId: symbol,
          listingCurrency: null,
          outputCurrency: outputCurrency(currency),
          price: only.field,
        }),
      }),
      price: only.price,
      source: only.name,
      verified: false,
    };
  }

  candidates.sort((left, right) => left.price - right.price);
  let bestCluster: typeof candidates = [];
  const threshold = 0.035;
  for (const candidate of candidates) {
    const cluster = candidates.filter((other) =>
      Math.abs(candidate.price - other.price)
        / Math.max(candidate.price, other.price) <= threshold,
    );
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }
  if (bestCluster.length < 2) {
    verificationLogs.push(
      `Source conflict for ${symbol}: independent observations exceed the agreement threshold.`,
    );
    return undefined;
  }
  const consensusPrice = bestCluster.reduce(
    (sum, candidate) => sum + candidate.price,
    0,
  ) / bestCluster.length;
  const verified = true;
  const divergence = (
    Math.max(...bestCluster.map((source) => source.price))
    - Math.min(...bestCluster.map((source) => source.price))
  ) / consensusPrice * 100;
  const outliers = candidates.filter((candidate) => !bestCluster.includes(candidate));
  if (outliers.length > 0) {
    verificationLogs.push(
      `Outliers for ${symbol}: ${outliers.map((source) => source.name).join(', ')}.`,
    );
  }

  const consensusField = availableField(
    createMoney(consensusPrice, outputCurrency(currency)),
    {
      quality: 'calculated',
      freshness: worstFreshness(bestCluster.map((source) => source.field)),
      observedAt: null,
      asOf: null,
      provenance: {
        providerId: 'investatlas_consensus',
        providerName: 'InvestAtlas',
        retrievedAt: new Date().toISOString(),
        method: 'arithmetic mean of sources within 3.5% agreement cluster',
        derivedFrom: bestCluster.map((source) => ({
          ...source.field.provenance,
        })),
      },
    },
  );
  const fields = {
    ...(base?.fields ?? buildQuoteSnapshot({
      assetId: symbol,
      listingCurrency: null,
      outputCurrency: outputCurrency(currency),
      price: consensusField,
    })),
    price: consensusField,
    previousClose: unavailableField('source_conflict'),
    changePercent: unavailableField('source_conflict'),
  };
  return {
    ...(base ?? {
      change24h: null,
      volume24h: null,
      marketCap: null,
      currency,
      changePeriod: 'unavailable' as const,
    }),
    price: consensusPrice,
    change24h: null,
    changePeriod: 'unavailable',
    source: bestCluster.map((source) => source.name).join(' + '),
    verified,
    divergence,
    fields,
    dataStatus: resultStatus(fields),
  };
}

export async function getCurrentQuotes(
  symbols: string[],
  currency: QuoteCurrency,
  parentSignal?: AbortSignal,
): Promise<CurrentQuoteResult> {
  const issues: CurrentQuoteIssue[] = [];
  const verificationLogs: string[] = [];
  const timeoutSignal = AbortSignal.timeout(CURRENT_QUOTE_REQUEST_TIMEOUT_MS);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  const [crypto, stocks] = await Promise.all([
    fetchCryptoSnapshots(symbols, currency, issues, signal),
    fetchStockSnapshots(symbols, currency, issues, signal),
  ]);
  const prices: Record<string, InternalSnapshot> = { ...crypto };

  for (const symbol of symbols) {
    const config = getAssetConfig(symbol);
    if (!config || config.assetClass === 'crypto') continue;
    if (config.assetClass === 'metal') {
      const metal = await buildMetalSnapshot(
        symbol,
        stocks[symbol],
        currency,
        verificationLogs,
        signal,
      );
      if (metal) prices[symbol] = metal;
    } else if (stocks[symbol]) {
      prices[symbol] = stocks[symbol];
    }
  }

  const requested = symbols.filter((symbol) => Boolean(getAssetConfig(symbol)));
  const availableCount = requested.filter((symbol) => prices[symbol]).length;
  const hasPartialSnapshot = requested.some(
    (symbol) => prices[symbol]?.dataStatus !== 'complete',
  );
  const status: ResultStatus = availableCount === 0
    ? 'unavailable'
    : availableCount === requested.length
        && issues.length === 0
        && !hasPartialSnapshot
      ? 'complete'
      : 'partial';

  return {
    status,
    prices,
    issues: issues.filter(
      (issue, index, all) =>
        all.findIndex((candidate) =>
          candidate.symbol === issue.symbol && candidate.code === issue.code
        ) === index,
    ),
    verificationLogs,
  };
}
