/**
 * Supported Coins Configuration
 *
 * This list defines assets that InvestAtlas can track in coin selectors. It is
 * not a Shariah decision or evidence source. Compliance is evaluated separately
 * and may be compliant, non-compliant, review-required, or insufficient-data.
 */

export interface CoinConfig {
  symbol: string;
  name: string;
}

/**
 * Coins available in Strategy Lab, Charts, AI Analysis, etc.
 * Ordered by market cap / relevance.
 */
export const SUPPORTED_COINS: CoinConfig[] = [
  { symbol: 'BTC',    name: 'Bitcoin' },
  { symbol: 'ETH',    name: 'Ethereum' },
  { symbol: 'SOL',    name: 'Solana' },
  { symbol: 'XRP',    name: 'Ripple' },
  { symbol: 'ADA',    name: 'Cardano' },
  { symbol: 'DOT',    name: 'Polkadot' },
  { symbol: 'LINK',   name: 'Chainlink' },
  { symbol: 'AVAX',   name: 'Avalanche' },
  { symbol: 'MATIC',  name: 'Polygon' },
  { symbol: 'ATOM',   name: 'Cosmos' },
  { symbol: 'NEAR',   name: 'NEAR Protocol' },
  { symbol: 'SUI',    name: 'Sui' },
  { symbol: 'INJ',    name: 'Injective' },
  { symbol: 'RENDER', name: 'Render' },
  { symbol: 'FET',    name: 'Fetch.ai' },
  { symbol: 'TAO',    name: 'Bittensor' },
  { symbol: 'ARB',    name: 'Arbitrum' },
  { symbol: 'OP',     name: 'Optimism' },
  { symbol: 'TIA',    name: 'Celestia' },
  { symbol: 'SEI',    name: 'Sei' },
  { symbol: 'APT',    name: 'Aptos' },
  { symbol: 'ICP',    name: 'Internet Computer' },
  { symbol: 'FIL',    name: 'Filecoin' },
  { symbol: 'LTC',    name: 'Litecoin' },
  { symbol: 'IMX',    name: 'Immutable X' },
  { symbol: 'XLM',    name: 'Stellar' },
  { symbol: 'HBAR',   name: 'Hedera' },
];

/** Just the symbols, for quick usage */
export const SUPPORTED_SYMBOLS = SUPPORTED_COINS.map(c => c.symbol);
