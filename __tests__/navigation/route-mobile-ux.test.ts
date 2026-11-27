import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateAppText } from '@/lib/i18n/app-localization';

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('route and mobile navigation trust states', () => {
  it('provides shared loading, error, and not-found coverage', () => {
    const loading = source('src/app/loading.tsx');
    const error = source('src/app/error.tsx');
    const notFound = source('src/app/not-found.tsx');

    for (const routeState of [loading, error, notFound]) {
      expect(routeState).toContain("import RouteState from '@/components/layout/route-state'");
    }
    expect(loading).toContain('kind="loading"');
    expect(error).toContain('kind="error"');
    expect(error).toContain('onRetry={reset}');
    expect(error).not.toContain('error.message');
    expect(error).not.toContain('console.error');
    expect(notFound).toContain('kind="not-found"');
  });

  it('keeps the disabled report generator out of navigation and explains direct visits honestly', () => {
    const routes = source('src/lib/navigation/routes.ts');
    const reports = source('src/app/reports/page.tsx');

    expect(routes).not.toContain("href: '/reports'");
    expect(reports).toContain('Reports are not available in this demo release.');
    expect(reports).toContain('did not use the canonical Firebase data path');
    expect(reports).not.toContain("fetch('/api/reports/export'");
    expect(reports).toContain('href="/settings#account"');
    expect(source('src/app/settings/page.tsx')).toContain("hash.includes('account')");
  });

  it('uses the shared accessible dialog behavior for the mobile More sheet', () => {
    const shell = source('src/components/layout/app-shell.tsx');
    const dialog = source('src/components/ui/dialog.tsx');
    const css = source('src/app/globals.css');

    expect(shell).toContain('<Dialog');
    expect(shell).toContain('aria-haspopup="dialog"');
    expect(shell).toContain('aria-expanded={isMenuOpen}');
    expect(shell).toContain('aria-controls="mobile-navigation-dialog"');
    expect(shell).toContain('id="mobile-navigation-dialog"');
    expect(shell).toContain('initialFocusRef={closeButtonRef}');
    expect(shell).toContain("aria-label={t('Close menu')}");
    expect(dialog).toContain("event.key === 'Escape'");
    expect(dialog).toContain("event.key !== 'Tab'");
    expect(dialog).toContain('if (previous?.isConnected && previous !== document.body) previous.focus()');
    expect(dialog).toContain('returnFocusRef?.current?.focus()');
    expect(css).toMatch(/\.mobile-menu-close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('overscroll-behavior: contain');
  });

  it('preserves the personal browser session during mobile topbar refresh', () => {
    const shell = source('src/components/layout/app-shell.tsx');
    const topBar = shell.split('function MobileTopBar() {')[1]?.split('export default function AppShell')[0];
    expect(topBar).toContain('onClick={() => router.refresh()}');
    expect(topBar).not.toContain('window.location.reload()');
  });

  it('keeps login password visibility keyboard-accessible and announces auth outcomes', () => {
    const login = source('src/app/login/page.tsx');
    const passwordToggle = login.split('className="login-password-toggle"')[1]?.split('</button>')[0];
    expect(passwordToggle).toBeDefined();
    expect(passwordToggle).not.toContain('tabIndex={-1}');
    expect(passwordToggle).toContain('aria-controls="password"');
    expect(passwordToggle).toContain('aria-pressed={showPassword}');
    expect(passwordToggle).toContain("aria-label={showPassword ? t('Hide password') : t('Show password')}");
    expect(login).toContain('className="login-alert error" role="alert"');
    expect(login).toContain('className="login-alert success" role="status"');
    expect(login).toContain("aria-label={isLogin ? t('Sign in') : t('Create account')}");
    expect(login).toContain("aria-label={t('Send reset link')}");
    expect(login).toContain('aria-busy={loading}');
  });

  it('associates transaction currency controls with visible labels and names the close button', () => {
    const modal = source('src/components/layout/global-add-modal.tsx');
    for (const field of [
      'bank-transaction-type',
      'bank-transaction-currency',
      'dividend-transaction-date',
      'dividend-transaction-currency',
      'asset-transaction-currency',
    ]) {
      expect(modal.match(new RegExp(`htmlFor="${field}"`, 'g'))).toHaveLength(1);
      expect(modal.match(new RegExp(`id="${field}"`, 'g'))).toHaveLength(1);
    }
    expect(modal).toContain("aria-label={t('Close')}");
  });

  it('names sidebar controls and restores focus after Escape', () => {
    const sidebar = source('src/components/layout/sidebar.tsx');
    expect(sidebar).toContain("aria-label={t('Expand sidebar')}");
    expect(sidebar).toContain("aria-label={t('Collapse sidebar')}");
    expect(sidebar).toContain("event.key !== 'Escape'");
    expect(sidebar).toContain('accountMenuTriggerRef.current?.focus()');
  });

  test.each([
    'Refresh current view',
    'Expand sidebar',
    'Collapse sidebar',
    'Open navigation menu',
    'Close navigation menu',
    'Navigate to another area of InvestAtlas.',
    'Loading InvestAtlas',
    'Preparing your workspace.',
    'Something went wrong',
    'Page not found',
    'Reports are not available in this demo release.',
    'Open account data',
  ])('localizes %s in German and Arabic', (text) => {
    expect(translateAppText(text, 'de')).not.toBe(text);
    expect(translateAppText(text, 'ar')).not.toBe(text);
  });
});
