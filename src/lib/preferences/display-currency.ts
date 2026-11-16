'use client';

import { useEffect, useState } from 'react';
import {
  APP_PREFERENCES_EVENT,
  readAppPreferences,
  type DisplayCurrencyPreference,
  type LanguagePreference,
} from '@/lib/preferences/app-preferences';
import {
  readAnonymousWorkspaceMode,
  type AnonymousWorkspaceMode,
} from '@/lib/demo/workspace-mode';
import { getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';

export const DISPLAY_CURRENCY_LABELS: Record<DisplayCurrencyPreference, string> = {
  eur: 'Euro (EUR)',
  usd: 'US Dollar (USD)',
};

export function resolveWorkspaceDisplayCurrency(
  preferredCurrency: DisplayCurrencyPreference,
  workspaceUserId: string | null | undefined,
  anonymousMode: AnonymousWorkspaceMode,
): DisplayCurrencyPreference {
  // The fixed Demo Snapshot is denominated and dated in EUR. Applying a live
  // ECB reference rate would create a synthetic/live hybrid with false as-of.
  return workspaceUserId === null && anonymousMode === 'demo_snapshot'
    ? 'eur'
    : preferredCurrency;
}

interface DisplayFxRate {
  rate: number;
  asOf: string;
  freshness: 'fresh' | 'stale';
}

interface CachedDisplayFx extends DisplayFxRate {
  expiresAt: number;
}

const DISPLAY_FX_CACHE_MS = 30 * 60 * 1_000;
const DISPLAY_FX_NEGATIVE_CACHE_MS = 60 * 1_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const FRESH_ECB_AGE_DAYS = 3;
const MAX_ECB_AGE_DAYS = 7;
let cachedDisplayFx: CachedDisplayFx | null = null;
let displayFxPromise: Promise<DisplayFxRate | null> | null = null;
let unavailableUntil = 0;

function localeForLanguage(language: LanguagePreference): string {
  if (language === 'ar') return 'ar-SA';
  if (language === 'de') return 'de-DE';
  return 'en-US';
}

export function parseEurToUsdFxPayload(
  value: unknown,
  now = new Date(),
): DisplayFxRate | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as {
    status?: unknown;
    data?: {
      baseCurrency?: unknown;
      quoteCurrency?: unknown;
      rate?: {
        status?: unknown;
        value?: unknown;
        freshness?: unknown;
        asOf?: unknown;
        provenance?: { providerId?: unknown };
      };
    };
  };
  const rate = payload.data?.rate;
  if (
    (payload.status !== 'complete' && payload.status !== 'partial')
    || payload.data?.baseCurrency !== 'EUR'
    || payload.data?.quoteCurrency !== 'USD'
    || rate?.status !== 'available'
    || typeof rate.value !== 'number'
    || !Number.isFinite(rate.value)
    || rate.value <= 0
    || (rate.freshness !== 'fresh' && rate.freshness !== 'stale')
    || typeof rate.asOf !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(rate.asOf)
    || rate.provenance?.providerId !== 'ecb_reference_rates'
  ) {
    return null;
  }
  const asOfTimestamp = Date.parse(`${rate.asOf}T00:00:00.000Z`);
  const todayTimestamp = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const ageDays = (todayTimestamp - asOfTimestamp) / MILLISECONDS_PER_DAY;
  if (
    !Number.isInteger(ageDays)
    || ageDays < 0
    || ageDays > MAX_ECB_AGE_DAYS
  ) {
    return null;
  }
  return {
    rate: rate.value,
    asOf: rate.asOf,
    freshness: ageDays <= FRESH_ECB_AGE_DAYS ? 'fresh' : 'stale',
  };
}

async function loadEurToUsdReference(): Promise<DisplayFxRate | null> {
  const now = Date.now();
  if (cachedDisplayFx && cachedDisplayFx.expiresAt > now) {
    return {
      rate: cachedDisplayFx.rate,
      asOf: cachedDisplayFx.asOf,
      freshness: cachedDisplayFx.freshness,
    };
  }
  if (unavailableUntil > now) return null;
  if (displayFxPromise) return displayFxPromise;

  displayFxPromise = (async () => {
    try {
      const response = await fetch(
        '/api/financial-data/fx?from=EUR&to=USD',
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok) throw new Error('FX unavailable');
      const parsed = parseEurToUsdFxPayload(await response.json());
      if (!parsed) throw new Error('Invalid FX response');
      cachedDisplayFx = {
        ...parsed,
        expiresAt: Date.now() + DISPLAY_FX_CACHE_MS,
      };
      unavailableUntil = 0;
      return parsed;
    } catch {
      unavailableUntil = Date.now() + DISPLAY_FX_NEGATIVE_CACHE_MS;
      return null;
    } finally {
      displayFxPromise = null;
    }
  })();
  return displayFxPromise;
}

