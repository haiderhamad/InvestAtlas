import { isFinancialDataProviderActive } from '@/lib/financial-data/providers/catalog';

export type ProviderRole = 'primary' | 'secondary' | 'fallback';
export type HistoricalDataShape = 'ohlcv' | 'close_only';
export type HistoricalQuoteCurrency = 'eur' | 'usd';

export interface HistoricalProvider {
  id: string;
  name: string;
  type: 'api' | 'manual';
  role: ProviderRole;
  dataShape: HistoricalDataShape;
  quoteCurrencies: HistoricalQuoteCurrency[];
  isActive: boolean;
  priority: number;
  baseUrl?: string; // For custom APIs
  isCustom?: boolean;
  // Meta
  description?: string;
  supportedPairs?: 'all' | string[]; // e.g. "all", or ["BTC", "ETH"]
  maxHistoryYears?: number; // Estimated depth
  requiresKey: boolean;
  website?: string;
}

// Default built-in providers
const DEFAULT_PROVIDERS: HistoricalProvider[] = [
  {
    id: 'binance_public',
    name: 'Binance Public API',
    type: 'api',
    role: 'primary',
    dataShape: 'ohlcv',
    quoteCurrencies: ['eur'],
    isActive: isFinancialDataProviderActive('binance_public'),
    priority: 1,
    requiresKey: false,
    description: 'No-account public OHLCV klines. Best active source for exchange-traded crypto pairs.',
    website: 'https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data'
  },
  {
    id: 'kraken_public',
    name: 'Kraken Public OHLC',
    type: 'api',
    role: 'secondary',
    dataShape: 'ohlcv',
    quoteCurrencies: ['eur', 'usd'],
    isActive: isFinancialDataProviderActive('kraken_public'),
    priority: 2,
    requiresKey: false,
    description: 'Official no-auth REST OHLC data for crypto pairs. Useful as an independent exchange cross-check.',
    website: 'https://docs.kraken.com/api/docs/rest-api/get-ohlc-data/'
  },
  {
    id: 'coinbase_public',
    name: 'Coinbase Exchange Candles',
    type: 'api',
    role: 'secondary',
    dataShape: 'ohlcv',
    quoteCurrencies: ['eur', 'usd'],
    isActive: isFinancialDataProviderActive('coinbase_public'),
    priority: 3,
    requiresKey: false,
    description: 'Official no-auth exchange candles. Limited per request, best for recent history and fallback validation.',
    website: 'https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles'
  },
  {
    id: 'yahoo_finance',
    name: 'Yahoo Finance Chart',
    type: 'api',
    role: 'fallback',
    dataShape: 'ohlcv',
    quoteCurrencies: ['eur', 'usd'],
    isActive: isFinancialDataProviderActive('yahoo_finance'),
    priority: 4,
    requiresKey: false,
    description: 'Pragmatic no-account public chart endpoint for stocks, ETFs, metals, FX, and broad fallback coverage.',
    website: 'https://finance.yahoo.com'
  },
  {
    id: 'coingecko_public',
    name: 'CoinGecko Keyless Public API',
    type: 'api',
    role: 'fallback',
    dataShape: 'close_only',
    quoteCurrencies: ['eur', 'usd'],
    isActive: isFinancialDataProviderActive('coingecko_public'),
    priority: 5,
    requiresKey: false,
    description: 'Keyless public aggregated crypto market data. Strict public rate limits; best behind exchange OHLC sources.',
    website: 'https://www.coingecko.com/en/api'
  }
];

export async function getHistoricalProviders(): Promise<HistoricalProvider[]> {
  return DEFAULT_PROVIDERS.map((provider) => ({
    ...provider,
    quoteCurrencies: [...provider.quoteCurrencies],
    supportedPairs: Array.isArray(provider.supportedPairs)
      ? [...provider.supportedPairs]
      : provider.supportedPairs,
  }));
}
