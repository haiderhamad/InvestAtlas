'use client';

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import {
  readAppPreferences,
  APP_PREFERENCES_EVENT,
  DEFAULT_APP_PREFERENCES,
} from '@/lib/preferences/app-preferences';

/**
 * Keeps <html lang="..."> and <html dir="..."> in sync with the user's
 * language preference (stored in localStorage).
 *
 * Must be rendered inside the <body> so it has access to the client.
 * Does nothing during SSR (layout.tsx renders html lang="en" as the default).
 */
export function HtmlLocaleSync() {
  const language = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(APP_PREFERENCES_EVENT, onStoreChange);
      window.addEventListener('storage', onStoreChange);
      return () => {
        window.removeEventListener(APP_PREFERENCES_EVENT, onStoreChange);
        window.removeEventListener('storage', onStoreChange);
      };
    },
    () => readAppPreferences().language,
    () => DEFAULT_APP_PREFERENCES.language,
  );

  useEffect(() => {
    const html = document.documentElement;
    html.lang = language;
    html.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  return null;
}