export function convertEurToDisplayCurrency(
  valueEur: number,
  displayCurrency: DisplayCurrencyPreference,
  eurToUsdRate: number | null,
): number | null {
  if (!Number.isFinite(valueEur)) return null;
  if (displayCurrency === 'eur') return valueEur;
  if (
    typeof eurToUsdRate !== 'number'
    || !Number.isFinite(eurToUsdRate)
    || eurToUsdRate <= 0
  ) {
    return null;
  }
  const converted = valueEur * eurToUsdRate;
  return Number.isFinite(converted)
    ? Number(converted.toPrecision(15))
    : null;
}

export function getDisplayCurrencyCode(
  displayCurrency: DisplayCurrencyPreference,
): 'EUR' | 'USD' {
  return displayCurrency.toUpperCase() as 'EUR' | 'USD';
}

export function formatQuoteCurrency(
  value: number,
  displayCurrency: DisplayCurrencyPreference,
  language: LanguagePreference,
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(localeForLanguage(language), {
    style: 'currency',
    currency: getDisplayCurrencyCode(displayCurrency),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function formatDisplayCurrency(
  valueEur: number,
  displayCurrency: DisplayCurrencyPreference,
  eurToUsdRate: number | null,
  language: LanguagePreference,
  minimumFractionDigits = 0,
  maximumFractionDigits = 0,
): string {
  const converted = convertEurToDisplayCurrency(
    valueEur,
    displayCurrency,
    eurToUsdRate,
  );
  if (converted === null) return '—';

  return new Intl.NumberFormat(localeForLanguage(language), {
    style: 'currency',
    currency: getDisplayCurrencyCode(displayCurrency),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(converted);
}

export function formatSignedDisplayCurrency(
  valueEur: number,
  displayCurrency: DisplayCurrencyPreference,
  eurToUsdRate: number | null,
  language: LanguagePreference,
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
): string {
  const formatted = formatDisplayCurrency(
    Math.abs(valueEur),
    displayCurrency,
    eurToUsdRate,
    language,
    minimumFractionDigits,
    maximumFractionDigits,
  );
  return formatted === '—' ? formatted : `${valueEur >= 0 ? '+' : '−'}${formatted}`;
}

export function useDisplayCurrencyPreference() {
  const initial = readAppPreferences();
  const [preferredDisplayCurrency, setPreferredDisplayCurrency] =
    useState<DisplayCurrencyPreference>(initial.displayCurrency);
  const [language, setLanguage] =
    useState<LanguagePreference>(initial.language);
  const [fx, setFx] = useState<DisplayFxRate | null>(null);
  const [fxStatus, setFxStatus] = useState<
    'loading' | 'available' | 'unavailable'
  >('loading');
  const workspaceUserId = getActiveBrowserWorkspaceUserId();
  const anonymousMode = readAnonymousWorkspaceMode();
  const displayCurrency = resolveWorkspaceDisplayCurrency(
    preferredDisplayCurrency,
    workspaceUserId,
    anonymousMode,
  );
  const isIsolatedDemo = workspaceUserId === null
    && anonymousMode === 'demo_snapshot';

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = readAppPreferences();
      setPreferredDisplayCurrency(preferences.displayCurrency);
      setLanguage(preferences.language);
    };

    window.addEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
    window.addEventListener('storage', syncPreferences);
    return () => {
      window.removeEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
      window.removeEventListener('storage', syncPreferences);
    };
  }, []);

  useEffect(() => {
    if (isIsolatedDemo) {
      setFx(null);
      setFxStatus('unavailable');
      return;
    }

    let active = true;
    setFxStatus('loading');
    void loadEurToUsdReference().then((rate) => {
      if (!active) return;
      setFx(rate);
      setFxStatus(rate ? 'available' : 'unavailable');
    });
    return () => {
      active = false;
    };
  }, [isIsolatedDemo]);

  const rate = fx?.freshness === 'fresh' ? fx.rate : null;
  return {
    displayCurrency,
    fxStatus,
    fxAsOf: fx?.asOf ?? null,
    fxFreshness: fx?.freshness ?? null,
    eurToUsdRate: rate,
    usdToEurRate: rate && rate > 0
      ? Number((1 / rate).toPrecision(15))
      : null,
    formatMoney: (
      valueEur: number,
      minimumFractionDigits = 0,
      maximumFractionDigits = 0,
    ) => formatDisplayCurrency(
      valueEur,
      displayCurrency,
      rate,
      language,
      minimumFractionDigits,
      maximumFractionDigits,
    ),
    formatSignedMoney: (
      valueEur: number,
      minimumFractionDigits = 0,
      maximumFractionDigits = 0,
    ) => formatSignedDisplayCurrency(
      valueEur,
      displayCurrency,
      rate,
      language,
      minimumFractionDigits,
      maximumFractionDigits,
    ),
    formatQuoteMoney: (value: number, quote: string, activeLanguage: string) => {
      const locale = activeLanguage === 'de'
        ? 'de-DE'
        : activeLanguage === 'ar'
          ? 'ar-SA'
          : 'en-US';
      return `${value.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${quote}`;
    },
    convertMoney: (valueEur: number) =>
      convertEurToDisplayCurrency(valueEur, displayCurrency, rate),
  };
}
