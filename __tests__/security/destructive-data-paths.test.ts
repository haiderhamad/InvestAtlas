import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_DELETE_MAX_AUTH_AGE_MS,
  hasRecentAuthentication,
} from '@/lib/auth/recent-auth';

const projectFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('destructive data path safeguards', () => {
  it('does not allow a URL parameter to clear local transactions', () => {
    const layout = projectFile('src/app/layout.tsx');

    expect(layout).not.toContain('clearData=true');
    expect(layout).not.toContain("localStorage.removeItem('investatlas.manual-transactions')");
  });

  it.each([
    [
      'src/lib/transactions/manual-store.ts',
      'localStorage.removeItem(MANUAL_TRANSACTIONS_STORAGE_KEY)',
    ],
    [
      'src/lib/accounts/manual-accounts-store.ts',
      'localStorage.removeItem(MANUAL_ACCOUNTS_STORAGE_KEY)',
    ],
    [
      'src/lib/config/asset-risk-store.ts',
      'localStorage.removeItem(ASSET_RISK_STORAGE_KEY)',
    ],
  ])('keeps the Local Workspace intact in %s', (path, unsafeRemoval) => {
    expect(projectFile(path)).not.toContain(unsafeRemoval);
  });

  it('requires a recent authentication before account deletion', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');

    expect(hasRecentAuthentication('2026-07-25T11:59:00.000Z', now)).toBe(true);
    expect(
      hasRecentAuthentication(
        new Date(now - ACCOUNT_DELETE_MAX_AUTH_AGE_MS - 1).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(hasRecentAuthentication(undefined, now)).toBe(false);
    expect(hasRecentAuthentication('not-a-date', now)).toBe(false);
  });

  it('routes cloud account deletion through the authenticated server workflow', () => {
    const provider = projectFile('src/lib/db/providers/firebase.ts');
    const settings = projectFile('src/app/settings/page.tsx');

    expect(provider).not.toContain('deleteSignedInUserData');
    expect(provider).not.toContain('deleteAccount()');
    expect(settings).toContain("fetch('/api/account/delete'");
    expect(settings).toContain('workspaceUserId: deletedUserId');
    expect(settings).toContain(
      '!isDemoSnapshot && Boolean(user || accountProfile.signedIn)',
    );
    expect(settings.indexOf('if (!response.ok)')).toBeLessThan(
      settings.indexOf('workspaceUserId: deletedUserId'),
    );
  });

  it('cannot delete dormant Local Workspace data while the Demo Snapshot is active', () => {
    const accountData = projectFile('src/lib/account-data/account-data-io.ts');
    const settings = projectFile('src/app/settings/page.tsx');

    expect(accountData).toContain("readAnonymousWorkspaceMode() === 'demo_snapshot'");
    expect(accountData).toContain('getActiveBrowserWorkspaceUserId() === null');
    expect(settings).toContain('if (isDemoSnapshot) return;');
  });

  it.each([
    [
      'src/lib/transactions/manual-store.ts',
      'cachedTransactions = [];',
    ],
    [
      'src/lib/accounts/manual-accounts-store.ts',
      'cachedAccounts = [];',
    ],
  ])(
    'waits for acknowledged cloud deletion before clearing visible data in %s',
    (path, visibleClear) => {
      const source = projectFile(path);
      const clearFunction = source.slice(
        source.indexOf('export async function clearManual'),
      );

      expect(clearFunction.indexOf('await Promise.all(deletePromises)')).toBeLessThan(
        clearFunction.indexOf(visibleClear),
      );
    },
  );
});
