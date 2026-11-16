import { HistoricalProvider, getHistoricalProviders } from './historical-providers';
import { normalizeHistoryRequest } from './history-request';
import { fetchProvider } from './provider-fetch';
import { symbolToCoinGeckoId } from '@/lib/prices/coingecko';
import { getAssetConfig, type QuoteCurrency } from '@/lib/config/supported-assets';
import {
  fetchYahooHistoricalBars,
  type YahooFxMetadata,
} from '@/lib/prices/yahoo';
import type {
  CurrencyCode,
  ResultCache,
} from '@/lib/financial-data/contracts';
import { evaluateHistoryRecency } from '@/lib/financial-data/history/recency';

/**
 * A sourced historical data point that passed local structural validation.
 */
export interface ValidatedOHLC {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quality?: 'ohlc' | 'close_only';
  providerId?: string;
  providerName?: string;
  sourceCurrency?: CurrencyCode;
  currency?: CurrencyCode;
  fx?: YahooFxMetadata;
  volumeAvailable?: boolean;
  retrievedAt?: string;
}

/**
 * Describes a contiguous segment of data and its source provenance.
 */
export interface DataSegment {
  startDate: string;
  endDate: string;
  providerId: string;
  providerName: string;
  role: string;
  dataPoints: number;
  status: 'structurally_valid' | 'partial' | 'conflict' | 'gap';
  retrievedAt?: string;
}

export interface ConsolidatedHistory {
  symbol: string;
  prices: ValidatedOHLC[];
  provenance: DataSegment[];
  isComplete: boolean;
  freshness?: 'fresh' | 'stale';
  latestObservationAt?: string | null;
  warnings: string[];
  cache?: ResultCache;
}

interface HistoryCacheEntry {
  cachedAt: number;
  history: ConsolidatedHistory;
}

const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_CACHE_STALE_ON_ERROR_MS = 24 * 60 * 60 * 1000;
const HISTORY_REQUEST_TIMEOUT_MS = 10_000;
const MAX_BINANCE_ROWS_PER_RESPONSE = 1_000;
const MAX_KRAKEN_ROWS_PER_RESPONSE = 1_000;
const MAX_COINBASE_ROWS_PER_RESPONSE = 500;
const MAX_COINGECKO_ROWS_PER_RESPONSE = 2_000;
const MIN_DAILY_POINTS_FOR_COMPLETE_HISTORY = 800;
const MAX_PROVIDER_CLOCK_SKEW_MS = 2 * 86_400_000;
const historyCache = new Map<string, HistoryCacheEntry>();
const historyInflight = new Map<string, Promise<ConsolidatedHistory>>();

async function awaitHistoryWithCallerSignal(
  request: Promise<ConsolidatedHistory>,
  signal?: AbortSignal,
): Promise<ConsolidatedHistory> {
  if (!signal) return request;
  if (signal.aborted) {
    throw new Error('Historical market data unavailable');
  }

  return new Promise<ConsolidatedHistory>((resolve, reject) => {
    const onAbort = () => reject(new Error('Historical market data unavailable'));
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function parseProviderNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Number.NaN;
  }
  return Number(value);
}

function formatProviderTimestamp(
  value: unknown,
  multiplier: 1 | 1_000,
  dateOnly: boolean,
): string {
  const numericValue = parseProviderNumber(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '';

  const date = new Date(numericValue * multiplier);
  if (!Number.isFinite(date.getTime())) return '';
  const iso = date.toISOString();
  return dateOnly ? iso.split('T')[0] : iso;
}

function isBoundedRows(
  value: unknown,
  maximum: number,
): value is unknown[] {
  return Array.isArray(value) && value.length <= maximum;
}

function parseValidatedProviderDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null;

  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp)
    || timestamp > Date.now() + MAX_PROVIDER_CLOCK_SKEW_MS
  ) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(timestamp).toISOString().slice(0, 10) === value
      ? timestamp
      : null;
  }

  return new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function cloneHistory(history: ConsolidatedHistory): ConsolidatedHistory {
  return {
    ...history,
    prices: history.prices.map((price) => ({ ...price })),
    provenance: history.provenance.map((segment) => ({ ...segment })),
    warnings: [...history.warnings],
    cache: history.cache ? { ...history.cache } : undefined,
  };
}

