'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { translateAppText } from './app-localization';
import { 
  readAppPreferences, 
  APP_PREFERENCES_EVENT,
  DEFAULT_APP_PREFERENCES,
} from '@/lib/preferences/app-preferences';

let hasHydratedPreferences = false;

function subscribeToPreferenceChanges(onStoreChange: () => void) {
  if (!hasHydratedPreferences) {
    hasHydratedPreferences = true;
    queueMicrotask(onStoreChange);
  }

  window.addEventListener(APP_PREFERENCES_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);

  return () => {
    window.removeEventListener(APP_PREFERENCES_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function getHydrationSafeLanguage() {
  return hasHydratedPreferences
    ? readAppPreferences().language
    : DEFAULT_APP_PREFERENCES.language;
}

/**
 * Hook to use translations in React components.
 * Although the app has a global LocalizationEffects observer, 
 * this hook is useful for dynamic strings that aren't yet in the DOM
 * or for specific manual translations.
 */
export function useAppTranslation() {
  const language = useSyncExternalStore(
    subscribeToPreferenceChanges,
    getHydrationSafeLanguage,
    () => DEFAULT_APP_PREFERENCES.language,
  );
  const t = useCallback(
    (text: string) => translateAppText(text, language),
    [language],
  );

  return { t, language };
}
