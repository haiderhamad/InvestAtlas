export interface DailyHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  adjustedClose?: number;
  dataQuality?: 'ohlc';
}

export interface CloseOnlyHistoryBar {
  date: string;
  close: number;
  open: null;
  high: null;
  low: null;
  volume: null;
  dataQuality: 'close_only';
  adjustedClose?: never;
}

export type HistoryBar = DailyHistoryBar | CloseOnlyHistoryBar;

export interface HistoryCacheKey {
  installation: string;
  owner: string;
  instrument: string;
  exchange: string;
  providerId: string;
  currency: 'USD' | 'EUR';
  interval: '1d';
  adjustment: string;
  version: 1;
}

export interface HistoryRange {
  from: string;
  to: string;
}

export interface HistoryCacheRecord {
  key: HistoryCacheKey;
  bars: HistoryBar[];
  coverage: HistoryRange[];
  retrievedAt: number;
  lastCheckedAt: number;
}