function providerSupportsRequest(
  provider: HistoricalProvider,
  assetClass: string,
  interval: string,
): boolean {
  if (interval !== '1d') {
    return assetClass === 'crypto' && provider.id === 'binance_public';
  }
  if (assetClass === 'crypto') return true;
  return provider.id === 'yahoo_finance';
}

const KRAKEN_BASE_SYMBOLS: Record<string, string> = {
  BTC: 'XBT',
  DOGE: 'XDG',
};

function getKrakenPairCandidates(symbol: string, quote: QuoteCurrency): string[] {
  const base = KRAKEN_BASE_SYMBOLS[symbol.toUpperCase()] || symbol.toUpperCase();
  const quoteSymbol = quote.toUpperCase();
  const prefixedBase = base === 'XBT' ? 'XXBT' : base;
  const prefixedQuote = quoteSymbol === 'EUR' ? 'ZEUR' : quoteSymbol === 'USD' ? 'ZUSD' : quoteSymbol;

  return Array.from(new Set([
    `${base}${quoteSymbol}`,
    `${prefixedBase}${prefixedQuote}`,
  ]));
}

export function getCoinbaseProductCandidates(
  symbol: string,
  quote: QuoteCurrency,
): string[] {
  const base = symbol.toUpperCase();
  const quoteSymbol = quote.toUpperCase();
  return [`${base}-${quoteSymbol}`];
}

function mergeMissingBars(existing: ValidatedOHLC[], incoming: ValidatedOHLC[]): ValidatedOHLC[] {
  const seenDates = new Set(existing.map((bar) => bar.date));
  return incoming.filter((bar) => {
    if (seenDates.has(bar.date)) return false;
    seenDates.add(bar.date);
    return true;
  });
}

/**
 * Strict validator for OHLC data.
 */
export function validateOHLCData(data: ValidatedOHLC[]): { valid: ValidatedOHLC[], warnings: string[] } {
  const valid: ValidatedOHLC[] = [];
  const warnings: string[] = [];
  const seenDates = new Set<string>();

  for (const d of data) {
    const warningDate =
      typeof d.date === 'string' && d.date.length <= 32
        ? d.date
        : 'unknown';
    const timestamp = parseValidatedProviderDate(d.date);
    const hasValidNumbers =
      Number.isFinite(d.open)
      && Number.isFinite(d.high)
      && Number.isFinite(d.low)
      && Number.isFinite(d.close)
      && Number.isFinite(d.volume);
    const hasValidRanges =
      d.open > 0
      && d.high > 0
      && d.low > 0
      && d.close > 0
      && d.volume >= 0;
    const hasKnownQuality =
      d.quality === undefined
      || d.quality === 'ohlc'
      || d.quality === 'close_only';

    if (
      timestamp === null
      || !hasValidNumbers
      || !hasValidRanges
      || !hasKnownQuality
    ) {
      warnings.push(`Skipped invalid row for date: ${warningDate}`);
      continue;
    }
    if (seenDates.has(d.date)) {
      warnings.push(`Skipped duplicate date: ${d.date}`);
      continue;
    }

    const isConsistentCloseOnly =
      d.quality !== 'close_only'
      || (
        d.open === d.close
        && d.high === d.close
        && d.low === d.close
      );
    const isConsistentOHLC =
      d.quality === 'close_only'
      || (
        d.high >= d.low
        && d.high >= d.open
        && d.high >= d.close
        && d.low <= d.open
        && d.low <= d.close
      );

    if (!isConsistentCloseOnly || !isConsistentOHLC) {
      warnings.push(
        `Skipped inconsistent OHLC row for date: ${warningDate}`,
      );
      continue;
    }

    seenDates.add(d.date);
    valid.push({ ...d });
  }

  // Sort strictly ascending
  valid.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return { valid, warnings };
}

