'use client';

import { 
  MoonStar, 
  SunMedium, 
  MonitorSmartphone, 
  Globe, 
  Coins,
  Receipt
} from 'lucide-react';
import Link from 'next/link';
import { 
  type ThemePreference, 
  type LanguagePreference, 
  type DisplayCurrencyPreference 
} from '@/lib/preferences/app-preferences';
import { DISPLAY_CURRENCY_LABELS } from '@/lib/preferences/display-currency';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

// Language choices always show their native names, regardless of active locale.
const NATIVE_LANGUAGE_NAMES = { en: 'English', de: 'Deutsch', ar: 'العربية' } as const;

interface GeneralPreferencesProps {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  language: LanguagePreference;
  setLanguage: (lang: LanguagePreference) => void;
  currency: DisplayCurrencyPreference;
  setCurrency: (curr: DisplayCurrencyPreference) => void;
}

export default function GeneralPreferences({
  theme,
  setTheme,
  language,
  setLanguage,
  currency,
  setCurrency
}: GeneralPreferencesProps) {
  const { t } = useAppTranslation();

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card">
        <div className="panel-header">
          <div>
            <div className="section-title">{t('Appearance & Theme')}</div>
            <div className="panel-subtitle">
              {t('Customize how InvestAtlas looks on your device.')}
            </div>
          </div>
        </div>

        <div className="tabs" role="group" aria-label={t('Appearance & Theme')} style={{ marginBottom: 24 }}>
          <button 
            className={`tab ${theme === 'dark' ? 'active' : ''}`} 
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <MoonStar size={14} />
            {t('Dark')}
          </button>
          <button 
            className={`tab ${theme === 'light' ? 'active' : ''}`} 
            type="button"
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <SunMedium size={14} />
            {t('Light')}
          </button>
          <button 
            className={`tab ${theme === 'system' ? 'active' : ''}`} 
            type="button"
            aria-pressed={theme === 'system'}
            onClick={() => setTheme('system')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <MonitorSmartphone size={14} />
            {t('System')}
          </button>
        </div>

        <div className="grid-2">
          <div>
            <label className="label" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              <Globe size={14} />
              {t('Language')}
            </label>
            <div className="tabs">
              <button 
                className={`tab ${language === 'en' ? 'active' : ''}`} 
                type="button"
                lang="en"
                translate="no"
                aria-pressed={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                {NATIVE_LANGUAGE_NAMES.en}
              </button>
              <button 
                className={`tab ${language === 'de' ? 'active' : ''}`} 
                type="button"
                lang="de"
                translate="no"
                aria-pressed={language === 'de'}
                onClick={() => setLanguage('de')}
              >
                {NATIVE_LANGUAGE_NAMES.de}
              </button>
              <button 
                className={`tab ${language === 'ar' ? 'active' : ''}`} 
                type="button"
                lang="ar"
                dir="rtl"
                translate="no"
                aria-pressed={language === 'ar'}
                onClick={() => setLanguage('ar')}
              >
                {NATIVE_LANGUAGE_NAMES.ar}
              </button>
            </div>
          </div>

          <div>
            <label className="label" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              <Coins size={14} />
              {t('Display Currency')}
            </label>
            <div className="tabs" role="group" aria-label={t('Display Currency')}>
              {(['eur', 'usd'] as const).map((curr) => (
                <button 
                  key={curr}
                  className={`tab ${currency === curr ? 'active' : ''}`} 
                  type="button"
                  aria-pressed={currency === curr}
                  onClick={() => setCurrency(curr)}
                >
                  {t(DISPLAY_CURRENCY_LABELS[curr])}
                </button>
              ))}
            </div>
            <div className="panel-subtitle" style={{ marginTop: 8 }}>
              {t('USD display uses sourced ECB daily reference rates and becomes unavailable if FX data is missing.')}
              {' '}{t('Source: ECB statistics.')}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ background: 'linear-gradient(to right, rgba(123, 182, 255, 0.05), transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Receipt size={16} color="var(--accent-blue)" />
              {t('Tax Profile')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {t('Configure your tax residency, income rates, and specific allowances.')}
            </div>
          </div>
          <Link 
            href="/tax?tab=profile"
            className="button secondary sm"
            style={{ borderRadius: 10 }}
          >
            {t('Edit Profile')}
          </Link>
        </div>
      </div>
    </div>
  );
}
