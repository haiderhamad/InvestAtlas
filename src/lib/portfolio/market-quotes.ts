'use client';

import { useEffect, useMemo, useState } from 'react';
import { chartCurrentQuote } from '@/lib/charts/current-quote';
import { USER_ASSETS_CHANGE_EVENT } from '@/lib/config/personal-asset-registry';
import type { QuoteCurrency } from '@/lib/config/supported-assets';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { isHistoryUsableForDerivedPerformance } from '@/lib/financial-data/history/trust';
import { PERSONAL_MARKET_PROVIDER_CHANGE_EVENT } from '@/lib/financial-data/providers/alpha-vantage-browser';
import { PUBLIC_SOURCE_CONSENT_EVENT } from '@/lib/financial-data/providers/public-source-consent';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT } from '@/lib/financial-data/providers/tiingo-browser';
import {
  currentQuoteFreshUntil,
  fetchCurrentQuoteBatches,
  type CurrentQuoteBatchResult,
} from '@/lib/financial-data/quotes/client';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';

/** Portfolio valuation is computed in EUR. Display conversion is handled separately. */
const VALUATION_CURRENCY = 'eur';
const MAX_TIMEOUT_MS = 2_147_483_647;
const MARKET_EVENTS = [
  ANONYMOUS_WORKSPACE_MODE_EVENT, BROWSER_WORKSPACE_CHANGE_EVENT,
  USER_ASSETS_CHANGE_EVENT, PUBLIC_SOURCE_CONSENT_EVENT, SOURCE_CHANGE,
  PERSONAL_MARKET_PROVIDER_CHANGE_EVENT, TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
];
const NO_PRICES: Record<string, CurrentPriceSnapshot> = {};
const NO_HISTORY: Record<string, HistoryEntry> = {};

type HistoricalPrice = { date: string; close: number };
type HistoricalClose = HistoricalPrice & { source: string; demo: boolean };
type HistoryEntry = { performance?: HistoricalPrice[]; close?: HistoricalClose };
type QuoteState = {
  scope: string;
  request: string;
  prices: Record<string, CurrentPriceSnapshot>;
  status: CurrentQuoteBatchResult['status'];
  issues?: CurrentQuoteBatchResult['issues'];
  rateLimited: boolean;
};
type HistoryPayload = {
  status?: string;
  symbol?: string;
  currency?: string;
  synthetic?: boolean;
  dataMode?: string;
  prices?: Array<HistoricalPrice & { sourceRef?: string }>;
  sources?: Array<{ ref?: string; kind?: string; providerId?: string; providerName?: string }>;
};

function latestHistoricalClose(payload: HistoryPayload, symbol: string, isDemo: boolean): HistoricalClose | undefined {
  const demo = payload.synthetic === true || payload.dataMode === 'demo_snapshot';
  if (demo !== isDemo
    || (payload.status !== 'partial' && payload.status !== 'complete')
    || payload.symbol !== symbol || payload.currency !== VALUATION_CURRENCY
    || !Array.isArray(payload.prices) || !Array.isArray(payload.sources)) return undefined;

  const today = new Date().toISOString().slice(0, 10);
  const sourceNames = new Map(payload.sources.flatMap(source =>
    source?.kind === 'market'
      && typeof source.ref === 'string'
      && typeof source.providerId === 'string'
      && source.providerId !== 'unknown_provider'
      && typeof source.providerName === 'string'
      && source.providerName.trim()
      ? [[source.ref, source.providerName] as const]
      : [],
  ));
  let latest: HistoricalClose | undefined;
  for (const point of payload.prices) {
    const source = point?.sourceRef && sourceNames.get(point.sourceRef);
    if (!source || !Number.isFinite(point.close) || point.close <= 0
      || typeof point.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)
      || point.date >= today || (latest && point.date <= latest.date)) continue;
    const day = Date.parse(point.date);
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== point.date) continue;
    latest = { date: point.date, close: point.close, source, demo };
  }
  return latest;
}

function acceptedQuote(snapshot: CurrentPriceSnapshot, symbol: string, isDemo: boolean, now: number) {
  // The valuation builder still supports legacy responses without field metadata.
  if (!snapshot.fields) return true;
  const quote = chartCurrentQuote(snapshot, symbol, VALUATION_CURRENCY, false);
  const expires = currentQuoteFreshUntil(snapshot);
  return Boolean(quote && quote.demo === isDemo && (expires === null || now < expires));
}

