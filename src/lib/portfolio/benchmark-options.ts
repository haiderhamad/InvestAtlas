export interface BenchmarkOption {
  id: string;
  label: string;
  type: 'asset' | 'index';
  assetSymbol?: string;
  yahooSymbol?: string;
}

export const BENCHMARK_OPTIONS: BenchmarkOption[] = [
  { id: 'iswd', label: 'ISWD Islamic World ETF', type: 'index', yahooSymbol: 'IUSD.DE' },
  { id: 'btc', label: 'Bitcoin', type: 'asset', assetSymbol: 'BTC' },
  { id: 'gold', label: 'Gold', type: 'asset', assetSymbol: 'GOLD' },
  { id: 'sp500', label: 'S&P 500 Index', type: 'index', yahooSymbol: '^GSPC' },
  { id: 'nasdaq100', label: 'NASDAQ 100 Index', type: 'index', yahooSymbol: '^NDX' },
  { id: 'dax', label: 'DAX Index', type: 'index', yahooSymbol: '^GDAXI' },
];