function hasAtLeastFourYearsOfCoverage(prices: ValidatedOHLC[]): boolean {
  if (prices.length < MIN_DAILY_POINTS_FOR_COMPLETE_HISTORY) return false;

  const timestamps = prices
    .map((price) => Date.parse(price.date))
    .filter(Number.isFinite);
  if (timestamps.length < 2) return false;

  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const fourYearsBeforeLatest = new Date(latest);
  fourYearsBeforeLatest.setUTCFullYear(
    fourYearsBeforeLatest.getUTCFullYear() - 4,
  );

  return earliest <= fourYearsBeforeLatest.getTime();
}

/**
 * Fetches real historical data from the specified provider.
 * currency: 'eur' (default) or 'usd'
 */
async function fetchFromProvider(
  provider: HistoricalProvider,
  symbol: string,
  currency = 'eur',
  lastDate?: string,
  interval = '1d',
  signal?: AbortSignal,
): Promise<ValidatedOHLC[]> {
  const data: ValidatedOHLC[] = [];
  const asset = getAssetConfig(symbol);
  const assetClass = asset?.assetClass ?? 'crypto';
  const targetCurrency = (currency.toLowerCase() === 'usd' ? 'usd' : 'eur') as QuoteCurrency;

  try {
    switch (provider.id) {
      case 'binance_public': {
        if (assetClass !== 'crypto') {
          return [];
        }

        // USDT is not USD. Without a sourced stablecoin FX conversion, using
        // Binance's USDT pair would silently mislabel the quote currency.
        if (targetCurrency !== 'eur') return [];
        const binanceSymbol = `${symbol}EUR`;
        
        if (interval !== '1d') {
           // For minute intervals (1m, 5m, 15m), fetch 5000 candles backward to get a good scalping window
           // Try primary pair first, fallback to USDT if EUR pair doesn't exist
           const pairSymbol = binanceSymbol;
           const testUrl = `https://api.binance.com/api/v3/klines?symbol=${pairSymbol}&interval=${interval}&limit=1`;
           const testRes = await fetchProvider(testUrl, { signal });
           await testRes.body?.cancel().catch(() => undefined);
           if (!testRes.ok) {
             throw new Error('Provider pair unavailable');
           }

           let endTime = Date.now();
           for (let i = 0; i < 5; i++) {
             const url = `https://api.binance.com/api/v3/klines?symbol=${pairSymbol}&interval=${interval}&limit=1000&endTime=${endTime}`;
             const res = await fetchProvider(url, { signal });
             if (!res.ok) break;
             const klines = await res.json() as unknown;
             if (
               !isBoundedRows(klines, MAX_BINANCE_ROWS_PER_RESPONSE)
               || klines.length === 0
             ) {
               break;
             }

             let earliestOpenTime = Number.POSITIVE_INFINITY;
             for (const k of klines) {
               if (!Array.isArray(k)) continue;
               const openTime = parseProviderNumber(k[0]);
               if (Number.isFinite(openTime) && openTime > 0) {
                 earliestOpenTime = Math.min(earliestOpenTime, openTime);
               }
               data.push({
                 date: formatProviderTimestamp(k[0], 1, false),
                 open: parseProviderNumber(k[1]),
                 high: parseProviderNumber(k[2]),
                 low: parseProviderNumber(k[3]),
                 close: parseProviderNumber(k[4]),
                 volume: parseProviderNumber(k[5]),
               });
             }
             if (!Number.isFinite(earliestOpenTime)) break;
             endTime = earliestOpenTime - 1;
           }
           // Sort ascendingly since we fetched backward in chunks
           data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
           return data;
        }

        let url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&limit=1000`;
        if (lastDate) {
          const startMs = new Date(lastDate).getTime() + 86400000; // start 1 day after last known
          url += `&startTime=${startMs}`;
        }
        
        const res = await fetchProvider(url, { signal });
        if (!res.ok) {
           throw new Error('Provider response unavailable');
        }
        const klines = await res.json() as unknown;
        if (!isBoundedRows(klines, MAX_BINANCE_ROWS_PER_RESPONSE)) {
          throw new Error('Invalid provider response');
        }
        for (const k of klines) {
          if (!Array.isArray(k)) continue;
          data.push({
            date: formatProviderTimestamp(k[0], 1, true),
            open: parseProviderNumber(k[1]),
            high: parseProviderNumber(k[2]),
            low: parseProviderNumber(k[3]),
            close: parseProviderNumber(k[4]),
            volume: parseProviderNumber(k[5]),
          });
        }
        return data;
      }

      case 'kraken_public': {
        if (assetClass !== 'crypto' || interval !== '1d') {
          return [];
        }

        const since = lastDate
          ? `&since=${Math.floor((new Date(lastDate).getTime() + 86400000) / 1000)}`
          : '';

        for (const pair of getKrakenPairCandidates(symbol, targetCurrency)) {
          const res = await fetchProvider(
            `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440${since}`,
            { signal },
          );
          if (!res.ok) continue;

          const json = await res.json() as {
            error?: string[];
            result?: Record<string, Array<[number, string, string, string, string, string, string, number]> | string>;
          };

          if (json.error?.length) continue;
          const resultKey = Object.keys(json.result || {}).find((key) => key !== 'last');
          const rows = resultKey ? json.result?.[resultKey] : undefined;
          if (!isBoundedRows(rows, MAX_KRAKEN_ROWS_PER_RESPONSE)) {
            throw new Error('Invalid provider response');
          }

          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            data.push({
              date: formatProviderTimestamp(row[0], 1_000, true),
              open: parseProviderNumber(row[1]),
              high: parseProviderNumber(row[2]),
              low: parseProviderNumber(row[3]),
              close: parseProviderNumber(row[4]),
              volume: parseProviderNumber(row[6]),
            });
          }

          return data;
        }
        throw new Error('Provider pair unavailable');
      }

      case 'coinbase_public': {
        if (assetClass !== 'crypto' || interval !== '1d') {
          return [];
        }

        const now = new Date();
        const start = lastDate
          ? new Date(new Date(lastDate).getTime() + 86400000)
          : new Date(now.getTime() - 299 * 86400000);
        const query = `granularity=86400&start=${start.toISOString()}&end=${now.toISOString()}`;

        for (const productId of getCoinbaseProductCandidates(symbol, targetCurrency)) {
          const res = await fetchProvider(
            `https://api.exchange.coinbase.com/products/${productId}/candles?${query}`,
            { signal },
          );
          if (!res.ok) continue;

          const rows = await res.json() as unknown;
          if (!isBoundedRows(rows, MAX_COINBASE_ROWS_PER_RESPONSE)) {
            throw new Error('Invalid provider response');
          }
          if (rows.length === 0) {
            return [];
          }

          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            data.push({
              date: formatProviderTimestamp(row[0], 1_000, true),
              low: parseProviderNumber(row[1]),
              high: parseProviderNumber(row[2]),
              open: parseProviderNumber(row[3]),
              close: parseProviderNumber(row[4]),
              volume: parseProviderNumber(row[5]),
            });
          }

          return data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        }
        throw new Error('Provider pair unavailable');
      }

      case 'yahoo_finance': {
        const yahooSymbols = assetClass === 'crypto'
          ? [`${symbol}-${targetCurrency.toUpperCase()}`]
          : [asset?.yahooSymbol || symbol, asset?.yahooFallbackSymbol].filter(Boolean) as string[];
        const result = await fetchYahooHistoricalBars(
          yahooSymbols,
          targetCurrency,
          lastDate,
          signal,
        );
        for (const bar of result.bars) {
          data.push({
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            sourceCurrency: bar.sourceCurrency,
            currency: bar.currency,
            fx: bar.fx,
            volumeAvailable: bar.volumeAvailable,
            retrievedAt: bar.retrievedAt,
          });
        }
        return data;
      }

      case 'coingecko_public': {
        if (assetClass !== 'crypto') {
          return [];
        }

        // CoinGecko: /coins/{id}/market_chart
        // We need the CG ID for the symbol (e.g. 'btc' -> 'bitcoin', 'ada' -> 'cardano').
        // This is a naive mapping. A production app would query the coin list first or map known symbols.
        const cgId = symbolToCoinGeckoId(symbol) || symbol.toLowerCase();
        
        // Coingecko returns { prices: [[ts, price]], total_volumes: [[ts, vol]] }
        const res = await fetchProvider(
          `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=${currency}&days=365`,
          { signal },
        );
        if (!res.ok) {
           throw new Error('Provider response unavailable');
        }
        const json = await res.json() as {
          prices?: unknown;
          total_volumes?: unknown;
        };
        if (
          !isBoundedRows(json.prices, MAX_COINGECKO_ROWS_PER_RESPONSE)
          || (
            json.total_volumes !== undefined
            && !isBoundedRows(
              json.total_volumes,
              MAX_COINGECKO_ROWS_PER_RESPONSE,
            )
          )
        ) {
          throw new Error('Invalid provider response');
        }

        const volumesByTimestamp = new Map<number, number>();
        for (const volumeRow of json.total_volumes ?? []) {
          if (!Array.isArray(volumeRow)) continue;
          const timestamp = parseProviderNumber(volumeRow[0]);
          const volume = parseProviderNumber(volumeRow[1]);
          if (
            Number.isFinite(timestamp)
            && timestamp > 0
            && Number.isFinite(volume)
            && volume >= 0
          ) {
            volumesByTimestamp.set(timestamp, volume);
          }
        }
        
        // market_chart returns real close-like price snapshots, not OHLC
        // candles. Keep the internal shape compatible for close-only charts,
        // but tag the unavailable dimensions so API consumers never receive
        // the placeholders as sourced open/high/low values.
        for (const priceRow of json.prices) {
          if (!Array.isArray(priceRow)) continue;
          const ts = parseProviderNumber(priceRow[0]);
          const price = parseProviderNumber(priceRow[1]);
          const vol = volumesByTimestamp.get(ts) ?? 0;
          
          data.push({
            date: formatProviderTimestamp(ts, 1, true),
            open: price,
            high: price,
            low: price,
            close: price,
            volume: vol,
            quality: 'close_only',
            volumeAvailable: volumesByTimestamp.has(ts),
          });
        }
        return data;
      }

      default:
        // Manual CSV Fallback handling would happen here (reading from local DB/Storage instead of API)
        if (provider.type === 'manual') {
            return []; // Placeholder for actual CSV reading logic
        }
        return [];
    }
  } catch (error: unknown) {
    // Provider payloads and URLs can contain sensitive upstream details. Keep
    // logs and returned diagnostics bounded to an application-owned message.
    if (!signal?.aborted) {
      console.error(`Provider request failed: ${provider.id}`);
    }
    void error;
    throw new Error('Provider request failed');
  }
}

