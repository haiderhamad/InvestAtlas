/**
 * CoinGecko Price Data Service (Free Tier)
 * Fetches and caches historical price data
 */

import { fetchProvider } from '@/lib/data/provider-fetch';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const MAX_COINGECKO_OHLC_ROWS = 2_000;
const MAX_COINGECKO_IDS_PER_REQUEST = 100;

export class CoinGeckoRateLimitError extends Error {
  constructor() {
    super('CoinGecko rate limit reached');
    this.name = 'CoinGeckoRateLimitError';
  }
}

// Map common symbols to CoinGecko IDs
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  SHIB: 'shiba-inu',
  ARB: 'arbitrum',
  OP: 'optimism',
  APT: 'aptos',
  NEAR: 'near',
  FIL: 'filecoin',
  AAVE: 'aave',
  MKR: 'maker',
  CRV: 'curve-dao-token',
  ALGO: 'algorand',
  XLM: 'stellar',
  VET: 'vechain',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer',
  FTM: 'fantom',
  RUNE: 'thorchain',
  EGLD: 'elrond-erd-2',
  THETA: 'theta-token',
  XTZ: 'tezos',
  EOS: 'eos',
  FLOW: 'flow',
  AXS: 'axie-infinity',
  CHZ: 'chiliz',
  ENS: 'ethereum-name-service',
  GALA: 'gala',
  BTT: 'bittorrent',
  PEPE: 'pepe',
  WLD: 'worldcoin-wld',
  IMX: 'immutable-x',
  SUI: 'sui',
  SEI: 'sei-network',
  TIA: 'celestia',
  INJ: 'injective-protocol',
  RENDER: 'render-token',
  FET: 'fetch-ai',
  TAO: 'bittensor',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  GOLD: 'pax-gold',
  SILVER: 'kinesis-silver',
};

export function symbolToCoinGeckoId(symbol: string): string | null {
  return SYMBOL_TO_COINGECKO[symbol.toUpperCase()] || null;
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function requireCoinGeckoIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,100}$/.test(normalized)) {
    throw new Error('Invalid CoinGecko identifier');
  }
  return normalized;
}

function requireCoinGeckoCurrency(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{3,10}$/.test(normalized)) {
    throw new Error('Invalid CoinGecko currency');
  }
  return normalized;
}

function parseCoinGeckoPrice(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    ? value
    : null;
}

/**
 * Fetch historical OHLC data from CoinGecko
 * Free tier: 30 calls/min
 * @param coinId CoinGecko coin ID
 * @param days Number of days of history
 * @param vsCurrency Currency (default: 'eur')
 */
export async function fetchHistoricalPrices(
  coinId: string,
  days: number = 365,
  vsCurrency: string = 'eur'
): Promise<HistoricalPrice[]> {
  const normalizedCoinId = requireCoinGeckoIdentifier(coinId);
  const normalizedCurrency = requireCoinGeckoCurrency(vsCurrency);
  if (!Number.isInteger(days) || days < 1 || days > 3_650) {
    throw new Error('Invalid CoinGecko history range');
  }

  // For > 90 days, CoinGecko returns daily data
  const url =
    `${COINGECKO_API}/coins/${encodeURIComponent(normalizedCoinId)}/ohlc`
    + `?vs_currency=${encodeURIComponent(normalizedCurrency)}&days=${days}`;
  
  const response = await fetchProvider(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 300 },
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      throw new CoinGeckoRateLimitError();
    }
    throw new Error(`CoinGecko API error: ${response.status}`);
  }
  
  const data = await response.json() as unknown;
  if (
    !Array.isArray(data)
    || data.length > MAX_COINGECKO_OHLC_ROWS
  ) {
    throw new Error('Invalid CoinGecko OHLC response');
  }
  
  // OHLC format: [timestamp, open, high, low, close]
  const prices: HistoricalPrice[] = [];
  const seenDates = new Set<string>();
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [timestamp, open, high, low, close] = row;
    const parsedOpen = parseCoinGeckoPrice(open);
    const parsedHigh = parseCoinGeckoPrice(high);
    const parsedLow = parseCoinGeckoPrice(low);
    const parsedClose = parseCoinGeckoPrice(close);
    if (
      typeof timestamp !== 'number'
      || !Number.isFinite(timestamp)
      || timestamp <= 0
      || parsedOpen === null
      || parsedHigh === null
      || parsedLow === null
      || parsedClose === null
      || parsedHigh < parsedLow
      || parsedHigh < parsedOpen
      || parsedHigh < parsedClose
      || parsedLow > parsedOpen
      || parsedLow > parsedClose
    ) {
      continue;
    }

    const dateValue = new Date(timestamp);
    if (!Number.isFinite(dateValue.getTime())) continue;
    const date = dateValue.toISOString().split('T')[0];
    if (seenDates.has(date)) continue;
    seenDates.add(date);
    prices.push({
      date,
      open: parsedOpen,
      high: parsedHigh,
      low: parsedLow,
      close: parsedClose,
      volume: null,
    });
  }
  return prices.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Fetch current price for an asset
 */
export async function fetchCurrentPrice(
  coinId: string,
  vsCurrency: string = 'eur'
): Promise<number> {
  const normalizedCoinId = requireCoinGeckoIdentifier(coinId);
  const normalizedCurrency = requireCoinGeckoCurrency(vsCurrency);
  const url =
    `${COINGECKO_API}/simple/price`
    + `?ids=${encodeURIComponent(normalizedCoinId)}`
    + `&vs_currencies=${encodeURIComponent(normalizedCurrency)}`;
  
  const response = await fetchProvider(url);
  
  if (!response.ok) {
    throw new Error(`CoinGecko price fetch error: ${response.status}`);
  }
  
  const data = await response.json() as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const price = parseCoinGeckoPrice(
    data[normalizedCoinId]?.[normalizedCurrency],
  );
  if (price === null) {
    throw new Error('CoinGecko returned no valid current price');
  }
  return price;
}

/**
 * Fetch current prices for multiple assets
 */
export async function fetchMultiplePrices(
  coinIds: string[],
  vsCurrency: string = 'eur'
): Promise<Record<string, number>> {
  if (
    !Array.isArray(coinIds)
    || coinIds.length < 1
    || coinIds.length > MAX_COINGECKO_IDS_PER_REQUEST
  ) {
    throw new Error('Invalid CoinGecko identifier list');
  }
  const normalizedIds = coinIds.map(requireCoinGeckoIdentifier);
  const normalizedCurrency = requireCoinGeckoCurrency(vsCurrency);
  const ids = normalizedIds.join(',');
  const url =
    `${COINGECKO_API}/simple/price`
    + `?ids=${encodeURIComponent(ids)}`
    + `&vs_currencies=${encodeURIComponent(normalizedCurrency)}`
    + '&include_24hr_change=true';
  
  const response = await fetchProvider(url);
  
  if (!response.ok) {
    throw new Error(`CoinGecko multi-price fetch error: ${response.status}`);
  }
  
  const data = await response.json() as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const prices: Record<string, number> = {};
  
  for (const id of normalizedIds) {
    const price = parseCoinGeckoPrice(data[id]?.[normalizedCurrency]);
    if (price !== null) {
      prices[id] = price;
    }
  }
  
  return prices;
}
