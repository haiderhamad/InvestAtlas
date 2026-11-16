import fs from 'node:fs';
import path from 'node:path';
import {
  getWorkspaceStorageKey,
  markBrowserWorkspacePending,
  readWorkspaceStorageItem,
  removeWorkspaceStorageItems,
  resolveBrowserWorkspace,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';
import {
  DEFAULT_WATCHLISTS,
  readWatchlists,
  WATCHLISTS_STORAGE_KEY,
  writeWatchlists,
} from '@/lib/watchlists/watchlist-store';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';
import {
  readHiddenAssets,
  readUserAssets,
  writeHiddenAssets,
  writeUserAssets,
} from '@/lib/config/user-assets-store';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

describe('browser workspace storage isolation', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    storage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: storage,
        dispatchEvent: jest.fn(),
      },
    });
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: class TestCustomEvent {
        readonly type: string;
        readonly detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    });
    markBrowserWorkspacePending();
  });

  afterAll(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (originalCustomEvent) {
      Object.defineProperty(globalThis, 'CustomEvent', originalCustomEvent);
    } else {
      Reflect.deleteProperty(globalThis, 'CustomEvent');
    }
  });

  it('keeps user A, anonymous Local Workspace, and user B data separate', () => {
    const userAWatchlists = [{ id: 'a-private', name: 'A private', symbols: ['AAPL'] }];
    const localWatchlists = [{ id: 'local', name: 'Local workspace', symbols: ['BTC'] }];
    const userBWatchlists = [{ id: 'b-private', name: 'B private', symbols: ['MSFT'] }];

    resolveBrowserWorkspace('user-a');
    writeWatchlists(userAWatchlists);
    writeUserAssets([{ symbol: 'AAPL', name: 'Apple', assetClass: 'stock' }]);
    writeHiddenAssets(['A-ONLY']);
    expect(readWatchlists()).toEqual(userAWatchlists);

    resolveBrowserWorkspace(null);
    expect(readWatchlists()).toEqual(DEFAULT_WATCHLISTS);
    writeWatchlists(localWatchlists);
    expect(readWatchlists()).toEqual(localWatchlists);

    resolveBrowserWorkspace('user-b');
    expect(readWatchlists()).toEqual(DEFAULT_WATCHLISTS);
    expect(readUserAssets()).toEqual([]);
    expect(readHiddenAssets()).toEqual([]);
    writeWatchlists(userBWatchlists);
    writeUserAssets([{ symbol: 'MSFT', name: 'Microsoft', assetClass: 'stock' }]);
    expect(readWatchlists()).toEqual(userBWatchlists);

    resolveBrowserWorkspace('user-a');
    expect(readWatchlists()).toEqual(userAWatchlists);
    expect(readUserAssets()).toEqual([{ symbol: 'AAPL', name: 'Apple', assetClass: 'stock' }]);
    expect(readHiddenAssets()).toEqual(['A-ONLY']);

    resolveBrowserWorkspace(null);
    expect(readWatchlists()).toEqual(localWatchlists);
  });

  it('clears only the deleted signed-in namespace after auth has become anonymous', () => {
    const sensitiveKeys = [
      WATCHLISTS_STORAGE_KEY,
      'investatlas.tax-profile-settings',
      'investatlas.ai-analysis-v2',
      'userAssets',
      'hiddenAssets',
    ];

    for (const userId of ['user-a', 'user-b']) {
      resolveBrowserWorkspace(userId);
      sensitiveKeys.forEach((key) => {
        expect(writeWorkspaceStorageItem(key, `${userId}:${key}`)).toBe(true);
      });
    }

    resolveBrowserWorkspace(null);
    sensitiveKeys.forEach((key) => {
      expect(writeWorkspaceStorageItem(key, `local:${key}`)).toBe(true);
    });

    removeWorkspaceStorageItems(sensitiveKeys, { userId: 'user-a' });

    sensitiveKeys.forEach((key) => {
      expect(readWorkspaceStorageItem(key, { userId: 'user-a' })).toBeNull();
      expect(readWorkspaceStorageItem(key, { userId: 'user-b' })).toBe(`user-b:${key}`);
      expect(readWorkspaceStorageItem(key, { userId: null })).toBe(`local:${key}`);
    });
  });

  it('fails closed while persisted authentication is unresolved', () => {
    storage.setItem(WATCHLISTS_STORAGE_KEY, 'anonymous-private-state');
    markBrowserWorkspacePending();

    expect(getWorkspaceStorageKey(WATCHLISTS_STORAGE_KEY)).toBeNull();
    expect(readWorkspaceStorageItem(WATCHLISTS_STORAGE_KEY)).toBeNull();
    expect(writeWorkspaceStorageItem(WATCHLISTS_STORAGE_KEY, 'overwrite')).toBe(false);
    expect(storage.getItem(WATCHLISTS_STORAGE_KEY)).toBe('anonymous-private-state');
  });

  it('keeps Local Workspace application data inaccessible in Demo Snapshot mode', () => {
    resolveBrowserWorkspace(null);
    expect(writeWorkspaceStorageItem('investatlas.budget-state', 'private-budget')).toBe(true);
    expect(readWorkspaceStorageItem('investatlas.budget-state')).toBe('private-budget');

    storage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, 'demo_snapshot');

    expect(readWorkspaceStorageItem('investatlas.budget-state')).toBeNull();
    expect(writeWorkspaceStorageItem('investatlas.budget-state', 'demo-write')).toBe(false);
    expect(storage.getItem('investatlas.budget-state')).toBe('private-budget');
    expect(readWorkspaceStorageItem(
      'investatlas.budget-state',
      { userId: null },
    )).toBe('private-budget');
  });

  it('clears the deleted browser namespace only after server confirmation', () => {
    const root = process.cwd();
    const settingsPage = fs.readFileSync(path.join(root, 'src/app/settings/page.tsx'), 'utf8');
    const firebaseProvider = fs.readFileSync(
      path.join(root, 'src/lib/db/providers/firebase.ts'),
      'utf8',
    );

    expect(settingsPage).toContain("fetch('/api/account/delete'");
    expect(settingsPage).toContain('workspaceUserId: deletedUserId');
    expect(settingsPage.indexOf('if (!response.ok)')).toBeLessThan(
      settingsPage.indexOf('workspaceUserId: deletedUserId'),
    );
    expect(firebaseProvider).not.toContain('deleteSignedInUserData');
    expect(firebaseProvider).not.toContain('deleteAccount()');
  });
});
