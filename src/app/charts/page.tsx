'use client';

import AppShell from '@/components/layout/app-shell';
import { useMobileViewport } from '@/lib/ui/use-mobile-viewport';
import { useReducedMotion } from '@/lib/ui/use-reduced-motion';
import { SELF_HOSTED_MARKET } from '@/lib/financial-data/providers/source-selection';
import { getPersonalAssetsByClass, USER_ASSETS_CHANGE_EVENT } from '@/lib/config/personal-asset-registry';
import { getAssetIconUrl } from '@/lib/config/asset-icon-sources';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_OPTIONS,
  SUPPORTED_ASSETS,
  type AssetClass,
  type AssetConfig,
} from '@/lib/config/supported-assets';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import {
  ANONYMOUS_WORKSPACE_MODE_EVENT,
  readAnonymousWorkspaceMode,
} from '@/lib/demo/workspace-mode';
import { calculateMACD } from '@/lib/indicators/macd';
import { calculateRSI } from '@/lib/indicators/rsi';
import { calculateSMA } from '@/lib/indicators/sma';
import {
  clampChartEnd,
  formatAssetAxisDate,
  getChartPanBounds,
  latestIndicator,
  parseChartDate,
  parseSmaPeriod,
  RANGE_LOOKBACK_MS,
  sliceChartWindow,
  trendDeltaPercent,
  type ChartRange,
} from '@/lib/charts/asset-chart';
import { formatChartAxis, formatChartQuote, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import { deriveGoldSilverRatio } from '@/lib/portfolio/ux-insights';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import {
  getHistoryTrustState,
  isHistoryCurrent,
  type HistoryTrustState,
} from '@/lib/financial-data/history/trust';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Coins,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { fetchCurrentQuoteBatches } from '@/lib/financial-data/quotes/client';
import { chartCurrentQuote, type ChartCurrentQuote } from '@/lib/charts/current-quote';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface PricePoint {
  date: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

function metalHistoryPerGram(points: PricePoint[]): PricePoint[] {
  return points.map((point) => ({
    ...point,
    close: point.close / TROY_OUNCE_GRAMS,
    open: point.open == null ? point.open : point.open / TROY_OUNCE_GRAMS,
    high: point.high == null ? point.high : point.high / TROY_OUNCE_GRAMS,
    low: point.low == null ? point.low : point.low / TROY_OUNCE_GRAMS,
  }));
}

const CHART_RANGES: ChartRange[] = ['7D', '1M', '3M', '6M', '1Y', '3Y', '5Y', 'All'];

function getFetchInterval(range: ChartRange, assetClass: AssetClass | undefined) {
  if (assetClass !== 'crypto') {
    return '1d';
  }

  switch (range) {
    case '1h':
      return '5m';
    case '1D':
      return '15m';
    case '7D':
    case '1M':
    case '3M':
    case '6M':
      return '1h';
    default:
      return '1d';
  }
}

function formatResolutionLabel(interval: string) {
  switch (interval) {
    case '5m':
      return '5-minute bars';
    case '15m':
      return '15-minute bars';
    case '1h':
      return '1-hour bars';
    default:
      return 'Daily bars';
  }
}

function formatTooltipLabel(date: string, interval: string, language: string) {
  const parsed = parseChartDate(date);
  const locale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';

  if (interval !== '1d') {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      calendar: 'gregory',
      timeZoneName: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: language !== 'de',
    }).format(parsed);
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    calendar: 'gregory',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function formatRatioLabel(value: number, language: string) {
  return `${value.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
}

function readAssetFromLocation() {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get('asset');
}

function writeAssetToLocation(symbol: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('asset', symbol);
  window.history.replaceState({}, '', url.toString());
}

function scoreAssetSearch(assetConfig: AssetConfig, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return 0;
  }

  const exactIdentifiers = [
    assetConfig.symbol,
    assetConfig.yahooSymbol,
    assetConfig.isin,
    assetConfig.wkn,
    ...(assetConfig.searchAliases ?? []),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (exactIdentifiers.includes(query)) {
    return 200;
  }

  let score = 0;
  const assetName = assetConfig.name.toLowerCase();
  const assetSymbol = assetConfig.symbol.toLowerCase();
  const classLabel = ASSET_CLASS_LABELS[assetConfig.assetClass].toLowerCase();

  if (assetSymbol.startsWith(query)) score = Math.max(score, 160);
  if (assetName.startsWith(query)) score = Math.max(score, 130);
  if (assetConfig.isin?.toLowerCase().includes(query)) score = Math.max(score, 150);
  if (assetConfig.wkn?.toLowerCase().includes(query)) score = Math.max(score, 140);
  if (assetSymbol.includes(query)) score = Math.max(score, 120);
  if (assetName.includes(query)) score = Math.max(score, 100);
  if (assetConfig.yahooSymbol?.toLowerCase().includes(query)) score = Math.max(score, 110);
  if ((assetConfig.searchAliases ?? []).some((alias) => alias.toLowerCase().includes(query))) {
    score = Math.max(score, 125);
  }
  if (classLabel.includes(query)) score = Math.max(score, 45);

  return score;
}

function AssetIcon({ asset }: { asset: AssetConfig }) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const remoteSrc = getAssetIconUrl(asset.symbol, asset.assetClass);

  if (asset.assetClass === 'metal' && (asset.symbol === 'GOLD' || asset.symbol === 'SILVER')) {
    return (
      <div className="popular-asset-icon-letter icon-metal" role="img" aria-label={asset.name}>
        <Coins size={21} color={asset.symbol === 'GOLD' ? '#b18b28' : '#8493a5'} aria-hidden="true" />
      </div>
    );
  }

  if (remoteSrc && remoteSrc !== failedIconUrl) {
    return (
      <img
        src={remoteSrc}
        alt=""
        className="popular-asset-icon-img"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedIconUrl(remoteSrc)}
      />
    );
  }

  return (
    <div className={`popular-asset-icon-letter icon-${asset.assetClass}`} role="img" aria-label={asset.name} style={{ fontSize: 10, letterSpacing: '-0.4px' }}>
      {asset.symbol.slice(0, 5)}
    </div>
  );
}

function getTaxLensLabel(assetConfig: AssetConfig | undefined, t: (s: string) => string) {
  if (!assetConfig) {
    return '—';
  }

  return assetConfig.taxRegime === 'capital_income' ? t('Capital income') : t('Private sale');
}

const CHART_COPY = {
  en: { changeAsset: 'Change asset', details: 'Asset details', historyUnavailable: 'History unavailable', returnUnavailable: 'Return unavailable', indicators: 'Indicators', rawSummary: 'Unadjusted history · indicators disabled', available: 'Available history', previous: 'Previous window', next: 'Next window', latest: 'Latest window', pan: 'Chart navigation', keys: 'Use Left and Right arrows to move the window; Home returns to the latest window.', empty: 'No observations in this window.', single: 'Only one observation in this window.', period: 'SMA period (2–400 whole observations)', periodInvalid: 'Enter a whole number from 2 to 400.', points: (count: number, range: string) => `${count} points in ${range} view` },
  de: { changeAsset: 'Wertpapier wechseln', details: 'Wertpapierdetails', historyUnavailable: 'Historie nicht verfügbar', returnUnavailable: 'Rendite nicht verfügbar', indicators: 'Indikatoren', rawSummary: 'Unbereinigte Historie · Indikatoren deaktiviert', available: 'Verfügbare Historie', previous: 'Vorheriges Zeitfenster', next: 'Nächstes Zeitfenster', latest: 'Aktuelles Zeitfenster', pan: 'Diagrammnavigation', keys: 'Mit den Pfeiltasten links und rechts das Zeitfenster verschieben; Pos1 kehrt zum aktuellen Zeitfenster zurück.', empty: 'Keine Beobachtungen in diesem Zeitfenster.', single: 'Nur eine Beobachtung in diesem Zeitfenster.', period: 'SMA-Periode (2–400 ganze Beobachtungen)', periodInvalid: 'Eine ganze Zahl von 2 bis 400 eingeben.', points: (count: number, range: string) => `${count} Datenpunkte im Zeitfenster ${range}` },
  ar: { changeAsset: 'تغيير الأصل', details: 'تفاصيل الأصل', historyUnavailable: 'السجل غير متاح', returnUnavailable: 'العائد غير متاح', indicators: 'المؤشرات', rawSummary: 'سجل غير معدل · المؤشرات معطلة', available: 'السجل المتاح', previous: 'الفترة السابقة', next: 'الفترة التالية', latest: 'أحدث فترة', pan: 'التنقل في الرسم البياني', keys: 'استخدم سهمي اليسار واليمين لتحريك الفترة؛ يعيد زر Home أحدث فترة.', empty: 'لا توجد بيانات في هذه الفترة.', single: 'توجد نقطة بيانات واحدة فقط في هذه الفترة.', period: 'فترة المتوسط المتحرك البسيط (عدد صحيح من ٢ إلى ٤٠٠)', periodInvalid: 'أدخل عدداً صحيحاً من ٢ إلى ٤٠٠.', points: (count: number, range: string) => `${count.toLocaleString('ar-SA')} نقطة بيانات في فترة ${range}` },
} as const;
const EMPTY_HISTORY: PricePoint[] = [];
const QUOTE_COPY = {
  en: { latest: 'Latest available quote', close: 'Last historical close', demo: 'Illustrative demo quote', loading: 'Loading quote…', unavailable: 'Quote unavailable', asOf: 'As of', refresh: 'Refresh quote' },
  de: { latest: 'Zuletzt verfügbarer Kurs', close: 'Letzter historischer Schlusskurs', demo: 'Beispielhafter Demokurs', loading: 'Kurs wird geladen…', unavailable: 'Kurs nicht verfügbar', asOf: 'Stand', refresh: 'Kurs aktualisieren' },
  ar: { latest: 'آخر سعر متاح', close: 'آخر سعر إغلاق تاريخي', demo: 'سعر تجريبي توضيحي', loading: 'جارٍ تحميل السعر…', unavailable: 'السعر غير متاح', asOf: 'بتاريخ', refresh: 'تحديث السعر' },
} as const;
interface HistoryResult {
  key: string;
  points: PricePoint[];
  status: 'loading' | 'ready' | 'error';
  trust: HistoryTrustState | null;
  source: string | null;
  closeOnly?: boolean;
  raw: boolean;
  error: string | null;
}

export default function ChartsPage() {
  const { t, language } = useAppTranslation();
  const locale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const copy = CHART_COPY[language === 'de' || language === 'ar' ? language : 'en'];
  const quoteCopy = QUOTE_COPY[language === 'de' || language === 'ar' ? language : 'en'];
  const formatRangeLabel = (range: ChartRange) => range === 'All' ? copy.available : range;
  const { user } = useAuth();
  const isMobileViewport = useMobileViewport();
  const reducedMotion = useReducedMotion();
  const [assetPickerExpanded, setAssetPickerExpanded] = useState(false);
  const pickerSummaryRef = useRef<HTMLElement>(null);
  const { displayCurrency } = useDisplayCurrencyPreference();
  const [asset, setAsset] = useState('BTC');
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClass>('crypto');
  const [isDemoSnapshot, setIsDemoSnapshot] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRange, setSelectedRange] = useState<ChartRange>('1Y');
  const [sma1, setSma1] = useState(50);
  const [sma2, setSma2] = useState(200);
  const [sma1Draft, setSma1Draft] = useState('50');
  const [sma2Draft, setSma2Draft] = useState('200');
  const [showSma1, setShowSma1] = useState(true);
  const [showSma2, setShowSma2] = useState(true);
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);
  const [quoteResult, setQuoteResult] = useState<{ key: string; quote: ChartCurrentQuote | null } | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [counterpartResult, setCounterpartResult] = useState<{ key: string; points: PricePoint[] } | null>(null);
  const [priceChartElement, setPriceChartElement] = useState<HTMLDivElement | null>(null);
  const [priceChartSize, setPriceChartSize] = useState({ width: 0, height: 500 });
  const [showGoldSilverRatio, setShowGoldSilverRatio] = useState(false);
  const [windowPosition, setWindowPosition] = useState<{ key: string; range: ChartRange; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; end: number; active: boolean } | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const demoAssets = useMemo<AssetConfig[]>(() =>
    INVESTATLAS_SHOWCASE_SNAPSHOT.assets.flatMap((demoAsset) =>
      demoAsset.assetClass === 'cash'
        ? []
        : [{
            symbol: demoAsset.symbol,
            name: demoAsset.name,
            assetClass: demoAsset.assetClass,
            nativeCurrency: 'eur',
            taxRegime: 'capital_income',
          }]), []);
  const [registryRevision, setRegistryRevision] = useState(0);
  useEffect(() => {
    const sync = () => setRegistryRevision(value => value + 1);
    window.addEventListener(USER_ASSETS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(USER_ASSETS_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const chartAssets = useMemo(() => isDemoSnapshot
    ? demoAssets.map((demoAsset) => ({ ...demoAsset, name: t(demoAsset.name) }))
    : SELF_HOSTED_MARKET ? ASSET_CLASS_OPTIONS.flatMap(option => getPersonalAssetsByClass(option.value))
      : SUPPORTED_ASSETS, [demoAssets, isDemoSnapshot, registryRevision, t]);

  useEffect(() => {
    const syncDemoMode = () => {
      const nextDemoMode = !user && readAnonymousWorkspaceMode() === 'demo_snapshot';
      setIsDemoSnapshot(nextDemoMode);
      if (!nextDemoMode) return;
      const locationAsset = readAssetFromLocation();
      const nextAsset = demoAssets.find(
        (candidate) => candidate.symbol === locationAsset,
      ) ?? demoAssets[0];
      if (nextAsset) {
        setAsset(nextAsset.symbol);
        setAssetClassFilter(nextAsset.assetClass);
      }
    };
    syncDemoMode();
    window.addEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncDemoMode);
    return () => {
      window.removeEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncDemoMode);
    };
  }, [demoAssets, user]);

  useEffect(() => {
    const element = priceChartElement;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;

      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);

      if (nextWidth > 0 && nextHeight > 0) {
        setPriceChartSize((current) =>
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight },
        );
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [priceChartElement]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncFromLocation = () => {
      const locationAsset = readAssetFromLocation();

      if (!locationAsset) {
        return;
      }

      const assetFromLocation = chartAssets.find(
        (candidate) => candidate.symbol === locationAsset,
      );

      if (!assetFromLocation) {
        return;
      }

      setAsset((current) => (current === assetFromLocation.symbol ? current : assetFromLocation.symbol));
      setAssetClassFilter((current) =>
        current === assetFromLocation.assetClass ? current : assetFromLocation.assetClass,
      );
    };

    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);

    return () => {
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [chartAssets]);

  const selectedAsset = useMemo(
    () => chartAssets.find((candidate) => candidate.symbol === asset),
    [asset, chartAssets],
  );
  const assetsForSelectedClass = useMemo(
    () => chartAssets.filter((candidate) => candidate.assetClass === assetClassFilter),
    [assetClassFilter, chartAssets],
  );
  const popularAssetsForClass = useMemo(
    () => assetsForSelectedClass.slice(0, 6),
    [assetsForSelectedClass],
  );
  const searchResults = useMemo(() => {
    const query = deferredSearchQuery.trim();

    if (!query) {
      return [];
    }

    return chartAssets.map((assetOption) => ({
      assetOption,
      score: scoreAssetSearch(assetOption, query),
    }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.assetOption.name.localeCompare(right.assetOption.name);
      })
      .slice(0, 8)
      .map((item) => item.assetOption);
  }, [chartAssets, deferredSearchQuery]);
  const supportsIntraday = !isDemoSnapshot && selectedAsset?.assetClass === 'crypto';
  const isMetal = selectedAsset?.assetClass === 'metal';
  const isGoldSilverPair = asset === 'GOLD' || asset === 'SILVER';
  const counterpartSymbol = asset === 'GOLD' ? 'SILVER' : asset === 'SILVER' ? 'GOLD' : null;
  const fetchInterval = useMemo(
    () => isDemoSnapshot || SELF_HOSTED_MARKET ? '1d' : getFetchInterval(selectedRange, selectedAsset?.assetClass),
    [selectedRange, selectedAsset?.assetClass, isDemoSnapshot],
  );

  useEffect(() => {
    if (!isGoldSilverPair) {
      setShowGoldSilverRatio(false);
      setCounterpartResult(null);
    }
  }, [isGoldSilverPair]);

  useEffect(() => {
    if (selectedRange === '1h' && !supportsIntraday) {
      setSelectedRange('1M');
    }
  }, [selectedRange, supportsIntraday]);

  const requestedHistoryRange = SELF_HOSTED_MARKET
    ? selectedRange === '3Y' ? '3y' : selectedRange === '5Y' || selectedRange === 'All' ? '5y' : '1y'
    : null;

  const historyKey = `${asset}:${displayCurrency}:${fetchInterval}:${requestedHistoryRange ?? 'default'}`;
  const quoteKey = `${user?.id ?? 'anonymous'}:${isDemoSnapshot}:${asset}:${displayCurrency}:${quoteRevision}`;
  const currentQuote = quoteResult?.key === quoteKey ? quoteResult.quote : null;
  const quoteLoading = quoteResult?.key !== quoteKey;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetchCurrentQuoteBatches([asset], displayCurrency, undefined, controller.signal)
      .then(result => {
        if (active) setQuoteResult({ key: quoteKey, quote: chartCurrentQuote(result.prices[asset], asset, displayCurrency, isMetal) });
      })
      .catch(() => { if (active) setQuoteResult({ key: quoteKey, quote: null }); });
    return () => { active = false; controller.abort(); };
  }, [asset, displayCurrency, isMetal, quoteKey]);
  const counterpartKey = `${counterpartSymbol}:${displayCurrency}:${fetchInterval}:${requestedHistoryRange ?? 'default'}`;
  // Key matching hides the previous payload on the very first render after selection.
  const result = historyResult?.key === historyKey ? historyResult : null;
  const history = result?.points ?? EMPTY_HISTORY;
  const counterpartHistory = counterpartResult?.key === counterpartKey ? counterpartResult.points : EMPTY_HISTORY;
  const loading = !result || result.status === 'loading';
  const error = result?.error ?? null;
  const historyTrustState = result?.trust ?? null;
  const historySource = result?.source ?? null;
  const historyIsRawUnadjusted = result?.raw ?? false;
  const panBounds = getChartPanBounds(history, selectedRange);
  const currentEndMs = windowPosition?.key === historyKey && windowPosition.range === selectedRange
    ? clampChartEnd(windowPosition.end, panBounds) : panBounds.maxEnd;
  const canPan = !loading && selectedRange !== 'All' && panBounds.minEnd < panBounds.maxEnd;
  const setChartEnd = (end: number) => setWindowPosition({ key: historyKey, range: selectedRange, end: clampChartEnd(end, panBounds) });
  const shiftWindow = (direction: -1 | 1) => {
    if (canPan) setChartEnd(currentEndMs + direction * RANGE_LOOKBACK_MS[selectedRange] * 0.5);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPan || !event.isPrimary || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, end: currentEndMs, active: false };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canPan) return;
    if (event.buttons === 0) { endPointerPan(event); return; }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) { dragRef.current = null; return; }
      if (Math.abs(dx) < 6) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    }
    const plotWidth = Math.max(1, priceChartSize.width - priceAxisWidth - (showGoldSilverRatio ? ratioAxisWidth : 0));
    setChartEnd(drag.end - dx * RANGE_LOOKBACK_MS[selectedRange] / plotWidth);
  };
  const endPointerPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const loadHistory = async () => {
      setHistoryResult({
        key: historyKey, points: [], status: 'loading',
        trust: null, source: null, raw: false, error: null,
      });

      try {
        const response = await fetchFinancialData(
          `/api/prices/history?symbol=${encodeURIComponent(asset)}&currency=${displayCurrency}&interval=${fetchInterval}${requestedHistoryRange ? `&range=${requestedHistoryRange}` : ''}`,
          { signal: controller.signal },
        );
        const data = await response.json();

        if (!response.ok || !data.prices?.length) {
          throw new Error(data.error || `No historical data available for ${asset}`);
        }

        if (isActive) {
          const market = Array.isArray(data.sources) ? data.sources.find((s: { kind?: string } | null) => s?.kind === 'market') : undefined;
          setHistoryResult({
            key: historyKey,
            points: isMetal ? metalHistoryPerGram(data.prices) : data.prices,
            status: 'ready',
            source: market?.providerName ?? null,
            closeOnly: data.prices.every((point: { dataQuality?: string }) => point.dataQuality === 'close_only'),
            trust: getHistoryTrustState(data),
            raw: data.adjustment === 'raw_unadjusted',
            error: null,
          });
        }
      } catch (loadError) {
        if (isActive) {
          setHistoryResult({
            key: historyKey, points: [], status: 'error', source: null, trust: null, raw: false,
            error: loadError instanceof Error ? loadError.message : 'Failed to load history',
          });
        }
      }
    };

    loadHistory();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [asset, displayCurrency, fetchInterval, isMetal, requestedHistoryRange, historyKey]);

  useEffect(() => {
    if (!counterpartSymbol) {
      setCounterpartResult(null);
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadCounterpartHistory = async () => {
      try {
        const response = await fetchFinancialData(
          `/api/prices/history?symbol=${counterpartSymbol}&currency=${displayCurrency}&interval=${fetchInterval}${requestedHistoryRange ? `&range=${requestedHistoryRange}` : ''}`,
          { signal: controller.signal },
        );
        const data = await response.json();

        if (!response.ok || !data.prices?.length || !isHistoryCurrent(data)) {
          throw new Error(data.error || `No historical data available for ${counterpartSymbol}`);
        }

        if (isActive) {
          setCounterpartResult({ key: counterpartKey, points: metalHistoryPerGram(data.prices) });
        }
      } catch {
        if (isActive) {
          setCounterpartResult(null);
        }
      }
    };

    void loadCounterpartHistory();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [counterpartSymbol, displayCurrency, fetchInterval, requestedHistoryRange, counterpartKey]);

  const closeSeries = useMemo(() => history.map((point) => point.close), [history]);
  const technicalIndicatorsAvailable = !historyIsRawUnadjusted && history.length > 0 && !loading && !error;
  const counterpartByDate = useMemo(
    () => new Map(counterpartHistory.map((point) => [point.date, point])),
    [counterpartHistory],
  );
  const smaSeries1 = useMemo(
    () => technicalIndicatorsAvailable ? calculateSMA(closeSeries, sma1) : [],
    [closeSeries, sma1, technicalIndicatorsAvailable],
  );
  const smaSeries2 = useMemo(
    () => technicalIndicatorsAvailable ? calculateSMA(closeSeries, sma2) : [],
    [closeSeries, sma2, technicalIndicatorsAvailable],
  );
  const rsiSeries = useMemo(
    () => technicalIndicatorsAvailable ? calculateRSI(closeSeries, 14) : [],
    [closeSeries, technicalIndicatorsAvailable],
  );
  const macdSeries = useMemo(
    () => technicalIndicatorsAvailable ? calculateMACD(closeSeries) : null,
    [closeSeries, technicalIndicatorsAvailable],
  );

  const chartData = useMemo(
    () =>
      history.map((point, index) => {
        const counterpartPoint = counterpartByDate.get(point.date);
        const counterpartClose = counterpartPoint?.close ?? null;
        const goldClose = asset === 'GOLD' ? point.close : counterpartClose;
        const silverClose = asset === 'SILVER' ? point.close : counterpartClose;
        const goldSilverRatio =
          goldClose != null && silverClose != null && goldClose > 0 && silverClose > 0
            ? Number((goldClose / silverClose).toFixed(2))
            : null;

        return {
          date: point.date,
          close: point.close,
          sma1: smaSeries1[index] ?? null,
          sma2: smaSeries2[index] ?? null,
          goldSilverRatio,
        };
      }),
    [asset, counterpartByDate, history, smaSeries1, smaSeries2],
  );

  const visibleHistory = useMemo(() => sliceChartWindow(history, selectedRange, currentEndMs), [history, selectedRange, currentEndMs]);

  const visibleChartData = useMemo(() => {
    if (visibleHistory.length === 0) {
      return [];
    }

    const startDate = visibleHistory[0].date;
    const startIndex = history.findIndex((point) => point.date === startDate);

    if (startIndex === -1) {
      return chartData;
    }

    return chartData.slice(startIndex, startIndex + visibleHistory.length);
  }, [chartData, history, visibleHistory]);

  const priceDomain = getChartDomain(visibleChartData.flatMap((point) => [
    point.close,
    ...(technicalIndicatorsAvailable && showSma1 ? [point.sma1] : []),
    ...(technicalIndicatorsAvailable && showSma2 ? [point.sma2] : []),
  ]));
  const ratioDomain = getChartDomain([...visibleChartData.map((point) => point.goldSilverRatio), 60, 75]);
  const priceAxisWidth = getChartAxisWidth(priceDomain, locale);
  const ratioAxisWidth = getChartAxisWidth(ratioDomain, locale, { suffix: 'x' });
  const latestPrice = closeSeries[closeSeries.length - 1] ?? 0;
  const visibleBaseline = visibleHistory[0]?.close ?? latestPrice;
  const latestSma1 = latestIndicator(smaSeries1);
  const latestSma2 = latestIndicator(smaSeries2);
  const latestRsi = latestIndicator(rsiSeries);
  const macd = latestIndicator(macdSeries?.macd ?? []);
  const signal = latestIndicator(macdSeries?.signal ?? []);
  const histogram = latestIndicator(macdSeries?.histogram ?? []);
  const latestMacd = macd !== null && signal !== null && histogram !== null ? { macd, signal, histogram } : null;
  const latestMatchedMetalObservation = useMemo(() => {
    if (!isGoldSilverPair) return null;
    const counterpartByDate = new Map(
      counterpartHistory.map((point) => [point.date, point.close]),
    );
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const point = history[index];
      const counterpartClose = counterpartByDate.get(point.date);
      if (point.close > 0 && typeof counterpartClose === 'number' && counterpartClose > 0) {
        return {
          asOf: point.date,
          assetClose: point.close,
          counterpartClose,
        };
      }
    }
    return null;
  }, [counterpartHistory, history, isGoldSilverPair]);
  const goldSilverRatioInsight = useMemo(() => {
    if (!latestMatchedMetalObservation) {
      return null;
    }

    return deriveGoldSilverRatio([
      {
        symbol: 'GOLD',
        currentPrice: asset === 'GOLD'
          ? latestMatchedMetalObservation.assetClose
          : latestMatchedMetalObservation.counterpartClose,
        asOf: latestMatchedMetalObservation.asOf,
      },
      {
        symbol: 'SILVER',
        currentPrice: asset === 'SILVER'
          ? latestMatchedMetalObservation.assetClose
          : latestMatchedMetalObservation.counterpartClose,
        asOf: latestMatchedMetalObservation.asOf,
      },
    ]);
  }, [asset, latestMatchedMetalObservation]);
  // A missing history cannot be interpreted as an actual zero return.
  const rangeDelta = visibleHistory.length >= 2 && visibleBaseline > 0
    ? ((visibleHistory[visibleHistory.length - 1].close - visibleBaseline) / visibleBaseline) * 100
    : null;
  const lastUpdated = history[history.length - 1]?.date || '—';
  const lastUpdatedLabel = lastUpdated === '—' ? lastUpdated : formatTooltipLabel(lastUpdated, fetchInterval, language);
  const shortTrendDeltaPct = trendDeltaPercent(latestPrice, latestSma1);
  const longTrendDeltaPct = trendDeltaPercent(latestPrice, latestSma2);
  const rsiLabel = latestRsi === null ? t('Needs more history')
    : latestRsi > 70 ? t('Overbought') : latestRsi < 30 ? t('Oversold')
      : latestRsi >= 55 ? t('Bullish momentum') : latestRsi <= 45 ? t('Weak momentum') : t('Balanced momentum');
  const macdLabel = !latestMacd ? t('Needs more history')
    : latestMacd.macd >= latestMacd.signal
      ? latestMacd.histogram >= 0 ? t('Positive momentum') : t('Bullish crossover fading')
      : latestMacd.histogram <= 0 ? t('Negative momentum') : t('Bearish crossover fading');
  const simpleTrendLabel = latestSma2 === null ? t('Needs more history')
    : latestPrice >= latestSma2 ? t('Above long trend') : t('Below long trend');
  const availableSignals = [
    latestSma2 !== null ? simpleTrendLabel : null,
    latestSma1 !== null ? latestPrice >= latestSma1 ? t('short trend supportive') : t('short trend weak') : null,
    latestRsi !== null ? rsiLabel : null,
    latestMacd !== null ? macdLabel : null,
  ].filter((value): value is string => value !== null);
  const quickReadSummary = technicalIndicatorsAvailable && availableSignals.length
    ? availableSignals.join(' · ')
    : historyIsRawUnadjusted ? t('Technical indicators are unavailable for raw, unadjusted daily history.') : t('Needs more history');
  const shortWindowFallback =
    !supportsIntraday && (selectedRange === '1D' || selectedRange === '7D' || selectedRange === '1M' || selectedRange === '3M' || selectedRange === '6M');
  const selectAssetForWorkspace = (symbol: string) => {
    const nextAsset = chartAssets.find((candidate) => candidate.symbol === symbol);

    if (!nextAsset) {
      return;
    }

    setAssetClassFilter(nextAsset.assetClass);
    setAsset(nextAsset.symbol);
    writeAssetToLocation(nextAsset.symbol);
    if (isMobileViewport) {
      setAssetPickerExpanded(false);
      pickerSummaryRef.current?.focus();
    }
  };

  const handleAssetClassChange = (nextClass: AssetClass) => {
    const nextAssets = chartAssets.filter((candidate) => candidate.assetClass === nextClass);
    const fallbackSymbol = nextAssets.some((assetOption) => assetOption.symbol === asset)
      ? asset
      : nextAssets[0]?.symbol;

    setAssetClassFilter(nextClass);

    if (fallbackSymbol) {
      setAsset(fallbackSymbol);
      writeAssetToLocation(fallbackSymbol);
    }
  };

  const formatChartPrice = (price: number) =>
    `${formatChartQuote(price, locale, displayCurrency)}${isMetal ? '/g' : ''}`;
  const selectedPriceLabel = currentQuote ? formatChartPrice(currentQuote.price)
    : !loading && history.length > 0 ? formatChartPrice(latestPrice)
      : quoteLoading ? quoteCopy.loading : '—';
  const selectedQuoteLabel = currentQuote ? currentQuote.demo ? quoteCopy.demo : quoteCopy.latest
    : !loading && history.length > 0 ? quoteCopy.close : quoteLoading ? quoteCopy.loading : quoteCopy.unavailable;
  const selectedQuoteTime = currentQuote?.observedAt ?? (!loading && history.length ? lastUpdated : null);

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <TrendingUp size={24} style={{ display: 'inline', marginRight: 8 }} />
              {t('Charts & Indicators')}
            </h1>
            <div className="page-header-meta">
              <span className={`status-pill ${loading || error || visibleHistory.length === 0 ? 'neutral' : 'live'}`}>
                {loading ? <RefreshCw size={13} className="loading-spin" /> : <TrendingUp size={13} />}
                {loading ? t('Loading history') : copy.points(visibleHistory.length, formatRangeLabel(selectedRange))}
              </span>
              <span className="chart-freshness-label">{t(result?.closeOnly ? 'Daily observations' : formatResolutionLabel(fetchInterval))} · {lastUpdatedLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="page-content animate-in">
        {error && (
          <div className="callout error">
            <AlertTriangle size={18} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{t('History unavailable.')}</strong> {error}
            </div>
          </div>
        )}

        {!error && (historyTrustState === 'stale' || historyTrustState === 'partial') && (
          <div className="callout warn">
            <AlertTriangle size={18} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
            <div>
              {historyTrustState === 'stale'
                ? t('Saved history is shown because refresh is unavailable. Check the last observation date.')
                : t('Historical data is partial. Some periods or fields may be unavailable.')}
            </div>
          </div>
        )}

        <div className="card chart-setup-card">
          <div className="chart-setup-grid">
            <details className="chart-asset-picker" open={isMobileViewport !== true || assetPickerExpanded}
              onToggle={(event) => { if (isMobileViewport) setAssetPickerExpanded(event.currentTarget.open); }}>
              <summary ref={pickerSummaryRef}>{copy.changeAsset} <bdi dir="ltr">{asset}</bdi></summary>
            <div className="chart-setup-main">
              <div className="chart-search-bar">
                <Search size={20} />
                <input
                  id="security-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-label={t('Search by name, ticker, WKN, or ISIN')}
                  placeholder={t('Search by name, ticker, WKN, or ISIN')}
                  autoComplete="off"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="chart-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('Clear search')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {!searchQuery.trim() && (
                <div className="asset-class-tabs" role="tablist" aria-label={t('Choose an asset to chart')}>
                  {ASSET_CLASS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      id={`chart-tab-${option.value}`}
                      aria-controls="chart-asset-options"
                      tabIndex={assetClassFilter === option.value ? 0 : -1}
                      onKeyDown={(event) => {
                        const index = ASSET_CLASS_OPTIONS.findIndex(item => item.value === option.value);
                        const forward = language === 'ar' ? 'ArrowLeft' : 'ArrowRight';
                        const backward = language === 'ar' ? 'ArrowRight' : 'ArrowLeft';
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ASSET_CLASS_OPTIONS.length - 1
                          : event.key === forward ? (index + 1) % ASSET_CLASS_OPTIONS.length
                            : event.key === backward ? (index + ASSET_CLASS_OPTIONS.length - 1) % ASSET_CLASS_OPTIONS.length : null;
                        if (next === null) return;
                        event.preventDefault();
                        handleAssetClassChange(ASSET_CLASS_OPTIONS[next].value);
                        document.getElementById(`chart-tab-${ASSET_CLASS_OPTIONS[next].value}`)?.focus();
                      }}
                      aria-selected={assetClassFilter === option.value}
                      className={`asset-class-tab ${assetClassFilter === option.value ? 'active' : ''}`}
                      onClick={() => handleAssetClassChange(option.value)}
                    >
                      {ASSET_CLASS_LABELS[option.value]}
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.trim() ? (
                <div className="security-search-results">
                  {searchResults.length > 0 ? (
                    searchResults.map((assetOption) => (
                      <button
                        key={assetOption.symbol}
                        type="button"
                        className={`security-result-item ${assetOption.symbol === asset ? 'active' : ''}`}
                        onClick={() => {
                          selectAssetForWorkspace(assetOption.symbol);
                          setSearchQuery('');
                        }}
                      >
                        <div className="security-result-topline">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <AssetIcon asset={assetOption} />
                            <div className="security-result-title">
                              <span className={`badge ${ASSET_CLASS_BADGE_CLASSES[assetOption.assetClass]}`}>
                                {ASSET_CLASS_LABELS[assetOption.assetClass]}
                              </span>
                              <strong>{assetOption.name}</strong>
                            </div>
                          </div>
                          <span className="mono">{assetOption.symbol}</span>
                        </div>
                        <div className="security-result-meta">
                          {assetOption.isin && <span>{assetOption.isin}</span>}
                          {assetOption.wkn && <bdi dir="ltr">{`WKN ${assetOption.wkn}`}</bdi>}
                          {assetOption.searchAliases?.[0] && <span>{assetOption.searchAliases[0]}</span>}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="security-search-empty">
                      {t('No match found for')} <strong>{searchQuery}</strong>. {t('Try a ticker symbol, ISIN, or full name.')}
                    </div>
                  )}
                </div>
              ) : (
                <div id="chart-asset-options" role="tabpanel" aria-labelledby={`chart-tab-${assetClassFilter}`}>
                  <div className="popular-assets-label">
                    {t('Popular')} {ASSET_CLASS_LABELS[assetClassFilter]}
                  </div>
                  <div className="popular-assets-grid">
                    {popularAssetsForClass.map((assetOption) => (
                      <button
                        key={assetOption.symbol}
                        type="button"
                        className={`popular-asset-card ${assetOption.symbol === asset ? 'active' : ''}`}
                        onClick={() => selectAssetForWorkspace(assetOption.symbol)}
                      >
                        <AssetIcon asset={assetOption} />
                        <div className="popular-asset-text">
                          <div className="popular-asset-symbol">{assetOption.symbol}</div>
                          <div className="popular-asset-name">{assetOption.name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </details>

            <div className="chart-selected-panel">
              <div className="chart-selected-header">
                <div>
                  <div className="security-profile-title-row">
                    <h2 className="security-profile-title">{selectedAsset?.name ?? asset}</h2>
                    {selectedAsset && (
                      <span className={`badge ${ASSET_CLASS_BADGE_CLASSES[selectedAsset.assetClass]}`}>
                        {ASSET_CLASS_LABELS[selectedAsset.assetClass]}
                      </span>
                    )}
                  </div>
                  <div className="security-profile-identifiers">
                    <span className="mono">{selectedAsset?.symbol ?? asset}</span>
                  </div>
                </div>
                <span
                  className={`status-pill ${loading || rangeDelta === null ? 'neutral' : rangeDelta >= 0 ? 'success' : 'error'
                    }`}
                >
                  {loading ? t('Syncing') : rangeDelta === null ? copy.returnUnavailable : `${rangeDelta >= 0 ? '+' : ''}${rangeDelta.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% (${selectedRange})`}
                </span>
              </div>

              <div className="chart-selected-price-row">
                <div className="security-profile-price"><bdi dir="ltr">{selectedPriceLabel}</bdi></div>
                <button type="button" className="btn btn-secondary btn-sm" aria-label={quoteCopy.refresh} title={quoteCopy.refresh} style={{ minWidth: 44, minHeight: 44 }}
                  disabled={quoteLoading} onClick={() => setQuoteRevision(value => value + 1)}>
                  <RefreshCw size={16} aria-hidden="true" />
                </button>

              </div>

              <div className="panel-subtitle" aria-live="polite">
                <span>{selectedQuoteLabel}</span>
                {currentQuote && <> · <bdi dir="ltr">{currentQuote.source}</bdi></>}
                {selectedQuoteTime && <> · {quoteCopy.asOf} {formatTooltipLabel(selectedQuoteTime, selectedQuoteTime.length > 10 ? '1h' : '1d', language)}</>}
              </div>
              <details className="chart-profile-details" open={isMobileViewport !== true}>
                <summary>{copy.details}</summary>
                <div className="chart-data-provenance">
              <span className="status-pill neutral chart-history-meta">
                <Clock3 size={13} />
                {t('Last update')} {lastUpdatedLabel}
                {!loading && !error && history.length > 0 && historySource && <> · <bdi dir="ltr">{historySource}</bdi></>}
              </span>
              <span className="status-pill neutral">
                <TrendingUp size={13} />
                {t(result?.closeOnly ? 'Daily observations' : formatResolutionLabel(fetchInterval))}
              </span>
                </div>
                <div className="security-profile-identifiers">
                  {selectedAsset?.isin && <span>{selectedAsset.isin}</span>}
                  {selectedAsset?.wkn && <bdi dir="ltr">{`WKN ${selectedAsset.wkn}`}</bdi>}
                </div>
              <div className="chart-selected-stats">
                <div className="security-profile-stat">
                  <span>{t('Base currency')}</span>
                  <strong>{selectedAsset?.nativeCurrency?.toUpperCase() ?? '—'}</strong>
                </div>
                <div className="security-profile-stat">
                  <span>{t('Tax treatment')}</span>
                  <strong>{getTaxLensLabel(selectedAsset, t)}</strong>
                </div>
              </div>
              </details>
            </div>
          </div>
        </div>

        <div id="price-structure-card" className="card chart-card" style={{ minHeight: 500, minWidth: 0 }}>
          <div className="chart-toolbar">
            {isGoldSilverPair && (
              <div className="chart-toolbar-row">
                <div className="chart-control-grid chart-control-grid-compact">
                  <div className="chart-control">
                    <label className="label">{t('Ratio Overlay')}</label>
                    <button
                      className={`btn ${showGoldSilverRatio ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setShowGoldSilverRatio((current) => !current)}
                      aria-pressed={showGoldSilverRatio}
                    >
                      {showGoldSilverRatio ? t('On') : t('Off')}
                    </button>
                  </div>
                </div>

                <div className="chart-status-group">
                  {goldSilverRatioInsight && (
                    <span className="status-pill neutral">
                      <Activity size={13} />
                      {t(goldSilverRatioInsight.bandLabel)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="chart-toolbar-row chart-toolbar-row-secondary">
              <div className="interactive-equity-range" aria-label={t('Chart range')}>
                {CHART_RANGES.map((rangeOption) => {
                  const isDisabled = rangeOption === '1h' && !supportsIntraday;

                  return (
                    <button
                      key={rangeOption}
                      type="button"
                      className={`interactive-equity-range-button ${selectedRange === rangeOption ? 'active' : ''}`}
                      aria-pressed={selectedRange === rangeOption}
                      onClick={() => setSelectedRange(rangeOption)}
                      disabled={isDisabled}
                      title={isDisabled ? t('1h intraday view is currently available for crypto assets only.') : undefined}
                    >
                      {rangeOption === 'All' ? copy.available : rangeOption}
                    </button>
                  );
                })}
              </div>


            </div>

            {[{ draft: sma1Draft, id: 'sma1-error' }, { draft: sma2Draft, id: 'sma2-error' }].map(({ draft, id }) =>
              parseSmaPeriod(draft) === null ? <p key={id} id={id} role="status" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{copy.periodInvalid}</p> : null)}
            {shortWindowFallback && (
              <div className="callout warn chart-inline-callout">
                <AlertTriangle size={16} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                <div>{t('Short windows still use daily closes for this asset source.')}</div>
              </div>
            )}
            {historyIsRawUnadjusted && (
              <details className="chart-history-disclosure">
                <summary>{copy.rawSummary}</summary>
                <p>{t('Raw, unadjusted daily history is shown as a chart only. Technical indicators are disabled because corporate actions can distort the series.')}</p>
              </details>
            )}
          </div>

          <div
            ref={setPriceChartElement}
            className={`asset-chart-surface ${!loading && error ? 'is-empty' : ''}`}
            style={{ width: '100%', minWidth: 0, touchAction: 'pan-y pinch-zoom', cursor: canPan ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
            tabIndex={0}
            role="group"
            aria-label={`${t('Price')} · ${selectedAsset?.name ?? asset}`}
            aria-describedby={history.length > 0 ? 'chart-pan-help' : undefined}
            aria-busy={loading}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={(event) => {
              if (!dragRef.current?.active) endPointerPan(event);
            }}
            onPointerUp={endPointerPan}
            onPointerCancel={endPointerPan}
            onLostPointerCapture={endPointerPan}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !canPan || event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); shiftWindow(event.key === 'ArrowLeft' ? -1 : 1); }
              if (event.key === 'Home') { event.preventDefault(); setChartEnd(panBounds.maxEnd); }
            }}
          >
            {loading ? <div className="skeleton-pulse" role="status" style={{ height: '100%', borderRadius: 18 }}>{t('Loading history')}</div>
              : error ? <div role="status">{copy.historyUnavailable}</div>
              : visibleHistory.length === 0 ? <div role="status">{copy.empty}</div>
              : priceChartSize.width > 0 ? (
              <AreaChart
                width={priceChartSize.width}
                height={priceChartSize.height}
                data={visibleChartData}
                margin={{ top: 12, right: 8, left: 8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--series-market)" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="var(--series-market)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 3" strokeOpacity={0.9} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  minTickGap={fetchInterval === '1d' ? 28 : 72}
                  padding={{ left: 10, right: 0 }}
                  tickFormatter={(val) => formatAssetAxisDate(val, selectedRange, fetchInterval, locale)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  tickFormatter={(value) => formatChartAxis(Number(value), priceDomain, locale)}
                  width={priceAxisWidth}
                  orientation={language === 'ar' ? 'right' : 'left'}
                  domain={priceDomain}

                />
                {showGoldSilverRatio && (
                  <YAxis
                    yAxisId="ratio"
                    orientation={language === 'ar' ? 'left' : 'right'}
                    tickLine={false}
                    axisLine={false}
                    stroke="var(--text-muted)"
                    fontSize={11}
                    width={ratioAxisWidth}
                    domain={ratioDomain}
                    tickFormatter={(value) => formatChartAxis(Number(value), ratioDomain, locale, { suffix: 'x' })}
                  />
                )}
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    color: 'var(--text-primary)',
                  }}
                  formatter={(value, name) => {
                    const numericValue = typeof value === 'number'
                      ? value
                      : Array.isArray(value)
                        ? Number(value[0] ?? 0)
                        : Number(value ?? 0);
                    const label = typeof name === 'string' ? name : 'Series';

                    return [
                      typeof name === 'string' && name === t('Gold/Silver Ratio')
                        ? formatRatioLabel(numericValue, language)
                        : formatChartPrice(numericValue),
                      label,
                    ];
                  }}
                  labelFormatter={(val) => formatTooltipLabel(val, fetchInterval, language)}
                />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                {showGoldSilverRatio && (
                  <>
                    <ReferenceLine yAxisId="ratio" y={60} stroke="var(--chart-threshold-error)" strokeDasharray="5 5" />
                    <ReferenceLine yAxisId="ratio" y={75} stroke="var(--chart-threshold-warning)" strokeDasharray="5 5" />
                  </>
                )}
                <Area type="monotone" dataKey="close" name={t('Price')} stroke="var(--series-market)" fill="url(#priceFill)" strokeWidth={2.4} dot={visibleHistory.length === 1 ? { r: 4 } : false} isAnimationActive={!isDragging && !reducedMotion} />
                {technicalIndicatorsAvailable && showSma1 && (
                  <Line type="monotone" dataKey="sma1" name={`SMA ${sma1}`} stroke="var(--series-etfs)" strokeWidth={2} dot={false} isAnimationActive={!isDragging && !reducedMotion} />
                )}
                {technicalIndicatorsAvailable && showSma2 && (
                  <Line type="monotone" dataKey="sma2" name={`SMA ${sma2}`} stroke="var(--series-crypto)" strokeWidth={2} dot={false} isAnimationActive={!isDragging && !reducedMotion} />
                )}
                {showGoldSilverRatio && (
                  <Line
                    yAxisId="ratio"
                    type="monotone"
                    dataKey="goldSilverRatio"
                    name={t('Gold/Silver Ratio')}
                    stroke="var(--series-metals)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={!isDragging && !reducedMotion}
                    connectNulls={false}
                  />
                )}
              </AreaChart>
            ) : (
              <div className="skeleton-pulse" style={{ width: '100%', height: '100%', borderRadius: 18 }} />
            )}
          </div>



            {history.length > 0 && <>
            <div className="chart-toolbar-row chart-pan-controls" role="group" aria-label={copy.pan} style={{ flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} disabled={!canPan || currentEndMs <= panBounds.minEnd} onClick={() => shiftWindow(-1)}>{copy.previous}</button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} disabled={!canPan || currentEndMs >= panBounds.maxEnd} onClick={() => shiftWindow(1)}>{copy.next}</button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} disabled={!canPan || currentEndMs >= panBounds.maxEnd} onClick={() => setChartEnd(panBounds.maxEnd)}>{copy.latest}</button>
            </div>
            <p id="chart-pan-help" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{copy.keys}</p>
            </>}

              <details className="chart-indicator-disclosure" open={isMobileViewport !== true}>
                <summary>{copy.indicators}</summary>
              <div className="chart-indicator-controls">
                {/* Quote currency follows the display preference. */}
                <div className="interactive-equity-range">
                  <span className="interactive-equity-range-button active">
                    <bdi dir="ltr">{displayCurrency.toUpperCase()}</bdi>
                  </span>
                </div>

                {/* SMA 1 Pill */}
                <div className="interactive-equity-range">
                  <button
                    type="button"
                    className={`interactive-equity-range-button ${showSma1 && technicalIndicatorsAvailable ? 'active' : ''}`}
                    onClick={() => setShowSma1(!showSma1)}
                    aria-pressed={showSma1 && technicalIndicatorsAvailable}
                    disabled={!technicalIndicatorsAvailable}
                  >
                    <bdi dir="ltr">{t('SMA 1')}</bdi>
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={400}
                    step={1}
                    aria-label={`${copy.period} · SMA 1`}
                    aria-invalid={parseSmaPeriod(sma1Draft) === null}
                    aria-describedby={parseSmaPeriod(sma1Draft) === null ? 'sma1-error' : undefined}
                    value={sma1Draft}
                    onChange={(event) => {
                      const draft = event.target.value;
                      setSma1Draft(draft);
                      const period = parseSmaPeriod(draft);
                      if (period !== null) setSma1(period);
                    }}
                    onBlur={() => setSma1Draft(String(sma1))}
                    disabled={!showSma1 || !technicalIndicatorsAvailable}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: showSma1 ? 'var(--text-primary)' : 'var(--text-muted)',
                      width: '52px',
                      textAlign: 'center',
                      fontSize: '16px',
                      fontWeight: '700',
                      opacity: showSma1 ? 1 : 0.5,
                      minHeight: 44,
                    }}
                  />
                </div>

                {/* SMA 2 Pill */}
                <div className="interactive-equity-range">
                  <button
                    type="button"
                    className={`interactive-equity-range-button ${showSma2 && technicalIndicatorsAvailable ? 'active' : ''}`}
                    onClick={() => setShowSma2(!showSma2)}
                    aria-pressed={showSma2 && technicalIndicatorsAvailable}
                    disabled={!technicalIndicatorsAvailable}
                  >
                    <bdi dir="ltr">{t('SMA 2')}</bdi>
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={400}
                    step={1}
                    aria-label={`${copy.period} · SMA 2`}
                    aria-invalid={parseSmaPeriod(sma2Draft) === null}
                    aria-describedby={parseSmaPeriod(sma2Draft) === null ? 'sma2-error' : undefined}
                    value={sma2Draft}
                    onChange={(event) => {
                      const draft = event.target.value;
                      setSma2Draft(draft);
                      const period = parseSmaPeriod(draft);
                      if (period !== null) setSma2(period);
                    }}
                    onBlur={() => setSma2Draft(String(sma2))}
                    disabled={!showSma2 || !technicalIndicatorsAvailable}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: showSma2 ? 'var(--text-primary)' : 'var(--text-muted)',
                      width: '52px',
                      textAlign: 'center',
                      fontSize: '16px',
                      fontWeight: '700',
                      opacity: showSma2 ? 1 : 0.5,
                      minHeight: 44,
                    }}
                  />
                </div>
              </div>
              </details>

          <div className="chart-read-stack">
            {!loading && !error && visibleHistory.length === 1 && <p role="status">{copy.single}</p>}
            <div className="callout neutral">
              <Activity size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>{t('Quick read.')}</strong> {quickReadSummary}
              </div>
            </div>

            {technicalIndicatorsAvailable && <div className="insight-list">
              <div className="insight-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{t('Short trend')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('Price')} {t('vs')}{' '}
                    <bdi dir="ltr">{shortTrendDeltaPct === null ? t('Needs more history') : `SMA(${sma1}) ${shortTrendDeltaPct >= 0 ? '+' : ''}${shortTrendDeltaPct.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</bdi>
                  </div>
                </div>
                <span className={`badge ${latestSma1 === null ? 'badge-yellow' : latestPrice >= latestSma1 ? 'badge-green' : 'badge-red'}`}>
                  {latestSma1 === null ? t('Needs more history') : latestPrice >= latestSma1 ? t('Above') : t('Below')}
                </span>
              </div>

              <div className="insight-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{t('Long trend')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('Price')} {t('vs')}{' '}
                    <bdi dir="ltr">{longTrendDeltaPct === null ? t('Needs more history') : `SMA(${sma2}) ${longTrendDeltaPct >= 0 ? '+' : ''}${longTrendDeltaPct.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</bdi>
                  </div>
                </div>
                <span className={`badge ${latestSma2 === null ? 'badge-yellow' : latestPrice >= latestSma2 ? 'badge-green' : 'badge-red'}`}>
                  {simpleTrendLabel}
                </span>
              </div>

              <div className="insight-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{t('Momentum')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <bdi dir="ltr">{latestRsi === null ? t('Needs more history') : `RSI ${latestRsi.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`}</bdi>
                  </div>
                </div>
                <span
                  className={`badge ${latestRsi === null ? 'badge-yellow' : latestRsi > 70 ? 'badge-red' : latestRsi < 30 ? 'badge-green' : 'badge-blue'
                    }`}
                >
                  {rsiLabel}
                </span>
              </div>

              <div className="insight-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{t('MACD bias')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {latestMacd
                      ? `${t('Histogram')} ${latestMacd.histogram >= 0 ? '+' : ''}${latestMacd.histogram.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : t('Waiting for more history')}
                  </div>
                </div>
                <span className={`badge ${latestMacd && latestMacd.histogram >= 0 ? 'badge-green' : 'badge-yellow'}`}>
                  {macdLabel}
                </span>
              </div>
            </div>}

            {isGoldSilverPair && goldSilverRatioInsight && (
              <div className="callout info">
                <Activity size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="chart-signal-copy">
                  <strong>{t(goldSilverRatioInsight.bandLabel)}.</strong>{' '}
                  {t(goldSilverRatioInsight.bandDescription)}{' '}
                  {goldSilverRatioInsight.asOf
                    ? `${t('Calculated from matching closes as of')} ${formatTooltipLabel(goldSilverRatioInsight.asOf, '1D', language)}. `
                    : ''}
                  {showGoldSilverRatio
                    ? t('The orange line in the chart shows how the ratio evolves through the selected range.')
                    : t('Turn on the ratio overlay if you want to see that relationship inside the chart.')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