async function refreshConsolidatedHistory(
  normalized: ReturnType<typeof normalizeHistoryRequest>,
  cacheKey: string,
  cacheEntry: HistoryCacheEntry | undefined,
  signal: AbortSignal,
): Promise<ConsolidatedHistory> {
  if (signal.aborted) {
    throw new Error('Historical market data unavailable');
  }
  const normalizedSymbol = normalized.symbol;
  const cur = normalized.currency;
  const normalizedInterval = normalized.interval;
  const providers = await getHistoricalProviders();
  const activeProviders = providers
    .filter((provider) => provider.isActive)
    .sort((left, right) => left.priority - right.priority);

  const cachedHistory = cacheEntry?.history;
  let masterSet: ValidatedOHLC[] = cachedHistory?.prices
    .map((price) => ({ ...price })) ?? [];
  const provenance: DataSegment[] = cachedHistory?.provenance
    .map((segment) => ({ ...segment })) ?? [];
  const allWarnings: string[] = cachedHistory ? [...cachedHistory.warnings] : [];
  const lastDate = masterSet.length > 0
    ? masterSet[masterSet.length - 1].date
    : undefined;

  let providerRefreshSucceeded = false;

  for (const provider of activeProviders) {
    if (signal.aborted) break;
    if (!providerSupportsRequest(
      provider,
      normalized.asset.assetClass,
      normalizedInterval,
    )) continue;
    if (!provider.quoteCurrencies.includes(cur)) continue;
    try {
      const rawData = await fetchFromProvider(
        provider,
        normalizedSymbol,
        cur,
        lastDate,
        normalizedInterval,
        signal,
      );
      const providerRetrievedAt = new Date().toISOString();
      if (rawData.length === 0) {
        providerRefreshSucceeded = true;
        continue;
      }

      const { valid, warnings } = validateOHLCData(rawData);
      warnings.forEach((warning) =>
        allWarnings.push(`[${provider.name}]: ${warning}`)
      );
      if (valid.length === 0) continue;
      providerRefreshSucceeded = true;
      const attributed = valid.map((bar) => ({
        ...bar,
        providerId: provider.id,
        providerName: provider.name,
        currency: bar.currency ?? cur.toUpperCase() as CurrencyCode,
        sourceCurrency:
          bar.sourceCurrency ?? cur.toUpperCase() as CurrencyCode,
        volumeAvailable: bar.volumeAvailable ?? true,
        retrievedAt: bar.retrievedAt ?? providerRetrievedAt,
      }));

      const candidateBars = lastDate
        ? attributed.filter((bar) =>
            new Date(bar.date).getTime() > new Date(lastDate).getTime()
          )
        : attributed;
      const newValid = mergeMissingBars(masterSet, candidateBars);
      if (newValid.length === 0) continue;

      const containsCloseOnly =
        provider.dataShape === 'close_only'
        || newValid.some((bar) => bar.quality === 'close_only');
      masterSet = masterSet.length === 0
        ? newValid
        : [...masterSet, ...newValid];
      if (containsCloseOnly) {
        allWarnings.push(
          `[${provider.name}]: Close-only market snapshots; open, high, and low are unavailable.`,
        );
      }
      provenance.push({
        startDate: newValid[0].date,
        endDate: newValid[newValid.length - 1].date,
        providerId: provider.id,
        providerName: provider.name,
        role: provider.role,
        dataPoints: newValid.length,
        status: containsCloseOnly ? 'partial' : 'structurally_valid',
        retrievedAt: newValid[0].retrievedAt ?? providerRetrievedAt,
      });

      if (lastDate) break;
    } catch {
      if (signal.aborted) break;
      allWarnings.push(`[${provider.name}] failed: Provider request failed`);
    }
  }

  if (signal.aborted) {
    allWarnings.push('Historical provider refresh stopped at the request deadline.');
    if (!cachedHistory && masterSet.length === 0) {
      throw new Error('Historical market data unavailable');
    }
  }

  if (!cachedHistory && masterSet.length > 0) {
    provenance.sort(
      (left, right) =>
        new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
    );
    masterSet.sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime(),
    );
  }
  provenance.sort(
    (left, right) =>
      new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
  );

  const recency = evaluateHistoryRecency(
    masterSet,
    normalizedInterval,
    normalized.asset.assetClass,
  );
  if (masterSet.length > 0 && recency.freshness === 'stale') {
    allWarnings.push(
      'Latest historical observation is stale; current calculations are unavailable.',
    );
  }
  const isComplete =
    normalizedInterval === '1d'
    && hasAtLeastFourYearsOfCoverage(masterSet)
    && recency.freshness === 'fresh';
  const now = Date.now();
  const refreshConfirmedCurrent =
    providerRefreshSucceeded && recency.freshness === 'fresh';
  const staleCacheEntry = cachedHistory && !refreshConfirmedCurrent
    ? cacheEntry
    : undefined;
  const servingStaleCache = staleCacheEntry !== undefined;
  if (staleCacheEntry) {
    if (now - staleCacheEntry.cachedAt > HISTORY_CACHE_STALE_ON_ERROR_MS) {
      throw new Error('Historical market data unavailable');
    }
    allWarnings.push(
      'Cached history is stale because every applicable provider refresh failed.',
    );
  }
  const storedAt = refreshConfirmedCurrent ? now : staleCacheEntry?.cachedAt;
  const result: ConsolidatedHistory = {
    symbol: normalizedSymbol,
    prices: masterSet,
    provenance,
    isComplete,
    freshness:
      servingStaleCache || recency.freshness === 'stale'
        ? 'stale'
        : 'fresh',
    latestObservationAt: recency.latestObservationAt,
    warnings: [...new Set(allWarnings)],
    cache: staleCacheEntry
      ? {
          status: 'hit_stale',
          storedAt: new Date(staleCacheEntry.cachedAt).toISOString(),
          expiresAt: new Date(
            staleCacheEntry.cachedAt + HISTORY_CACHE_TTL_MS,
          ).toISOString(),
          staleUntil: new Date(
            staleCacheEntry.cachedAt + HISTORY_CACHE_STALE_ON_ERROR_MS,
          ).toISOString(),
        }
      : {
          status: 'miss',
          ...(storedAt !== undefined
            ? {
                storedAt: new Date(storedAt).toISOString(),
                expiresAt: new Date(
                  storedAt + HISTORY_CACHE_TTL_MS,
                ).toISOString(),
                staleUntil: new Date(
                  storedAt + HISTORY_CACHE_STALE_ON_ERROR_MS,
                ).toISOString(),
              }
            : {}),
        },
  };

  // A successful provider refresh is meaningful even when a closed market has
  // no newer candle. Renewing the timestamp prevents repeated waterfalls.
  if (refreshConfirmedCurrent) {
    historyCache.set(cacheKey, {
      cachedAt: now,
      history: cloneHistory(result),
    });
  }

  return result;
}

