/**
 * Coins Store
 * Read-only access to the curated demo coin list.
 *
 * Public requests must never mutate process files or generate source code.
 * User-specific asset preferences belong in the isolated local/Firebase stores,
 * not in this application-global configuration.
 */

import { SUPPORTED_COINS, type CoinConfig } from './supported-coins';

export async function getCoins(): Promise<CoinConfig[]> {
  return SUPPORTED_COINS.map((coin) => ({ ...coin }));
}
