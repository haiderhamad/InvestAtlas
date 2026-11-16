'use client';

import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Database,
  Globe,
  Sparkles,
  HelpCircle,
  TrendingUp,
  Receipt,
  WalletCards,
  RefreshCw,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import {
  APP_PREFERENCES_EVENT,
  applyLanguagePreference,
  applyThemePreference,
  type DisplayCurrencyPreference,
  type LanguagePreference,
  type LocalAccountProfile,
  readAppPreferences,
  resolveThemePreference,
  writeAppPreferences,
  type ThemePreference,
} from '@/lib/preferences/app-preferences';
import {
  normalizeTaxProfileSettings,
  type TaxProfileSettings,
} from '@/lib/tax/tax-profile';
import { readTaxProfileSettings, TAX_PROFILE_STORAGE_EVENT, writeTaxProfileSettings } from '@/lib/tax/tax-profile-store';
import { clearAllAccountData } from '@/lib/account-data/account-data-io';
import { getFirebaseIdToken } from '@/lib/auth/firebase-api-auth';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useAuth } from '@/lib/auth/auth-context';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

// New Modular Components
import GeneralPreferences from '@/components/settings/general-preferences';
import TaxProfileSettingsComponent from '@/components/settings/tax-profile-settings';
import DataSyncSettings from '@/components/settings/data-sync-settings';
import { PersonalMarketSources } from '@/components/settings/personal-market-sources';
import { SELF_HOSTED_MARKET, TIINGO_CONNECTABLE } from '@/lib/financial-data/providers/source-selection';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { clearTwelve } from '@/lib/financial-data/providers/twelve-personal';
import { clearMarketData } from '@/lib/financial-data/providers/marketdata-personal';
import { clearEodhd } from '@/lib/financial-data/providers/eodhd-personal';
import { clearPersonalHistoryCache } from '@/lib/financial-data/providers/personal-history-service';
import { PersonalSecurityManager } from '@/components/settings/personal-security-manager';
import { FinancialProviderManagerV124 } from '@/components/settings/financial-provider-manager-v124';
import {
  clearAlphaVantageNormalizedCache,
  clearAlphaVantageSessionCredential,
} from '@/lib/financial-data/providers/alpha-vantage-browser';
import { clearTiingoBrowserCredential } from '@/lib/financial-data/providers/tiingo-browser';
import { AIProviderManager } from '@/components/settings/ai-provider-manager';
import { LocalAIProviderManager } from '@/components/settings/local-ai-provider-manager';
import AccountSettings from '@/components/settings/account-settings';
import HelpAboutSettings from '@/components/settings/help-about-settings';

interface CoinMeta {
  symbol: string;
  name: string;
  assetClass: string;
  source: string;
  firstDate: string | null;
  lastDate: string | null;
  dataPoints: number | null;
  isComplete: boolean | null;
  lastSyncAt: string | null;
  warnings: string[];
}

type SettingsTab = 'general' | 'account' | 'data' | 'about';

