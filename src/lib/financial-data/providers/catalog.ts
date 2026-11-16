import type { FinancialCapability } from '@/lib/financial-data/contracts';

export type PublicDisplayStatus =
  | 'allowed'
  | 'review_required'
  | 'permission_required';

export type ProviderCostModel = 'free_public' | 'free_tier' | 'byok';

export interface FinancialDataProviderDescriptor {
  id: string;
  name: string;
  capabilities: FinancialCapability[];
  isActive: boolean;
  availability: 'active' | 'local_only' | 'disabled';
  byokOnly: boolean;
  costModel: ProviderCostModel;
  publicDisplayStatus: PublicDisplayStatus;
  redistributionAllowed: boolean | null;
  attributionRequired: boolean;
  termsUrl: string;
  reviewedAt: string;
  description: string;
}

type HostedActivationPolicy = 'active' | 'local_only' | 'disabled';

type ProviderDefinition = Omit<FinancialDataProviderDescriptor, 'isActive' | 'availability'> & {
  activationPolicy: HostedActivationPolicy;
};

export type VercelEnvironment = 'production' | 'preview' | 'development' | undefined;

const REVIEWED_AT = '2026-08-29';

const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'alpha_vantage_browser_byok',
    name: 'Alpha Vantage (personal browser BYOK)',
    capabilities: ['quote', 'history'],
    activationPolicy: 'disabled',
    byokOnly: true,
    costModel: 'byok',
    publicDisplayStatus: 'review_required',
    redistributionAllowed: null,
    attributionRequired: true,
    termsUrl: 'https://www.alphavantage.co/terms_of_service/',
    reviewedAt: REVIEWED_AT,
    description: 'Direct browser BYOK connector for personal use. InvestAtlas does not proxy or store the key. It uses raw, unadjusted daily observations and does not enable public redistribution.',
  },
  {
    id: 'tiingo_browser_byok',
    name: 'Tiingo (personal browser Developer Program)',
    capabilities: ['quote', 'history'],
    activationPolicy: 'active',
    byokOnly: true,
    costModel: 'byok',
    publicDisplayStatus: 'allowed',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://www.tiingo.com/documentation/appendix/developers',
    reviewedAt: '2026-10-25',
    description: 'Personal tab-memory BYOK connector using a fixed same-origin, user-authenticated or localhost-only proxy. The key is sent transiently but never persisted. Raw, unadjusted daily observations; public redistribution is prohibited.'
  },
  {
    id: 'ecb_reference_rates',
    name: 'European Central Bank',
    capabilities: ['fx'],
    activationPolicy: 'active',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'allowed',
    redistributionAllowed: true,
    attributionRequired: true,
    termsUrl: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html',
    reviewedAt: REVIEWED_AT,
    description: 'Official daily EUR reference rates. Informational reference data, not a live transaction rate.',
  },
  {
    id: 'binance_public',
    name: 'Binance Public API',
    capabilities: ['history'],
    activationPolicy: 'local_only',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'review_required',
    redistributionAllowed: null,
    attributionRequired: true,
    termsUrl: 'https://developers.binance.com/en/docs/products/spot/rest-api',
    reviewedAt: REVIEWED_AT,
    description: 'Exchange-specific crypto observations. Public-display rights remain under review.',
  },
  {
    id: 'kraken_public',
    name: 'Kraken Public OHLC',
    capabilities: ['history'],
    activationPolicy: 'disabled',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'permission_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://www.kraken.com/legal',
    reviewedAt: REVIEWED_AT,
    description: 'Exchange-specific crypto observations; third-party display requires permission.',
  },
  {
    id: 'coinbase_public',
    name: 'Coinbase Market Data',
    capabilities: ['quote', 'history'],
    activationPolicy: 'disabled',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'permission_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://www.coinbase.com/legal/market_data',
    reviewedAt: REVIEWED_AT,
    description: 'Exchange-specific observations; external application display requires written permission.',
  },
  {
    id: 'yahoo_finance',
    name: 'Yahoo Finance Chart',
    capabilities: ['quote', 'history'],
    activationPolicy: 'local_only',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'permission_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apitnc/index.html',
    reviewedAt: REVIEWED_AT,
    description: 'Undocumented chart endpoint retained for local development only; automated public use is not approved.',
  },
  {
    id: 'coingecko_public',
    name: 'CoinGecko Public API',
    capabilities: ['quote', 'history'],
    activationPolicy: 'local_only',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'review_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://www.coingecko.com/en/api_terms',
    reviewedAt: REVIEWED_AT,
    description: 'Local development integration with required attribution; hosted access remains disabled because raw proxy and redistribution boundaries are unresolved.',
  },
  {
    id: 'bitfinex_public',
    name: 'Bitfinex Public API',
    capabilities: ['quote'],
    activationPolicy: 'local_only',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'permission_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://www.bitfinex.com/legal/general/market-data/',
    reviewedAt: REVIEWED_AT,
    description: 'Exchange-specific cross-check retained for local development only; public redistribution requires written permission.',
  },
  {
    id: 'sec_edgar',
    name: 'SEC EDGAR',
    capabilities: ['fundamentals', 'events'],
    activationPolicy: 'disabled',
    byokOnly: false,
    costModel: 'free_public',
    publicDisplayStatus: 'allowed',
    redistributionAllowed: true,
    attributionRequired: true,
    termsUrl: 'https://www.sec.gov/about/privacy-information',
    reviewedAt: REVIEWED_AT,
    description: 'Approved future source for US filing facts and filing events; no quote or analyst data.',
  },
  {
    id: 'tiingo_byok',
    name: 'Tiingo (user-owned key)',
    capabilities: ['quote', 'history'],
    activationPolicy: 'local_only',
    byokOnly: true,
    costModel: 'byok',
    publicDisplayStatus: 'permission_required',
    redistributionAllowed: false,
    attributionRequired: true,
    termsUrl: 'https://app.tiingo.com/tos/',
    reviewedAt: '2026-08-11',
    description: 'Implemented for local engineering only. Hosted quote/history display remains disabled pending written permission under current Tiingo terms; raw provider responses are not retained between requests.',
  },
];

