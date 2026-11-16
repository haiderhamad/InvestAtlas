'use client';

import {
  getActiveBrowserWorkspaceUserId,
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

export type ThemePreference = 'dark' | 'light' | 'system';
export type LanguagePreference = 'en' | 'de' | 'ar';
export type DisplayCurrencyPreference = 'eur' | 'usd';

export interface LocalAccountProfile {
  signedIn: boolean;
  fullName: string;
  email: string;
}

export interface AppPreferences {
  theme: ThemePreference;
  language: LanguagePreference;
  displayCurrency: DisplayCurrencyPreference;
  accountProfile: LocalAccountProfile;
}

export const APP_PREFERENCES_KEY = 'investatlas.preferences';
export const APP_PREFERENCES_EVENT = 'investatlas:preferences-change';

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: 'dark',
  language: 'en',
  displayCurrency: 'eur',
  accountProfile: {
    signedIn: false,
    fullName: '',
    email: '',
  },
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'en' || value === 'de' || value === 'ar';
}

function isDisplayCurrencyPreference(
  value: unknown,
): value is DisplayCurrencyPreference {
  return value === 'eur' || value === 'usd';
}

function normalizeLocalAccountProfile(value: unknown): LocalAccountProfile {
  if (!value || typeof value !== 'object') {
    return DEFAULT_APP_PREFERENCES.accountProfile;
  }

  const parsed = value as Partial<LocalAccountProfile>;
  return {
    signedIn: typeof parsed.signedIn === 'boolean' ? parsed.signedIn : DEFAULT_APP_PREFERENCES.accountProfile.signedIn,
    fullName: typeof parsed.fullName === 'string' ? parsed.fullName : DEFAULT_APP_PREFERENCES.accountProfile.fullName,
    email: typeof parsed.email === 'string' ? parsed.email : DEFAULT_APP_PREFERENCES.accountProfile.email,
  };
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  const parsed = value && typeof value === 'object'
    ? value as Partial<AppPreferences>
    : {};
  return {
    theme: isThemePreference(parsed.theme)
      ? parsed.theme
      : DEFAULT_APP_PREFERENCES.theme,
    language: isLanguagePreference(parsed.language)
      ? parsed.language
      : DEFAULT_APP_PREFERENCES.language,
    displayCurrency: isDisplayCurrencyPreference(parsed.displayCurrency)
      ? parsed.displayCurrency
      : DEFAULT_APP_PREFERENCES.displayCurrency,
    accountProfile: normalizeLocalAccountProfile(parsed.accountProfile),
  };
}

function isIsolatedDemoWorkspace(): boolean {
  return getActiveBrowserWorkspaceUserId() === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot';
}

function readStoredAppPreferences(): AppPreferences {
  try {
    const raw = readWorkspaceStorageItem(
      APP_PREFERENCES_KEY,
      undefined,
      { allowDemo: true },
    );
    return raw ? normalizeAppPreferences(JSON.parse(raw)) : DEFAULT_APP_PREFERENCES;
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

function demoPresentationPreferences(stored: AppPreferences): AppPreferences {
  return {
    theme: stored.theme,
    language: stored.language,
    displayCurrency: 'eur',
    accountProfile: DEFAULT_APP_PREFERENCES.accountProfile,
  };
}

export function readAppPreferences(): AppPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_PREFERENCES;
  }

  try {
    const stored = readStoredAppPreferences();
    return isIsolatedDemoWorkspace()
      ? demoPresentationPreferences(stored)
      : stored;
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export function writeAppPreferences(nextPreferences: Partial<AppPreferences>): AppPreferences {
  const demoWorkspace = isIsolatedDemoWorkspace();
  const current = demoWorkspace
    ? readStoredAppPreferences()
    : readAppPreferences();
  const merged: AppPreferences = {
    ...current,
    ...(demoWorkspace
      ? {
          ...(isThemePreference(nextPreferences.theme)
            ? { theme: nextPreferences.theme }
            : {}),
          ...(isLanguagePreference(nextPreferences.language)
            ? { language: nextPreferences.language }
            : {}),
        }
      : nextPreferences),
    displayCurrency: !demoWorkspace && isDisplayCurrencyPreference(nextPreferences.displayCurrency)
      ? nextPreferences.displayCurrency
      : current.displayCurrency,
  };

  if (typeof window !== 'undefined') {
    if (writeWorkspaceStorageItem(
      APP_PREFERENCES_KEY,
      JSON.stringify(merged),
      undefined,
      { allowDemo: true },
    )) {
      const visible = demoWorkspace
        ? demoPresentationPreferences(merged)
        : merged;
      window.dispatchEvent(new CustomEvent(APP_PREFERENCES_EVENT, { detail: visible }));
    }
  }

  return demoWorkspace ? demoPresentationPreferences(merged) : merged;
}

export function resolveThemePreference(theme: ThemePreference): 'dark' | 'light' {
  if (theme === 'system') {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }

    return 'dark';
  }

  return theme;
}

export function applyThemePreference(theme: ThemePreference) {
  if (typeof document === 'undefined') {
    return;
  }

  const resolvedTheme = resolveThemePreference(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function resolveLanguageDirection(language: LanguagePreference): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

export function applyLanguagePreference(language: LanguagePreference) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = language;
  document.documentElement.dir = resolveLanguageDirection(language);
  document.documentElement.dataset.language = language;
}
