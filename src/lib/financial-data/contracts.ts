export type FinancialCapability =
  | 'quote'
  | 'history'
  | 'fx'
  | 'fundamentals'
  | 'earnings'
  | 'news'
  | 'events';

export type ResultStatus = 'complete' | 'partial' | 'unavailable';
export type Freshness = 'fresh' | 'stale' | 'unknown';

export type DataQuality =
  | 'observed'
  | 'reported'
  | 'provider_estimate'
  | 'calculated'
  | 'demo';

export type MissingReason =
  | 'not_provided'
  | 'not_supported'
  | 'invalid_response'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'stale_expired'
  | 'fx_unavailable'
  | 'source_conflict'
  | 'licensing_restricted';

export type ProviderIssueCode =
  | 'timeout'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'authentication_failed'
  | 'upstream_unavailable'
  | 'invalid_response'
  | 'response_too_large'
  | 'not_supported';

export type CurrencyCode = 'EUR' | 'USD';

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export interface QuoteSnapshot {
  assetId: string;
  listingCurrency: CurrencyCode | null;
  outputCurrency: CurrencyCode;
  price: DataField<Money>;
  previousClose: DataField<Money>;
  changePercent: DataField<number>;
  volume: DataField<number>;
  marketCap: DataField<Money>;
  yearHigh: DataField<Money>;
  yearLow: DataField<Money>;
}

export interface QuoteRequest {
  assetIds: string[];
  outputCurrency: CurrencyCode;
}

export interface HistoryRequest {
  assetId: string;
  outputCurrency: CurrencyCode;
  interval: '1d' | '1h' | '15m' | '5m' | '1m';
  startDate?: string;
  endDate?: string;
}

export interface FxRequest {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  asOf?: string;
}

export interface FundamentalsRequest {
  assetId: string;
  period?: 'annual' | 'quarterly' | 'latest';
}

export interface EarningsRequest {
  assetId: string;
  from?: string;
  to?: string;
}

export interface NewsRequest {
  assetIds: string[];
  from?: string;
  limit: number;
}

export interface EventsRequest {
  assetIds: string[];
  from?: string;
  to?: string;
}

export interface HistoryBar {
  periodStart: string;
  periodEnd: string;
  open: DataField<Money>;
  high: DataField<Money>;
  low: DataField<Money>;
  close: DataField<Money>;
  volume: DataField<number>;
}

export interface HistorySeries {
  assetId: string;
  currency: CurrencyCode;
  bars: HistoryBar[];
}

export interface FxSnapshot {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: DataField<number>;
}

export interface FundamentalSnapshot {
  assetId: string;
  periodEnd: string | null;
  filingUrl: string | null;
  metrics: Record<string, DataField<Money | number>>;
}

export interface EarningsSnapshot {
  assetId: string;
  periodEnd: string;
  reportedEps: DataField<Money>;
  expectedEps: DataField<Money>;
  reportedRevenue: DataField<Money>;
  expectedRevenue: DataField<Money>;
}

export interface NewsItem {
  id: string;
  assetIds: string[];
  headline: string;
  url: string;
  publishedAt: string;
  provenance: FieldProvenance;
  summary: DataField<string>;
}

export interface CompanyEvent {
  id: string;
  assetId: string;
  eventType: string;
  occurredAt: string;
  title: string;
  provenance: FieldProvenance;
}

export interface CapabilityRequestMap {
  quote: QuoteRequest;
  history: HistoryRequest;
  fx: FxRequest;
  fundamentals: FundamentalsRequest;
  earnings: EarningsRequest;
  news: NewsRequest;
  events: EventsRequest;
}

export interface CapabilityPayloadMap {
  quote: QuoteSnapshot[];
  history: HistorySeries;
  fx: FxSnapshot;
  fundamentals: FundamentalSnapshot;
  earnings: EarningsSnapshot;
  news: NewsItem[];
  events: CompanyEvent[];
}

export interface ProviderContext {
  signal: AbortSignal;
  deadlineAt: number;
  cacheScope: 'public' | `user:${string}`;
}

export interface ProviderAdapter<C extends FinancialCapability> {
  readonly capability: C;
  readonly provider: {
    id: string;
    name: string;
  };
  supports(request: CapabilityRequestMap[C]): boolean;
  fetch(
    request: CapabilityRequestMap[C],
    context: ProviderContext,
  ): Promise<FinancialResult<CapabilityPayloadMap[C]>>;
}

export interface FieldProvenance {
  providerId: string;
  providerName: string;
  retrievedAt: string | null;
  publicSourceUrl?: string;
  method?: string;
  derivedFrom?: FieldProvenance[];
}

export interface AvailableDataField<T> {
  status: 'available';
  value: T;
  quality: DataQuality;
  freshness: Freshness;
  observedAt: string | null;
  asOf: string | null;
  provenance: FieldProvenance;
  limitations?: Array<
    | 'close_only'
    | 'single_source'
    | 'delayed'
    | 'source_conflict'
    | 'synthetic'
  >;
}

export interface UnavailableDataField {
  status: 'unavailable';
  reason: MissingReason;
}

export type DataField<T> = AvailableDataField<T> | UnavailableDataField;

export interface ProviderIssue {
  providerId: string;
  code: ProviderIssueCode;
  retryAt?: string;
}

export interface ResultCache {
  status: 'miss' | 'hit_fresh' | 'hit_stale';
  storedAt?: string;
  expiresAt?: string;
  staleUntil?: string;
}

export type FinancialResult<T> =
  | {
      status: 'complete' | 'partial';
      data: T;
      generatedAt: string;
      cache: ResultCache;
      issues: ProviderIssue[];
    }
  | {
      status: 'unavailable';
      data: null;
      generatedAt: string;
      cache: ResultCache;
      issues: ProviderIssue[];
    };

interface AvailableFieldOptions {
  quality: DataQuality;
  freshness: Freshness;
  observedAt: string | null;
  asOf: string | null;
  provenance: FieldProvenance;
  limitations?: AvailableDataField<unknown>['limitations'];
}

export function availableField<T>(
  value: T,
  options: AvailableFieldOptions,
): AvailableDataField<T> {
  return {
    status: 'available',
    value,
    quality: options.quality,
    freshness: options.freshness,
    observedAt: options.observedAt,
    asOf: options.asOf,
    provenance: {
      ...options.provenance,
      derivedFrom: options.provenance.derivedFrom?.map((source) => ({
        ...source,
      })),
    },
    ...(options.limitations
      ? { limitations: [...options.limitations] }
      : {}),
  };
}

export function unavailableField(
  reason: MissingReason,
): UnavailableDataField {
  return { status: 'unavailable', reason };
}

export function createMoney(
  amount: number,
  currency: CurrencyCode,
): Money {
  if (!Number.isFinite(amount)) {
    throw new Error('Invalid money amount');
  }
  if (currency !== 'EUR' && currency !== 'USD') {
    throw new Error('Unsupported money currency');
  }
  return { amount, currency };
}

export function deriveResultStatus(
  fields: ReadonlyArray<DataField<unknown>>,
): ResultStatus {
  const available = fields.filter((field) => field.status === 'available');
  if (available.length === 0) return 'unavailable';
  if (
    available.length !== fields.length
    || available.some((field) => field.freshness === 'stale')
  ) {
    return 'partial';
  }
  return 'complete';
}