function isHostedPublicEnvironment(environment: VercelEnvironment): boolean {
  return environment === 'production' || environment === 'preview';
}

function resolveProviderActivation(
  policy: HostedActivationPolicy,
  environment: VercelEnvironment,
): boolean {
  if (policy === 'disabled') return false;
  if (policy === 'local_only') return !isHostedPublicEnvironment(environment);
  return true;
}

export function getFinancialDataProviders(
  environment = process.env.VERCEL_ENV as VercelEnvironment,
): FinancialDataProviderDescriptor[] {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    capabilities: [...provider.capabilities],
    isActive: resolveProviderActivation(provider.activationPolicy, environment),
    availability: provider.activationPolicy,
    byokOnly: provider.byokOnly,
    costModel: provider.costModel,
    publicDisplayStatus: provider.publicDisplayStatus,
    redistributionAllowed: provider.redistributionAllowed,
    attributionRequired: provider.attributionRequired,
    termsUrl: provider.termsUrl,
    reviewedAt: provider.reviewedAt,
    description: provider.description,
  }));
}

export function isFinancialDataProviderActive(
  id: string,
  environment = process.env.VERCEL_ENV as VercelEnvironment,
): boolean {
  const provider = PROVIDERS.find((candidate) => candidate.id === id);
  return Boolean(
    provider && resolveProviderActivation(provider.activationPolicy, environment),
  );
}

export function hasActivePublicFinancialDataProvider(
  capability: FinancialCapability,
  environment = process.env.VERCEL_ENV as VercelEnvironment,
): boolean {
  return PROVIDERS.some(
    (provider) =>
      !provider.byokOnly
      && provider.capabilities.includes(capability)
      && resolveProviderActivation(provider.activationPolicy, environment),
  );
}
