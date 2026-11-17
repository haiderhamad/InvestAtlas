'use client';

import { readWorkspaceStorageItem, writeWorkspaceStorageItem } from '@/lib/storage/workspace-storage';
import { INVESTATLAS_DEPLOYMENT_MODE as mode } from '@/lib/runtime/deployment-mode';

export const SELF_HOSTED_MARKET = mode === 'private_cloud' || mode === 'local_personal';
export const TIINGO_CONNECTABLE = mode !== 'public_demo' && (mode === 'local_personal' || process.env.NEXT_PUBLIC_INVESTATLAS_TIINGO_AVAILABLE === 'true' || process.env.NODE_ENV === 'development');
export type MarketSource = 'yahoo' | 'spot' | 'coinpaprika' | 'coingecko' | 'binance' | 'kraken' | 'bullion' | 'twelve_demo' | 'tiingo' | 'twelve' | 'marketdata' | 'eodhd';
export type SourceSelection = { publicFirst: boolean; preferred: 'tiingo' | 'twelve' | 'marketdata' | 'eodhd'; yahoo: boolean; spot: boolean; coinpaprika: boolean; coingecko: boolean; fx: boolean; binance: boolean; kraken: boolean; bullion?: boolean; twelveDemo: boolean; historyPreload?:boolean };
export const SOURCE_CHANGE = 'investatlas:market-source-selection';
const storageKey = 'investatlas.market-sources.v1';
const defaults: SourceSelection = { publicFirst: true, preferred: 'tiingo', yahoo: true, spot: true, coinpaprika: true, coingecko: true, fx: true, binance: false, kraken: false, bullion: false, twelveDemo: false };
const transient = new Map<string, SourceSelection>();
function normalize(v: Partial<SourceSelection> | null): SourceSelection {
  return { publicFirst: v?.publicFirst !== false, preferred: v?.preferred === 'eodhd' ? 'eodhd' : v?.preferred === 'marketdata' ? 'marketdata' : v?.preferred === 'twelve' ? 'twelve' : 'tiingo', yahoo: v?.yahoo !== false, spot: v?.spot !== false, coinpaprika: v?.coinpaprika !== false, coingecko: v?.coingecko !== false, fx: v?.fx !== false, binance: v?.binance === true, kraken: v?.kraken === true, bullion: v?.bullion === true, twelveDemo: v?.twelveDemo === true,historyPreload:v?.historyPreload!==false };
}
export function readSourceSelection(owner: string): SourceSelection {
  try { const raw = readWorkspaceStorageItem(storageKey, { userId: owner }); if (raw) return normalize(JSON.parse(raw)); } catch { /* Storage may be denied by the browser. */ }
  return { ...(transient.get(owner) ?? defaults) };
}
export function saveSourceSelection(owner: string, selection: SourceSelection): void {
  const safe = normalize(selection);
  transient.set(owner, safe);
  try { writeWorkspaceStorageItem(storageKey, JSON.stringify(safe), { userId: owner }); } catch { /* Keep preference in this tab. */ }
  window.dispatchEvent(new Event(SOURCE_CHANGE));
}
export function marketSourceOrder(p: SourceSelection): MarketSource[] {
  const personal: MarketSource[] = [p.preferred, ...(['tiingo', 'twelve', 'marketdata','eodhd'] as const).filter((source) => source !== p.preferred)];
  const publicSources: MarketSource[] = [...(p.yahoo ? ['yahoo' as const] : []), ...(p.spot ? ['spot' as const] : []), ...(p.coinpaprika ? ['coinpaprika' as const] : []), ...(p.coingecko ? ['coingecko' as const] : []), ...(p.binance ? ['binance' as const] : []), ...(p.kraken ? ['kraken' as const] : []), ...(p.bullion ? ['bullion' as const] : []), ...(p.twelveDemo ? ['twelve_demo' as const] : [])];
  return p.publicFirst ? [...publicSources, ...personal] : [...personal, ...publicSources];
}