/**
 * The Core Consolidation Engine.
 * Fetches data by priority: Primary -> Secondary -> Fallback.
 * Validates, deduplicates, and resolves overlaps.
 */
export async function buildConsolidatedHistory(
  symbol: string,
  currency = 'eur',
  interval = '1d',
  forceRefresh = false,
  parentSignal?: AbortSignal,
): Promise<ConsolidatedHistory> {
  const normalized = normalizeHistoryRequest(symbol, currency, interval);
  if (parentSignal?.aborted) {
    throw new Error('Historical market data unavailable');
  }
  const signal = AbortSignal.timeout(HISTORY_REQUEST_TIMEOUT_MS);
  const cacheKey = `${normalized.symbol}:${normalized.currency}:${normalized.interval}`;
  const cacheEntry = forceRefresh ? undefined : historyCache.get(cacheKey);

  if (cacheEntry && Date.now() - cacheEntry.cachedAt < HISTORY_CACHE_TTL_MS) {
    const history = cloneHistory(cacheEntry.history);
    history.cache = {
      status: 'hit_fresh',
      storedAt: new Date(cacheEntry.cachedAt).toISOString(),
      expiresAt: new Date(
        cacheEntry.cachedAt + HISTORY_CACHE_TTL_MS,
      ).toISOString(),
      staleUntil: new Date(
        cacheEntry.cachedAt + HISTORY_CACHE_STALE_ON_ERROR_MS,
      ).toISOString(),
    };
    return history;
  }

  const shareInflight = !forceRefresh;
  if (shareInflight) {
    const existing = historyInflight.get(cacheKey);
    if (existing) {
      return cloneHistory(
        await awaitHistoryWithCallerSignal(existing, parentSignal),
      );
    }
  }

  const refresh = refreshConsolidatedHistory(
    normalized,
    cacheKey,
    cacheEntry,
    signal,
  );
  if (shareInflight) {
    historyInflight.set(cacheKey, refresh);
    const cleanup = () => {
      if (historyInflight.get(cacheKey) === refresh) {
        historyInflight.delete(cacheKey);
      }
    };
    refresh.then(cleanup, cleanup);
  }
  return cloneHistory(
    await awaitHistoryWithCallerSignal(refresh, parentSignal),
  );
}
