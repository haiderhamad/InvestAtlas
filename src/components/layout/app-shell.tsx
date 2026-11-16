'use client';

import {
  APP_PREFERENCES_EVENT,
  applyLanguagePreference,
  applyThemePreference,
  DEFAULT_APP_PREFERENCES,
  type LanguagePreference,
  type LocalAccountProfile,
  readAppPreferences,
  resolveThemePreference,
  writeAppPreferences,
  type ThemePreference,
} from '@/lib/preferences/app-preferences';
import { useMobileViewport } from '@/lib/ui/use-mobile-viewport';
import { useAuth } from '@/lib/auth/auth-context';
import {
  CLOUD_DATA_STATUS_EVENT,
  getCloudDataStatus,
  type CloudDataStatus,
} from '@/lib/storage/cloud-data-status';
import {
  ANONYMOUS_WORKSPACE_MODE_EVENT,
  readAnonymousWorkspaceMode,
  writeAnonymousWorkspaceMode,
  type AnonymousWorkspaceMode,
} from '@/lib/demo/workspace-mode';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { readPublicSourceConsent, PUBLIC_SOURCE_CONSENT_EVENT } from '@/lib/financial-data/providers/public-source-consent';
import { publicMarketCopy } from '@/components/settings/public-market-consent-copy';
import { PersonalPriceAttribution } from '@/components/financial/personal-price-attribution';
import {
  hasTiingoBrowserCredential as hasAlphaVantageSessionCredential,
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT as PERSONAL_MARKET_PROVIDER_CHANGE_EVENT,
} from '@/lib/financial-data/providers/tiingo-browser';
import {
  resolvePersonalFinancialProviderAvailability,
  resolvePersonalProviderHintMode,
} from '@/lib/financial-data/providers/personal-provider-availability';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  LayoutDashboard,
  MoreHorizontal,
  PieChart,
  RefreshCw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { LegalAcceptanceGate } from '@/components/legal/legal-acceptance-gate';
import Dialog from '@/components/ui/dialog';
import Sidebar from './sidebar';
import LocalizationEffects from './localization-effects';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  dashboardLink,
  investmentGroup,
  toolsGroup,
  accountsLink,
  budgetLink,
  type NavItem,
} from '@/lib/navigation/routes';
import {
  X,
  ChevronRight,
  LogOut,
  User,
  Settings as SettingsIcon,
  LogIn,
} from 'lucide-react';

type MobileTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  activeHrefs?: string[];
};

const mobileTabs: MobileTab[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portfolio', icon: PieChart },
  { href: '/transactions', label: 'Ledger', icon: ArrowLeftRight },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  {
    href: '#menu', // Changed to anchor for menu trigger logic
    label: 'More',
    icon: MoreHorizontal,
    activeHrefs: ['/settings', '/tax', '/accounts', '/budget', '/dividends', '/watchlists', '/charts', '/savings-plan', '/ai-analysis', '/strategy-lab', '/settings/coins'],
  },
];

const mobileAllowedRoutes = [
  '/',
  '/accounts',
  '/ai-analysis',
  '/analytics',
  '/auth',
  '/budget',
  '/charts',
  '/dividends',
  '/login',
  '/portfolio',
  '/reports',
  '/savings-plan',
  '/settings',
  '/settings/coins',
  '/settings/data-providers',
  '/strategy-lab',
  '/tax',
  '/transactions',
  '/verify',
  '/watchlists',
];

function isPathActive(pathname: string, href: string, activeHrefs: string[] = []) {
  const paths = [href, ...activeHrefs];
  return paths.some((path) => (path === '/' ? pathname === '/' : pathname.startsWith(path)));
}

function isMobileRouteAllowed(pathname: string) {
  return mobileAllowedRoutes.some((href) => (href === '/' ? pathname === '/' : pathname.startsWith(href)));
}

