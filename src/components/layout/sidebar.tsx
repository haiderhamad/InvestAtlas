'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  dashboardLink,
  accountsLink,
  budgetLink,
  investmentGroup,
  toolsGroup,
  type NavItem,
  type NavGroup,
} from '@/lib/navigation/routes';
import {
  ChevronLeft,
  ChevronRight,
  Gem,
  MoonStar,
  SunMedium,
  MoreVertical,
  LogOut,
  CircleHelp,
  MessageSquareMore,
  UserRound,
  Languages,
  LogIn,
  Settings,
} from 'lucide-react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  resolveThemePreference,
  type LanguagePreference,
  type LocalAccountProfile,
  type ThemePreference,
} from '@/lib/preferences/app-preferences';
import type { AnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';

const expandedNav: Array<{ type: 'link'; item: NavItem } | { type: 'group'; group: NavGroup }> = [
  { type: 'link', item: dashboardLink },
  { type: 'group', group: investmentGroup },
  { type: 'link', item: accountsLink },
  { type: 'link', item: budgetLink },
  { type: 'group', group: toolsGroup },
];

const collapsedNav: NavItem[] = [
  dashboardLink,
  ...investmentGroup.items,
  accountsLink,
  budgetLink,
  ...toolsGroup.items,
];

const PRODUCT_NAME = 'InvestAtlas';
const NATIVE_LANGUAGE_NAMES = {
  en: 'English',
  de: 'Deutsch',
  ar: 'العربية',
} as const;

function isPathActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export default function Sidebar({
  isCollapsed,
  toggleSidebar,
  onNavClick,
  themePreference = 'dark',
  onThemeToggle,
  languagePreference = 'en',
  onLanguageChange,
  accountProfile,
  anonymousWorkspaceMode,
  onSignOutLocal,
}: {
  isCollapsed?: boolean;
  toggleSidebar?: () => void;
  onNavClick?: () => void;
  themePreference?: ThemePreference;
  onThemeToggle?: () => void;
  languagePreference?: LanguagePreference;
  onLanguageChange?: (language: LanguagePreference) => void;
  accountProfile: LocalAccountProfile;
  anonymousWorkspaceMode?: AnonymousWorkspaceMode;
  onSignOutLocal?: () => void;
}) {
  const { t } = useAppTranslation();
  const pathname = usePathname();
  const resolvedTheme = resolveThemePreference(themePreference);
  const activeGroupIds = useMemo(
    () =>
      new Set(
        [investmentGroup, toolsGroup]
          .filter((group) => group.items.some((item) => isPathActive(pathname, item.href)))
          .map((group) => group.id),
      ),
    [pathname],
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Sync open state when navigation happens
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setOpenGroups((current) => {
        const next = { ...current };
        activeGroupIds.forEach((id) => {
          if (next[id] === undefined) {
            next[id] = true;
          }
        });
        return next;
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeGroupIds]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // Escape closes the account menu and restores focus to its trigger.
  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAccountMenuOpen(false);
      accountMenuTriggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [accountMenuOpen]);

  const accountName = accountProfile.signedIn
    ? accountProfile.fullName
    : anonymousWorkspaceMode === 'demo_snapshot'
      ? t('Read-only demo snapshot')
      : t('Local workspace');
  const accountMeta = accountProfile.signedIn
    ? accountProfile.email
    : anonymousWorkspaceMode === 'demo_snapshot'
      ? t('Illustrative Demo Data')
      : t('Signed out');
  const nextThemeLabel =
    resolvedTheme === 'light' ? t('Switch to dark mode') : t('Switch to light mode');

  const renderNavLink = (item: NavItem, className = 'sidebar-link') => {
    const Icon = item.icon;
    const isActive = isPathActive(pathname, item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${className} ${isActive ? 'active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        title={isCollapsed ? item.label : undefined}
        onClick={onNavClick}
      >
        <Icon size={18} />
        <span>{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div
        className="sidebar-logo"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          padding: isCollapsed ? '20px 0' : '20px 24px',
        }}
      >
        <Link
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
        >
          <Gem size={20} style={{ color: 'var(--accent-blue)' }} />
          {!isCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>{PRODUCT_NAME}</span>
              <span style={{ fontSize: 9, opacity: 0.6, letterSpacing: '0.05em', fontWeight: 600, color: 'var(--accent-blue)', textTransform: 'uppercase' }}>
                {t('Shariah-aware')}
              </span>
            </div>
          )}
        </Link>
        {!isCollapsed && toggleSidebar && (
          <button
            onClick={toggleSidebar}
            type="button"
            aria-label={t('Collapse sidebar')}
            title={t('Collapse sidebar')}
            className="btn-icon"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {isCollapsed && toggleSidebar && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 12px 0' }}>
          <button
            onClick={toggleSidebar}
            type="button"
            aria-label={t('Expand sidebar')}
            title={t('Expand sidebar')}
            className="btn-icon"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '50%',
              padding: '6px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      <nav className="sidebar-nav">
        {isCollapsed
          ? collapsedNav.map((item) => renderNavLink(item))
          : expandedNav.map((entry) => {
              if (entry.type === 'link') {
                return renderNavLink(entry.item);
              }

              const group = entry.group;
              const groupActive = activeGroupIds.has(group.id);
              const isOpen = openGroups[group.id] ?? group.defaultOpen ?? false;
              const GroupIcon = group.icon;

              return (
                <div key={group.id} className={`sidebar-nav-group ${groupActive ? 'active' : ''}`}>
                  <button
                    type="button"
                    className={`sidebar-group-trigger ${groupActive ? 'active' : ''}`}
                    onClick={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [group.id]: !isOpen,
                      }))
                    }
                    aria-expanded={isOpen}
                  >
                    <span className="sidebar-group-label">
                      <GroupIcon size={18} />
                      <span>{t(group.label)}</span>
                    </span>
                    <ChevronRight
                      size={16}
                      className={`sidebar-group-chevron ${isOpen ? 'open' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="sidebar-group-items">
                      {group.items.map((item) => renderNavLink(item, 'sidebar-group-item'))}
                    </div>
                  )}
                </div>
              );
            })}
      </nav>

      {!isCollapsed && (
        <div className="sidebar-footer">
          <div className="sidebar-footer-note">
            {t('InvestAtlas v1.2.4')}
            <br />
            {t('Multi-asset, not tax advice')}
          </div>

          <div className="sidebar-account-shell" ref={accountMenuRef}>
            <div className="sidebar-account-card">
              <div className="sidebar-account-avatar">
                <UserRound size={16} />
              </div>
              <div className="sidebar-account-copy">
                <div className="sidebar-account-name">{accountName}</div>
                <div className="sidebar-account-meta">{accountMeta}</div>
              </div>
              <button
                type="button"
                className="sidebar-account-menu-trigger"
                ref={accountMenuTriggerRef}
                aria-label={t(accountMenuOpen ? 'Close menu' : 'Open menu')}
                aria-expanded={accountMenuOpen}
                onClick={() => setAccountMenuOpen((current) => !current)}
              >
                <MoreVertical size={16} />
              </button>
            </div>

            {accountMenuOpen && (
              <div className="sidebar-account-menu">
                <button
                  type="button"
                  className="sidebar-account-menu-item"
                  onClick={() => {
                    onThemeToggle?.();
                    setAccountMenuOpen(false);
                  }}
                >
                  {resolvedTheme === 'light' ? <MoonStar size={15} /> : <SunMedium size={15} />}
                  <span>{nextThemeLabel}</span>
                </button>

                <Link
                  href="/settings"
                  className="sidebar-account-menu-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onNavClick?.();
                  }}
                >
                  <Settings size={15} />
                  <span>{t('Settings')}</span>
                </Link>

                <Link
                  href="/settings#data-sources"
                  className="sidebar-account-menu-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onNavClick?.();
                  }}
                >
                  <CircleHelp size={15} />
                  <span>{t('Help & data')}</span>
                </Link>

                <Link
                  href="/settings#help-support"
                  className="sidebar-account-menu-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onNavClick?.();
                  }}
                >
                  <MessageSquareMore size={15} />
                  <span>{t('Feedback')}</span>
                </Link>


                <div className="sidebar-account-menu-divider" />

                <label className="sidebar-account-menu-label">
                  <Languages size={14} />
                  <span>{t('Language')}</span>
                </label>
                <select
                  className="select sidebar-account-language-select"
                  value={languagePreference}
                  onChange={(event) => onLanguageChange?.(event.target.value as LanguagePreference)}
                >
                  <option value="en" translate="no">{NATIVE_LANGUAGE_NAMES.en}</option>
                  <option value="de" translate="no">{NATIVE_LANGUAGE_NAMES.de}</option>
                  <option value="ar" translate="no">{NATIVE_LANGUAGE_NAMES.ar}</option>
                </select>

                <div className="sidebar-account-menu-divider" />

                {accountProfile.signedIn ? (
                  <button
                    type="button"
                    className="sidebar-account-menu-item danger"
                    onClick={() => {
                      onSignOutLocal?.();
                      setAccountMenuOpen(false);
                    }}
                  >
                    <LogOut size={15} />
                    <span>{t('Sign out')}</span>
                  </button>
                ) : INVESTATLAS_DEPLOYMENT_MODE !== 'public_demo' ? (
                  <Link
                    href="/login"
                    className="sidebar-account-menu-item"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onNavClick?.();
                    }}
                  >
                    <LogIn size={15} />
                    <span>{t('Sign in')}</span>
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {isCollapsed && (
        <div className="sidebar-collapsed-footer" ref={accountMenuRef}>
          <Link
            href="/settings"
            className="sidebar-collapsed-action"
            title={t('Settings')}
            aria-label={t('Settings')}
            onClick={onNavClick}
          >
            <Settings size={16} />
          </Link>
          <button
            type="button"
            className="sidebar-collapsed-action"
            title={t(accountMenuOpen ? 'Close menu' : 'Open menu')}
            ref={accountMenuTriggerRef}
            aria-label={t(accountMenuOpen ? 'Close menu' : 'Open menu')}
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((current) => !current)}
          >
            <MoreVertical size={16} />
          </button>

          {accountMenuOpen && (
            <div className="sidebar-account-menu collapsed">
              <button
                type="button"
                className="sidebar-account-menu-item"
                onClick={() => {
                  onThemeToggle?.();
                  setAccountMenuOpen(false);
                }}
              >
                {resolvedTheme === 'light' ? <MoonStar size={15} /> : <SunMedium size={15} />}
                <span>{nextThemeLabel}</span>
              </button>
              <Link
                href="/settings#data-sources"
                className="sidebar-account-menu-item"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onNavClick?.();
                }}
              >
                <CircleHelp size={15} />
                <span>{t('Help & data')}</span>
              </Link>
              {accountProfile.signedIn ? (
                <button
                  type="button"
                  className="sidebar-account-menu-item danger"
                  onClick={() => {
                    onSignOutLocal?.();
                    setAccountMenuOpen(false);
                  }}
                >
                  <LogOut size={15} />
                  <span>{t('Sign out')}</span>
                </button>
              ) : INVESTATLAS_DEPLOYMENT_MODE !== 'public_demo' ? (
                <Link
                  href="/login"
                  className="sidebar-account-menu-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onNavClick?.();
                  }}
                >
                  <LogIn size={15} />
                  <span>{t('Sign in')}</span>
                </Link>
              ) : null}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
