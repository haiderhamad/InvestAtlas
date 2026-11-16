export interface DailyHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  adjustedClose?: number;
}

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
  bars: DailyHistoryBar[];
  coverage: HistoryRange[];
  retrievedAt: number;
  lastCheckedAt: number;
}
