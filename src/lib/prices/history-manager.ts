/**
 * Historical Data Manager
 * - No-account public market data only
 * - Delegates history building to the shared multi-source engine
 * - Keeps the older syncCoinHistory/getBacktestData API shape for callers
 */

import { buildConsolidatedHistory, type ConsolidatedHistory, type ValidatedOHLC } from '@/lib/data/historical-engine';

export interface CoinHistoryMetadata {
  symbol: string;
  source: string;
  firstDate: string;
  lastDate: string;
  dataPoints: number;
  isComplete: boolean;
  lastSyncAt: string;
  warnings: string[];
}

export interface CoinHistoryData {
  metadata: CoinHistoryMetadata;
  prices: ValidatedOHLC[];
}

function buildMetadata(symbol: string, history: ConsolidatedHistory): CoinHistoryMetadata {
  const firstPrice = history.prices[0];
  const lastPrice = history.prices[history.prices.length - 1];
  const sourceNames = Array.from(new Set(history.provenance.map((segment) => segment.providerName)));

  return {
    symbol,
    source: sourceNames.length > 0 ? sourceNames.join(', ') : 'none',
    firstDate: firstPrice?.date || '',
    lastDate: lastPrice?.date || '',
    dataPoints: history.prices.length,
    isComplete: history.isComplete,
    lastSyncAt: new Date().toISOString(),
    warnings: history.warnings,
  };
}

export async function syncCoinHistory(
  symbol: string,
  forceFullRefresh: boolean = false,
): Promise<CoinHistoryData> {
  const history = await buildConsolidatedHistory(symbol, 'eur', '1d', forceFullRefresh);

  return {
    metadata: buildMetadata(symbol, history),
    prices: history.prices,
  };
}

export async function getBacktestData(symbol: string): Promise<{
  closes: number[];
  dates: string[];
  metadata: CoinHistoryMetadata;
}> {
  const data = await syncCoinHistory(symbol);
  return {
    closes: data.prices.map((p) => p.close),
    dates: data.prices.map((p) => p.date),
    metadata: data.metadata,
  };
}