export function usePortfolioMarketQuotes(
  workspace: string,
  displayCurrency: QuoteCurrency,
  quoteSymbols: string,
  historySymbols: string,
) {
  const [sourceRevision, setSourceRevision] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [quotes, setQuotes] = useState<QuoteState | null>(null);
  const [history, setHistory] = useState<{ scope: string; entries: Record<string, HistoryEntry> } | null>(null);
  const [cooldown, setCooldown] = useState<{ workspace: string; until: number } | null>(null);
  const [clockRevision, updateClock] = useState(0);
  const scope = JSON.stringify([workspace, displayCurrency, sourceRevision]);
  const request = JSON.stringify([quoteSymbols, refreshCount]);
  const isDemo = workspace === 'demo_snapshot';
  const ready = workspace !== 'pending';
  const activeQuotes = quotes?.scope === scope ? quotes : null;
  const historyEntries = history?.scope === scope ? history.entries : NO_HISTORY;
  const retryAt = cooldown?.workspace === workspace ? cooldown.until : undefined;
  const now = Date.now();
  const isCoolingDown = retryAt !== undefined && retryAt > now;
  const fetching = ready && !!quoteSymbols && !isCoolingDown && activeQuotes?.request !== request;

  useEffect(() => {
    const invalidate = () => setSourceRevision(revision => revision + 1);
    MARKET_EVENTS.forEach(event => window.addEventListener(event, invalidate));
    return () => MARKET_EVENTS.forEach(event => window.removeEventListener(event, invalidate));
  }, []);

  useEffect(() => {
    if (!ready || !quoteSymbols || isCoolingDown || activeQuotes?.request === request) return;
    const controller = new AbortController();
    const symbols = quoteSymbols.split(',');
    async function refresh() {
      let result: CurrentQuoteBatchResult | null;
      try {
        result = await fetchCurrentQuoteBatches(symbols, VALUATION_CURRENCY, undefined, controller.signal);
      } catch {
        result = null;
      }
      if (controller.signal.aborted) return;
      const checkedAt = Date.now();
      if (result?.retryAt && result.retryAt > checkedAt) {
        setCooldown({ workspace, until: result.retryAt });
      }
      setQuotes(previous => {
        const prices: Record<string, CurrentPriceSnapshot> = {};
        let missing = false;
        for (const symbol of symbols) {
          const incoming = result?.prices[symbol];
          const last = previous?.scope === scope ? previous.prices[symbol] : undefined;
          const deadline = last ? currentQuoteFreshUntil(last) : null;
          if (incoming && acceptedQuote(incoming, symbol, isDemo, checkedAt)) {
            prices[symbol] = incoming;
          } else {
            missing = true;
            if (last && deadline !== null && deadline > checkedAt) prices[symbol] = last;
          }
        }
        return {
          scope, request, prices, status: missing ? 'unavailable' : result?.status ?? 'unavailable',
          issues: result?.issues,
          rateLimited: result?.retryAt !== undefined || Object.values(result?.issues ?? {}).includes('rate_limited'),
        };
      });
    }
    void refresh();
    return () => controller.abort();
  }, [activeQuotes?.request, isCoolingDown, isDemo, quoteSymbols, ready, request, scope, workspace]);

  useEffect(() => {
    if (!ready || !historySymbols) return;
    const controller = new AbortController();
    async function loadHistory() {
      for (const symbol of historySymbols.split(',')) {
        if (controller.signal.aborted) return;
        try {
          const parameters = new URLSearchParams({ symbol, currency: VALUATION_CURRENCY });
          const response = await fetchFinancialData(`/api/prices/history?${parameters}`, { signal: controller.signal });
          if (!response.ok || controller.signal.aborted) continue;
          const data = await response.json() as HistoryPayload | null;
          if (!data || !Array.isArray(data.prices) || controller.signal.aborted) continue;
          const close = latestHistoricalClose(data, symbol, isDemo);
          const performance = isHistoryUsableForDerivedPerformance(data) ? data.prices : undefined;
          if (!close && !performance) continue;
          setHistory(previous => ({
            scope,
            entries: { ...(previous?.scope === scope ? previous.entries : {}), [symbol]: { close, performance } },
          }));
        } catch {
          // Current quotes and other symbols' history remain usable when this request fails.
        }
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [historySymbols, isDemo, ready, scope]);

  const sourcePrices = activeQuotes?.prices ?? NO_PRICES;
  const symbols = useMemo(() => new Set(quoteSymbols.split(',')), [quoteSymbols]);
  const prices = useMemo(() => {
    const checkedAt = Date.now();
    return Object.fromEntries(Object.entries(sourcePrices).filter(([symbol, snapshot]) => {
      const expires = currentQuoteFreshUntil(snapshot);
      return symbols.has(symbol) && (expires === null || expires > checkedAt);
    }));
  }, [clockRevision, sourcePrices, symbols]);
  const nextExpiry = Math.min(
    isCoolingDown ? retryAt! : Infinity,
    ...Object.values(prices).map(price => currentQuoteFreshUntil(price) ?? Infinity),
  );

  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => updateClock(version => version + 1),
      Math.max(0, Math.min(MAX_TIMEOUT_MS, nextExpiry - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);

  const historicalPrices = useMemo(() => Object.fromEntries(
    Object.entries(historyEntries).flatMap(([symbol, entry]) =>
      entry.performance ? [[symbol, entry.performance] as const] : [],
    ),
  ), [historyEntries]);

  return {
    prices, historicalPrices, historyEntries, fetching, isCoolingDown, retryAt,
    issues: activeQuotes?.issues,
    rateLimited: activeQuotes?.rateLimited ?? isCoolingDown,
    refreshFailed: activeQuotes?.status === 'unavailable',
    refresh: () => {
      if (!fetching && !isCoolingDown) setRefreshCount(count => count + 1);
    },
  };
}