export default function SettingsPage() {
  const { t, language: languagePreference } = useAppTranslation();
  const { user, signOut } = useAuth();
  const isDemoSnapshot = !user
    && readAnonymousWorkspaceMode() === 'demo_snapshot';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [subTab, setSubTab] = useState<'status' | 'sources'>('status');
  const [coinData, setCoinData] = useState<CoinMeta[]>([]);
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  // const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('en');
  const [displayCurrencyPreference, setDisplayCurrencyPreference] =
    useState<DisplayCurrencyPreference>('eur');
  const [accountProfile, setAccountProfile] = useState<LocalAccountProfile>(() => readAppPreferences().accountProfile);
  const [accountDraft, setAccountDraft] = useState(() => {
    const profile = readAppPreferences().accountProfile;
    return { fullName: profile.fullName, email: profile.email };
  });
  const [taxProfileSettings, setTaxProfileSettings] = useState<TaxProfileSettings>(() => readTaxProfileSettings());
  const [taxProfileIoMessage, setTaxProfileIoMessage] = useState<string | null>(null);

  const fetchDataStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/prices/history?metadata=true', { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.assets) setCoinData(data.assets);
      else if (data.coins) setCoinData(data.coins);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Settings fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.decodeURIComponent(window.location.hash);
      if (hash.includes('data-sources')) {
        setActiveTab('data');
        setSubTab('sources');
      } else if (hash.includes('account')) {
        setActiveTab('account');
      } else if (hash.includes('help-support') || hash.includes('about')) {
        setActiveTab('about');
      } else if (hash.includes('tax')) {
        window.location.href = '/tax?tab=profile';
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      // Only fetch diagnostic data when needed (on Data tab)
      if (activeTab === 'data') {
        void fetchDataStatus(controller.signal);
      }
      
      const preferences = readAppPreferences();
      setThemePreference(preferences.theme);
      setDisplayCurrencyPreference(preferences.displayCurrency);
      setAccountProfile(preferences.accountProfile);
      setAccountDraft({
        fullName: preferences.accountProfile.fullName,
        email: preferences.accountProfile.email,
      });
      setTaxProfileSettings(readTaxProfileSettings());
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [fetchDataStatus, activeTab, subTab]);

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = readAppPreferences();
      setThemePreference(preferences.theme);
      setDisplayCurrencyPreference(preferences.displayCurrency);
      setAccountProfile(preferences.accountProfile);
      setAccountDraft({
        fullName: preferences.accountProfile.fullName,
        email: preferences.accountProfile.email,
      });
    };
    const syncTaxProfile = () => {
      setTaxProfileSettings(readTaxProfileSettings());
    };

    window.addEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
    window.addEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
    window.addEventListener('storage', syncPreferences);
    window.addEventListener('storage', syncTaxProfile);

    return () => {
      window.removeEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
      window.removeEventListener(TAX_PROFILE_STORAGE_EVENT, syncTaxProfile as EventListener);
      window.removeEventListener('storage', syncPreferences);
      window.removeEventListener('storage', syncTaxProfile);
    };
  }, []);

  const setThemeMode = (nextTheme: ThemePreference) => {
    setThemePreference(nextTheme);
    applyThemePreference(nextTheme);
    writeAppPreferences({ theme: nextTheme });
  };
  const setLanguageMode = (nextLanguage: LanguagePreference) => {
    // setLanguagePreference no longer needed
    applyLanguagePreference(nextLanguage);
    writeAppPreferences({ language: nextLanguage });
  };
  const setDisplayCurrencyMode = (nextCurrency: DisplayCurrencyPreference) => {
    setDisplayCurrencyPreference(nextCurrency);
    writeAppPreferences({ displayCurrency: nextCurrency });
  };
  const saveAccountProfile = (nextProfile: LocalAccountProfile) => {
    setAccountProfile(nextProfile);
    writeAppPreferences({ accountProfile: nextProfile });
  };
  const signInLocally = () => {
    if (!accountDraft.fullName.trim() || !accountDraft.email.trim()) return;
    saveAccountProfile({
      signedIn: true,
      fullName: accountDraft.fullName.trim(),
      email: accountDraft.email.trim(),
    });
  };
  const signOutLocally = async () => {
    await signOut().catch(() => undefined);
    const clearedProfile = { signedIn: false, fullName: '', email: '' };
    setAccountDraft(clearedProfile);
    saveAccountProfile(clearedProfile);
  };
  const handleSignOut = async () => {
    if (user) {
      await signOut().catch(() => undefined);
      window.location.assign('/login');
      return;
    }
    await signOutLocally();
  };
  const handleDeleteAccount = async () => {
    if (isDemoSnapshot) return;
    if (user) {
      const deletedUserId = user.id;
      clearAlphaVantageSessionCredential();
      clearTiingoBrowserCredential();
      clearTwelve();
      clearMarketData();
      clearEodhd();
      const token = await getFirebaseIdToken();
      if (!token) {
        alert(t('Authentication is required. Please sign in again.'));
        return;
      }

      let response: Response;
      try {
        await clearPersonalHistoryCache(deletedUserId);
        response = await fetch('/api/account/delete', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });
      } catch {
        alert(t('Account deletion is temporarily unavailable. Please try again.'));
        return;
      }

      if (response.status === 401) {
        const payload = await response.json().catch(() => null) as {
          code?: unknown;
        } | null;
        if (payload?.code === 'recent-auth-required') {
          alert(t('For security, sign out and sign in again before deleting your account.'));
        } else {
          alert(t('Authentication is required. Please sign in again.'));
        }
        return;
      }
      if (!response.ok) {
        alert(t('Account deletion is temporarily unavailable. Please try again.'));
        return;
      }

      // Browser-scoped data is removed only after the server confirms that
      // Cloud data and Firebase Authentication were deleted successfully.
      try {
        clearAlphaVantageNormalizedCache(deletedUserId);
        await clearAllAccountData({
          includeCloudStores: false,
          workspaceUserId: deletedUserId,
        });
      } catch {
        // The server already completed the irreversible Cloud deletion. A
        // blocked browser storage operation must not leave the deleted
        // Firebase session active or prevent the user reaching a safe exit.
      } finally {
        await signOut().catch(() => undefined);
      }
      alert(t('Account deleted successfully.'));
      window.location.assign('/login');
      return;
    }

    if (INVESTATLAS_DEPLOYMENT_MODE === 'local_personal') await clearPersonalHistoryCache(LOCAL_PERSONAL_PROVIDER_OWNER_ID);
    await clearAllAccountData({ includeCloudStores: false });
    alert(t('Account deleted successfully.'));
    await signOutLocally();
  };
  const saveTaxProfile = (nextProfile: TaxProfileSettings) => {
    setTaxProfileSettings(nextProfile);
    writeTaxProfileSettings(nextProfile);
  };



  const menuItems: Array<{ id: SettingsTab; label: string; icon: any }> = [
    { id: 'general', label: t('General'), icon: Globe },
    { id: 'data', label: t('Data & Sync'), icon: RefreshCw },
    { id: 'account', label: t('Account'), icon: User },
    { id: 'about', label: t('Help & About'), icon: HelpCircle },
  ];

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main" style={{ width: '100%' }}>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SettingsIcon size={24} style={{ color: 'var(--accent-teal)' }} />
              {t('Settings')}
            </h1>
          </div>
        </div>

        <div className="tabs" role="group" aria-label={t('Settings')}>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveTab(item.id)}
                className={`tab ${isActive ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="page-content animate-in">
        <div className="settings-shell" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Settings Content */}
          <div className="settings-main">
            {activeTab === 'general' && (
              <GeneralPreferences 
                theme={themePreference}
                setTheme={setThemeMode}
                language={languagePreference}
                setLanguage={setLanguageMode}
                currency={displayCurrencyPreference}
                setCurrency={setDisplayCurrencyMode}
              />
            )}


            {activeTab === 'data' && (
              <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="tabs">
                  <button 
                    className={`tab ${subTab === 'status' ? 'active' : ''}`}
                    type="button"
                    aria-pressed={subTab === 'status'}
                    onClick={() => setSubTab('status')}
                  >
                    {t('Sync Status')}
                  </button>
                  <button 
                    className={`tab ${subTab === 'sources' ? 'active' : ''}`}
                    type="button"
                    aria-pressed={subTab === 'sources'}
                    onClick={() => setSubTab('sources')}
                  >
                    {t('Data Sources')}
                  </button>
                </div>

                {subTab === 'status' ? (
                  <DataSyncSettings 
                    coinData={coinData}
                  />
                ) : (
                  <>
                    {user || (INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && !isDemoSnapshot) ? (
                      <>
                        {SELF_HOSTED_MARKET && <PersonalMarketSources key={user?.id ?? LOCAL_PERSONAL_PROVIDER_OWNER_ID} owner={user?.id ?? LOCAL_PERSONAL_PROVIDER_OWNER_ID} />}
                        {SELF_HOSTED_MARKET && <PersonalSecurityManager />}
                        {TIINGO_CONNECTABLE && <FinancialProviderManagerV124 />}
                        <div className="settings-provider-section" aria-label={t('AI Providers')}>
                          <div>
                            <div className="section-title">{t('AI Providers')}</div>
                            <div className="panel-subtitle">
                              {t('Personal AI keys are used only for the explicitly reviewed document and transaction import.')}
                            </div>
                          </div>
                          {user ? <AIProviderManager /> : <LocalAIProviderManager />}
                        </div>
                      </>
                    ) : (
                      <div className="card settings-provider-signin" role="status">
                        <div className="section-title">{t('Personal provider connections')}</div>
                        <p>{INVESTATLAS_DEPLOYMENT_MODE === 'public_demo'
                          ? t('Read-only demo snapshot')
                          : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
                          ? t('Start Local Workspace to connect your own session-only API keys.')
                          : t('Sign in to connect and manage your own financial or AI API keys. Anonymous Demo and Local Workspaces never store provider keys.')}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === 'account' && (
              INVESTATLAS_DEPLOYMENT_MODE === 'public_demo' ? (
                <div className="card" role="status">
                  <div className="section-title">{t('Read-only demo snapshot')}</div>
                  <p>{t('Synthetic portfolio examples — not live market observations or personal data.')}</p>
                </div>
              ) : <AccountSettings
                profile={accountProfile}
                draft={accountDraft}
                setDraft={setAccountDraft}
                onSave={signInLocally}
                onSignOut={() => void handleSignOut()}
                onDelete={handleDeleteAccount}
                canDeleteAccount={
                  !isDemoSnapshot && Boolean(user || accountProfile.signedIn)
                }
                isCloudAccount={Boolean(user)}
              />
            )}

            {activeTab === 'about' && (
              <HelpAboutSettings />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