function MobileTabBar({ isMenuOpen, onMoreClick }: { isMenuOpen: boolean; onMoreClick: () => void }) {
  const pathname = usePathname();
  const { t } = useAppTranslation();

  return (
    <nav className="mobile-tab-bar" aria-label={t('Mobile app navigation')}>
      {mobileTabs.map(({ href, label, icon: Icon, activeHrefs }) => {
        const isActive = isPathActive(pathname, href, activeHrefs);
        const isMenuTrigger = href === '#menu';

        if (isMenuTrigger) {
          return (
            <button
              key={href}
              onClick={onMoreClick}
              className={`mobile-tab-link ${(isActive || isMenuOpen) ? 'active' : ''}`}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-navigation-dialog"
              aria-label={t(isMenuOpen ? 'Close navigation menu' : 'Open navigation menu')}
            >
              <span className="mobile-tab-icon" aria-hidden="true">
                <Icon size={19} strokeWidth={2.35} />
              </span>
              <span className="mobile-tab-label">{t(label)}</span>
            </button>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            className={`mobile-tab-link ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              <Icon size={19} strokeWidth={2.35} />
            </span>
            <span className="mobile-tab-label">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MobileMenuOverlay({
  isOpen,
  onClose,
  accountProfile,
  anonymousWorkspaceMode,
  onSignOut,
}: {
  isOpen: boolean;
  onClose: () => void;
  accountProfile: LocalAccountProfile;
  anonymousWorkspaceMode: AnonymousWorkspaceMode;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const { t } = useAppTranslation();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isDemoSnapshot = !accountProfile.signedIn
    && anonymousWorkspaceMode === 'demo_snapshot';

  const renderMenuItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isPathActive(pathname, item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`mobile-menu-item ${isActive ? 'active' : ''}`}
        onClick={onClose}
        aria-current={isActive ? 'page' : undefined}
      >
        <div className="mobile-menu-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <span className="mobile-menu-label">{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <Dialog
      id="mobile-navigation-dialog"
      open={isOpen}
      onClose={onClose}
      labelledBy="mobile-menu-title"
      describedBy="mobile-menu-description"
      className="mobile-menu-overlay is-open"
      contentClassName="mobile-menu-content"
      initialFocusRef={closeButtonRef}
    >
      <p id="mobile-menu-description" className="visually-hidden">
        {t('Navigate to another area of InvestAtlas.')}
      </p>
        <div className="mobile-menu-header">
          <h2 id="mobile-menu-title" className="mobile-menu-title">{t('Quick Navigation')}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="mobile-menu-close"
            onClick={onClose}
            aria-label={t('Close menu')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mobile-menu-section">
          <div className="mobile-menu-section-title">{t('Investments')}</div>
          <div className="mobile-menu-grid">
            {investmentGroup.items.map(renderMenuItem)}
          </div>
        </div>

        <div className="mobile-menu-section">
          <div className="mobile-menu-section-title">{t('Tools & AI')}</div>
          <div className="mobile-menu-grid">
            {toolsGroup.items.map(renderMenuItem)}
            {renderMenuItem(budgetLink)}
            {renderMenuItem(accountsLink)}
          </div>
        </div>

        <div className="mobile-menu-footer">
          <Link href="/settings" className="mobile-menu-action" onClick={onClose}>
            <SettingsIcon size={18} aria-hidden="true" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{t('App Settings')}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{t('Theme, language, and data sync')}</div>
            </div>
            <ChevronRight className="mobile-menu-chevron" size={14} style={{ opacity: 0.5 }} aria-hidden="true" />
          </Link>

          <div className="mobile-menu-action">
            <User size={18} aria-hidden="true" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>
                {accountProfile.signedIn
                  ? accountProfile.fullName
                  : t(isDemoSnapshot ? 'Read-only demo snapshot' : 'Local Mode')}
              </div>
              <div className={accountProfile.signedIn ? 'mobile-menu-account-email' : undefined} style={{ fontSize: 11, opacity: 0.7 }}>
                {accountProfile.signedIn
                  ? accountProfile.email
                  : t(isDemoSnapshot ? 'Illustrative Demo Data' : 'Data stored locally')}
              </div>
            </div>
            {accountProfile.signedIn ? (
              <button
                type="button"
                onClick={() => { onSignOut(); onClose(); }} 
                className="mobile-menu-session-action"
                aria-label={t('Sign Out')}
              >
                <LogOut size={17} aria-hidden="true" />
              </button>
            ) : INVESTATLAS_DEPLOYMENT_MODE !== 'public_demo' ? (
              <Link 
                href="/login" 
                className="mobile-menu-session-action mobile-menu-sign-in"
                onClick={onClose}
              >
                <LogIn size={17} aria-hidden="true" />
                <span>{t('Sign in')}</span>
              </Link>
            ) : null}
          </div>
        </div>
    </Dialog>
  );
}

function MobileTopBar() {
  const { t } = useAppTranslation();
  const router = useRouter();
  return (
    <header className="mobile-app-topbar" aria-label={t('Mobile app header')}>
      <Link href="/settings" className="mobile-topbar-action" aria-label={t('Open settings')}>
        <Settings size={19} strokeWidth={2.3} aria-hidden="true" />
      </Link>
      <Link href="/" className="mobile-topbar-brand" aria-label={t('InvestAtlas dashboard')}>
        {t('InvestAtlas')}
      </Link>
      <button
        type="button"
        className="mobile-topbar-action mobile-topbar-sync"
        aria-label={t('Refresh current view')}
        onClick={() => router.refresh()}
      >
        <RefreshCw size={19} strokeWidth={2.3} />
      </button>
    </header>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobilePrimaryRoute = isMobileRouteAllowed(pathname);
  const isMobileViewport = useMobileViewport();
  const shouldShowDesktopOnlyNotice = !isMobilePrimaryRoute && isMobileViewport === true;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const [accountProfile, setAccountProfile] = useState<LocalAccountProfile>(DEFAULT_APP_PREFERENCES.accountProfile);
  const [cloudDataStatus, setCloudDataStatus] = useState<CloudDataStatus>(
    () => getCloudDataStatus(),
  );
  const [coinGeckoActive, setCoinGeckoActive] = useState(false);
  const [anonymousWorkspaceMode, setAnonymousWorkspaceMode] = useState<AnonymousWorkspaceMode>('demo_snapshot');
  const [isPersonalFinancialProviderAvailable, setIsPersonalFinancialProviderAvailable] = useState<boolean | null>(null);
  const [hasPersonalFinancialProvider, setHasPersonalFinancialProvider] = useState<boolean | null>(null);
  const [publicSourceApproval, setPublicSourceApproval] = useState<boolean | null>(null);
  const [isPersonalProviderHintDismissed, setIsPersonalProviderHintDismissed] = useState<boolean | null>(null);
  const [isOpeningDemoSnapshot, setIsOpeningDemoSnapshot] = useState(false);
  const [demoSnapshotTransitionError, setDemoSnapshotTransitionError] = useState(false);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t, language: languagePreference } = useAppTranslation();
  const demoDataAsOf = new Intl.DateTimeFormat(
    languagePreference === 'ar'
      ? 'ar-SA'
      : languagePreference === 'de'
        ? 'de-DE'
        : 'en-US',
    { dateStyle: 'medium', timeZone: 'UTC', calendar: 'gregory' },
  ).format(new Date(INVESTATLAS_SHOWCASE_SNAPSHOT.manifest.dataAsOf));

  useEffect(() => {
    let mounted = true;
    void fetch('/api/data-providers')
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!mounted) return;
        if (!Array.isArray(value)) {
          setCoinGeckoActive(false);
          setIsPersonalFinancialProviderAvailable(null);
          return;
        }
        const active = value.some((provider) => {
          if (!provider || typeof provider !== 'object') return false;
          const candidate = provider as { id?: unknown; isActive?: unknown };
          return candidate.id === 'coingecko_public' && candidate.isActive === true;
        });
        setCoinGeckoActive(active);
        setIsPersonalFinancialProviderAvailable(
          resolvePersonalFinancialProviderAvailability(value),
        );
      })
      .catch(() => {
        if (mounted) {
          setCoinGeckoActive(false);
          setIsPersonalFinancialProviderAvailable(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (user) return;
    const syncWorkspaceMode = () => setAnonymousWorkspaceMode(readAnonymousWorkspaceMode());
    syncWorkspaceMode();
    window.addEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncWorkspaceMode);
    window.addEventListener('storage', syncWorkspaceMode);
    return () => {
      window.removeEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncWorkspaceMode);
      window.removeEventListener('storage', syncWorkspaceMode);
    };
  }, [user]);

  useEffect(() => {
    const owner = INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' ? user?.id
      : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && anonymousWorkspaceMode === 'local_workspace'
        ? LOCAL_PERSONAL_PROVIDER_OWNER_ID : null;
    if (!owner) {
      setPublicSourceApproval(null);
      return;
    }
    const sync = () => setPublicSourceApproval(readPublicSourceConsent(owner).length > 0);
    sync();
    window.addEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
  }, [user?.id, anonymousWorkspaceMode]);

  useEffect(() => {
    if (!user || pathname !== '/') {
      setHasPersonalFinancialProvider(null);
      setIsPersonalProviderHintDismissed(null);
      return;
    }
    const dismissalKey = `investatlas.personal-financial-provider-hint.v2.${user.id}`;
    setIsPersonalProviderHintDismissed(window.localStorage.getItem(dismissalKey) === 'dismissed');
    const syncConnection = () => {
      setHasPersonalFinancialProvider(hasAlphaVantageSessionCredential(user.id));
    };
    syncConnection();
    window.addEventListener(PERSONAL_MARKET_PROVIDER_CHANGE_EVENT, syncConnection);
    return () => {
      window.removeEventListener(PERSONAL_MARKET_PROVIDER_CHANGE_EVENT, syncConnection);
    };
  }, [pathname, user]);

  // Load initial state from localStorage if available
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const saved = localStorage.getItem('sidebar-collapsed');
      if (saved) {
        setIsCollapsed(saved === 'true');
      }

      const preferences = readAppPreferences();
      setThemePreference(preferences.theme);
      // setLanguagePreference is no longer needed
      setAccountProfile(preferences.accountProfile);
      applyThemePreference(preferences.theme);
      applyLanguagePreference(preferences.language);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const syncCloudDataStatus = () => {
      setCloudDataStatus(getCloudDataStatus());
    };

    syncCloudDataStatus();
    window.addEventListener(CLOUD_DATA_STATUS_EVENT, syncCloudDataStatus);
    return () => {
      window.removeEventListener(CLOUD_DATA_STATUS_EVENT, syncCloudDataStatus);
    };
  }, []);

  // Keep the browser presentation profile aligned with Firebase Auth.
  useEffect(() => {
    if (!user) {
      return;
    }

    const authProfile: LocalAccountProfile = {
      signedIn: true,
      fullName: user.fullName || user.email?.split('@')[0] || 'User',
      email: user.email || '',
    };

    const timeoutId = window.setTimeout(() => {
      setAccountProfile(authProfile);
      writeAppPreferences({ accountProfile: authProfile });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [user]);

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = readAppPreferences();
      setThemePreference(preferences.theme);
      // setLanguagePreference is no longer needed
      setAccountProfile(preferences.accountProfile);
      applyThemePreference(preferences.theme);
      applyLanguagePreference(preferences.language);
    };

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemThemeChange = () => {
      if (readAppPreferences().theme === 'system') {
        syncPreferences();
      }
    };

    window.addEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
    window.addEventListener('storage', syncPreferences);
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      window.removeEventListener(APP_PREFERENCES_EVENT, syncPreferences as EventListener);
      window.removeEventListener('storage', syncPreferences);
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', String(newState));
  };

  const toggleTheme = () => {
    const nextTheme =
      resolveThemePreference(themePreference) === 'light' ? 'dark' : 'light';
    setThemePreference(nextTheme);
    applyThemePreference(nextTheme);
    writeAppPreferences({ theme: nextTheme });
  };

  const changeLanguage = (nextLanguage: LanguagePreference) => {
    // setLanguagePreference is no longer needed as useAppTranslation will update via writeAppPreferences event
    applyLanguagePreference(nextLanguage);
    writeAppPreferences({ language: nextLanguage });
  };

  const signOutLocalAccount = async () => {
    if (user) {
      await signOut();
      router.push('/login');
      return;
    }

    const clearedProfile: LocalAccountProfile = {
      signedIn: false,
      fullName: '',
      email: '',
    };

    setAccountProfile(clearedProfile);
    writeAppPreferences({ accountProfile: clearedProfile });
    router.push('/login');
  };

  const hasUnavailableCloudData =
    Boolean(user) && cloudDataStatus.unavailableScopes.length > 0;
  const hasPendingCloudData =
    Boolean(user)
    && !hasUnavailableCloudData
    && cloudDataStatus.pendingScopes.length > 0;
  const shouldGateCloudWorkspace =
    Boolean(user)
    && cloudDataStatus.blockedScopes.length > 0
    && !pathname.startsWith('/settings');
  const personalProviderHintMode = resolvePersonalProviderHintMode({
    isSignedIn: Boolean(user),
    pathname,
    providerAvailability: isPersonalFinancialProviderAvailable,
    hasConnection: hasPersonalFinancialProvider,
    dismissed: isPersonalProviderHintDismissed,
  });

  const switchAnonymousWorkspace = (nextMode: AnonymousWorkspaceMode) => {
    writeAnonymousWorkspaceMode(nextMode);
    setAnonymousWorkspaceMode(nextMode);
    window.location.reload();
  };

  const dismissPersonalProviderHint = () => {
    if (!user) return;
    window.localStorage.setItem(`investatlas.personal-financial-provider-hint.v2.${user.id}`, 'dismissed');
    setIsPersonalProviderHintDismissed(true);
  };

  const openDemoSnapshot = async () => {
    try {
      setIsOpeningDemoSnapshot(true);
      setDemoSnapshotTransitionError(false);
      await signOut();
      writeAnonymousWorkspaceMode('demo_snapshot');
      router.replace('/');
      router.refresh();
    } catch {
      setDemoSnapshotTransitionError(true);
      setIsOpeningDemoSnapshot(false);
    }
  };

  return (
    <div className={`app-shell ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
      <LegalAcceptanceGate />
      <LocalizationEffects language={languagePreference} />
      <Sidebar
        isCollapsed={isCollapsed}
        toggleSidebar={toggleSidebar}
        themePreference={themePreference}
        onThemeToggle={toggleTheme}
        languagePreference={languagePreference}
        onLanguageChange={changeLanguage}
        accountProfile={INVESTATLAS_DEPLOYMENT_MODE === 'public_demo' ? DEFAULT_APP_PREFERENCES.accountProfile : accountProfile}
        anonymousWorkspaceMode={!user ? anonymousWorkspaceMode : undefined}
        onSignOutLocal={signOutLocalAccount}
      />

      {isMobileViewport && (
        <>
          <MobileTopBar />
          <MobileMenuOverlay 
            isOpen={isMenuOpen} 
            onClose={() => setIsMenuOpen(false)} 
            accountProfile={INVESTATLAS_DEPLOYMENT_MODE === 'public_demo' ? DEFAULT_APP_PREFERENCES.accountProfile : accountProfile}
            anonymousWorkspaceMode={anonymousWorkspaceMode}
            onSignOut={signOutLocalAccount}
          />
        </>
      )}

      <main className="main-content">
        {!user && anonymousWorkspaceMode === 'demo_snapshot' && (
          <aside className="workspace-mode-notice demo" role="status" aria-live="polite">
            <div className="workspace-mode-copy">
              <span className="badge badge-blue">{t('Illustrative Demo Data')}</span>
              <div>
                <strong>{t('Read-only demo snapshot')}</strong>
                <span>
                  {t('Synthetic portfolio examples — not live market observations or personal data.')}{' '}
                  {t('Data as of')}: {demoDataAsOf}.
                </span>
              </div>
            </div>
            {INVESTATLAS_DEPLOYMENT_MODE !== 'public_demo' && (
              <div className="workspace-mode-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => switchAnonymousWorkspace('local_workspace')}>
                  {t('Start Local Workspace')}
                </button>
                <Link href="/login" className="btn btn-ghost btn-sm">{t('Sign in')}</Link>
              </div>
            )}
          </aside>
        )}
        {!user && anonymousWorkspaceMode === 'local_workspace' && (
          <aside className="workspace-mode-notice local" role="status">
            <div className="workspace-mode-copy">
              <span className="badge badge-neutral">{t('Local Workspace')}</span>
              <details className="workspace-storage-details">
                <summary>{t('Data stays in this browser')}</summary>
                <span>{t('Local entries are separate from the read-only demo snapshot and are not synced to Firebase.')}</span>
              </details>
            </div>
            <div className="workspace-mode-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchAnonymousWorkspace('demo_snapshot')}>
                {t('View Demo')}
              </button>
              {INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal' && <Link href="/login" className="btn btn-secondary btn-sm">{t('Sign in')}</Link>}
            </div>
          </aside>
        )}
        {(pathname === '/' || pathname === '/charts') && publicSourceApproval === false && (
          (INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' && !!user)
          || (INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && !user && anonymousWorkspaceMode === 'local_workspace')
        ) && (
          <aside className="workspace-mode-notice personal" role="status">
            <div className="workspace-mode-copy">
              <span className="badge badge-neutral">{t(INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' ? 'Local Workspace' : 'Cloud Workspace')}</span>
              <div>
                <strong>{publicMarketCopy(languagePreference, 'bannerTitle')}</strong>
                <span>{publicMarketCopy(languagePreference, 'bannerBody')}</span>
              </div>
            </div>
            <div className="workspace-mode-actions">
              <Link href="/settings#data-sources" className="btn btn-secondary btn-sm">
                {publicMarketCopy(languagePreference, 'openSettings')}
              </Link>
            </div>
          </aside>
        )}
        {personalProviderHintMode && INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud' && (
          <aside className="workspace-mode-notice personal" role="status">
            <div className="workspace-mode-copy">
              <span className="badge badge-neutral">{t('Cloud Workspace')}</span>
              <div>
                <strong>
                  {t(personalProviderHintMode === 'connect'
                    ? 'Personal market data is not connected'
                    : 'Hosted market prices are unavailable')}
                </strong>
                <span>
                  {t(personalProviderHintMode === 'connect'
                    ? 'Connect a personal Tiingo token for supported raw daily US stock and ETF data. Your portfolio records remain available without it.'
                    : 'Hosted InvestAtlas currently has no connectable stock or crypto price provider. Your portfolio records remain available; market-dependent values stay unavailable rather than guessed.')}
                </span>
              </div>
            </div>
            <div className="workspace-mode-actions">
              <Link href="/settings#data-sources" className="btn btn-secondary btn-sm">
                {t(personalProviderHintMode === 'connect'
                  ? 'Connect provider'
                  : 'Review data availability')}
              </Link>
              {personalProviderHintMode === 'hosted_unavailable' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openDemoSnapshot()} disabled={isOpeningDemoSnapshot}>
                  {t(isOpeningDemoSnapshot ? 'Opening Demo Snapshot…' : 'Sign out and explore Demo Snapshot')}
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={dismissPersonalProviderHint} aria-label={t('Dismiss provider reminder')}>
                <X size={15} aria-hidden="true" /> {t('Dismiss')}
              </button>
            </div>
            {demoSnapshotTransitionError ? (
              <div className="workspace-mode-transition-error" role="alert">
                {t('Could not open the Demo Snapshot. Your Cloud Workspace was not changed.')}
              </div>
            ) : null}
          </aside>
        )}
        {user && pathname === '/' && hasPersonalFinancialProvider && !personalProviderHintMode && (
          <aside className="workspace-mode-notice personal" role="status">
            <div className="workspace-mode-copy">
              <span className="badge badge-neutral">{t('Cloud Workspace')}</span>
              <div>
                <strong>{t('Personal pricing uses latest available daily closes')}</strong>
                <span>{t('Tiingo personal data is raw, unadjusted end-of-day data. It is not realtime, and daily change is unavailable.')}</span>
              </div>
            </div>
            <div className="workspace-mode-actions">
              <Link href="/settings#data-sources" className="btn btn-ghost btn-sm">
                {t('Review data availability')}
              </Link>
            </div>
          </aside>
        )}
        {hasUnavailableCloudData && (
          <div
            role="alert"
            style={{
              margin: '16px 16px 0',
              padding: '12px 16px',
              border: '1px solid color-mix(in srgb, var(--red) 48%, transparent)',
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--red) 10%, var(--bg-card))',
              color: 'var(--text-primary)',
            }}
          >
            <strong>{t('Cloud data could not be loaded.')}</strong>{' '}
            {t('No cloud data was deleted. Access is temporarily unavailable; do not recreate the missing entries.')}
          </div>
        )}
        {hasPendingCloudData && (
          <div
            role="status"
            style={{
              margin: '16px 16px 0',
              padding: '12px 16px',
              border: '1px solid var(--surface-border-soft)',
              borderRadius: 12,
              background: 'var(--surface-soft)',
              color: 'var(--text-primary)',
            }}
          >
            <strong>{t('Loading cloud workspace…')}</strong>{' '}
            {t('Portfolio values and editing stay unavailable until every required cloud collection is ready.')}
          </div>
        )}
        {shouldGateCloudWorkspace ? (
          <div className="page-content animate-in">
            <div className="card" role={hasUnavailableCloudData ? 'alert' : 'status'}>
              <h2>
                {hasUnavailableCloudData
                  ? t('Cloud workspace unavailable')
                  : t('Loading cloud workspace…')}
              </h2>
              <p style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                {hasUnavailableCloudData
                  ? t('InvestAtlas is not treating unavailable cloud data as an empty portfolio. Editing, calculations, and exports are blocked to protect your data.')
                  : t('Portfolio values and editing stay unavailable until every required cloud collection is ready.')}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => window.location.reload()}
                >
                  {t('Retry cloud connection')}
                </button>
                <Link href="/settings#account" className="btn btn-secondary">
                  {t('Open account settings')}
                </Link>
              </div>
            </div>
          </div>
        ) : shouldShowDesktopOnlyNotice ? (
          <div className="mobile-only-notice">
            <div className="card">
              <h2>{t('InvestAtlas version 1.2.4')}</h2>
              <p>
                {t('Bulk import, export, and cleanup controls stay on desktop where there is enough room to review them safely.')}
              </p>
              <div className="mobile-notice-actions">
                <Link href="/" className="btn btn-primary">{t('Open Dashboard')}</Link>
                <Link href="/portfolio" className="btn btn-secondary">{t('Open Portfolio')}</Link>
              </div>
            </div>
          </div>
        ) : (
          children
        )}
        <footer className="app-legal-footer">
          <PersonalPriceAttribution owner={INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' ? user?.id ?? null
            : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && anonymousWorkspaceMode === 'local_workspace'
              ? LOCAL_PERSONAL_PROVIDER_OWNER_ID : null} />
          <nav aria-label={t('Legal and data information')}>
            <Link href="/terms">{t('Terms of Service')}</Link>
            <Link href="/privacy">{t('Privacy Policy')}</Link>
            <Link href="/financial-data-disclaimer">{t('Financial Data Disclaimer')}</Link>
          </nav>
          {INVESTATLAS_DEPLOYMENT_MODE === 'legacy' && coinGeckoActive
            && !user
            && anonymousWorkspaceMode === 'local_workspace'
            && (
            <div className="financial-data-attribution">
              <span>{t('Crypto price data:')}</span>{' '}
              <a
                href="https://www.coingecko.com/en/api"
                target="_blank"
                rel="noreferrer"
              >
                {t('Powered by CoinGecko API')}
              </a>
            </div>
          )}
        </footer>
      </main>

      {isMobileViewport && <MobileTabBar isMenuOpen={isMenuOpen} onMoreClick={() => setIsMenuOpen(!isMenuOpen)} />}
    </div>
  );
}
