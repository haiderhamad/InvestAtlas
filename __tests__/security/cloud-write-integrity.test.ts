import type { ManualAccount } from '@/lib/accounts/manual-accounts-store';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn();
const mockDispatchEvent = jest.fn();
let mockAuthCallback: ((user: { uid: string } | null) => void) | undefined;
let mockSnapshotCallback:
  | ((snapshot: {
      docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      metadata: { hasPendingWrites: boolean };
    }) => void)
  | undefined;
let mockSnapshotError: ((error: unknown) => void) | undefined;

jest.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
}));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(
    (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
      mockAuthCallback = callback;
      return jest.fn();
    },
  ),
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, path: string) => ({ path })),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  doc: jest.fn((_db: unknown, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
  })),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(
    (
      _query: unknown,
      callback: (snapshot: {
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
        metadata: { hasPendingWrites: boolean };
      }) => void,
      error: (error: unknown) => void,
    ) => {
      mockSnapshotCallback = callback;
      mockSnapshotError = error;
      return jest.fn();
    },
  ),
  query: jest.fn((...parts: unknown[]) => ({ parts })),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  where: jest.fn((...parts: unknown[]) => ({ parts })),
  writeBatch: jest.fn(() => ({
    set: (...args: unknown[]) => mockBatchSet(...args),
    commit: () => mockBatchCommit(),
  })),
}));

function transaction(id: string): InvestmentTransaction {
  return {
    id,
    date: '2026-07-26T00:00:00.000Z',
    venue: 'manual-broker',
    type: 'deposit',
    asset: 'EUR',
    assetClass: 'cash',
    quote: 'EUR',
    amount: 100,
    price: 1,
    total: 100,
    fee: 0,
    taxType: 'cash_in',
    source: 'manual',
  };
}

function account(overrides: Partial<ManualAccount> = {}): ManualAccount {
  return {
    id: 'manual-account-1',
    venue: 'manual-broker',
    label: 'Manual Broker',
    kind: 'Brokerage',
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function installWindow() {
  const values = new Map<string, string>();
  values.set('investatlas.anonymous-workspace-mode', 'local_workspace');
  const localStorage = {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    removeItem: jest.fn((key: string) => values.delete(key)),
    clear: jest.fn(() => values.clear()),
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: jest.fn(),
      dispatchEvent: mockDispatchEvent,
      localStorage,
      removeEventListener: jest.fn(),
    },
  });

  return { localStorage };
}

function acknowledgeEmptyCloudSnapshot() {
  mockSnapshotCallback?.({
    docs: [],
    metadata: { hasPendingWrites: false },
  });
}

describe('authenticated cloud write integrity', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSetDoc.mockReset();
    mockDeleteDoc.mockReset();
    mockBatchSet.mockReset();
    mockBatchCommit.mockReset();
    mockDispatchEvent.mockReset();
    mockAuthCallback = undefined;
    mockSnapshotCallback = undefined;
    mockSnapshotError = undefined;
    installWindow();
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('does not expose a new authenticated transaction before Firestore acknowledges it', async () => {
    let acknowledgeWrite: (() => void) | undefined;
    mockSetDoc.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledgeWrite = resolve;
      }),
    );
    const store = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');
    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    mockDispatchEvent.mockClear();

    const pending = store.addManualTransaction(transaction('pending-transaction'));
    mockSnapshotCallback?.({
      docs: [{ id: 'user-a~pending-transaction', data: () => ({ ...transaction('pending-transaction'), userId: 'user-a' }) }],
      metadata: { hasPendingWrites: true },
    });

    expect(pending).toBeInstanceOf(Promise);
    expect(store.getAllTransactions().some((item) => item.id === 'pending-transaction')).toBe(false);
    expect(mockDispatchEvent).not.toHaveBeenCalled();

    acknowledgeWrite?.();
    await pending;

    expect(store.getAllTransactions().some((item) => item.id === 'pending-transaction')).toBe(true);
    expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed authenticated transaction batch without mutating the cache', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    const store = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');
    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    mockDispatchEvent.mockClear();

    await expect(
      store.addManualTransactions([
        transaction('batch-transaction-1'),
        transaction('batch-transaction-2'),
      ]),
    ).rejects.toThrow('permission-denied');

    expect(
      store.getAllTransactions().some((item) => item.id.startsWith('batch-transaction-')),
    ).toBe(false);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('keeps an authenticated transaction cached when its Firestore delete fails', async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error('network-unavailable'));
    const store = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');
    mockAuthCallback?.({ uid: 'user-a' });
    mockSnapshotCallback?.({
      docs: [{ id: 'legacy-existing-transaction', data: () => ({ ...transaction('existing-transaction'), userId: 'user-a' }) }],
      metadata: { hasPendingWrites: false },
    });
    mockDispatchEvent.mockClear();

    await expect(store.removeManualTransaction('existing-transaction')).rejects.toThrow(
      'network-unavailable',
    );

    expect(store.getAllTransactions().some((item) => item.id === 'existing-transaction')).toBe(true);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('keeps an authenticated account unchanged when its Firestore update fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'));
    const store = require('@/lib/accounts/manual-accounts-store') as typeof import('@/lib/accounts/manual-accounts-store');
    mockAuthCallback?.({ uid: 'user-a' });
    mockSnapshotCallback?.({
      docs: [{ id: 'legacy-manual-account-1', data: () => ({ ...account(), userId: 'user-a' }) }],
      metadata: { hasPendingWrites: false },
    });
    mockDispatchEvent.mockClear();

    await expect(
      store.updateManualAccount('manual-broker', { label: 'Unpersisted Rename' }),
    ).rejects.toThrow('permission-denied');

    expect(store.getAllManualAccounts()).toEqual([
      expect.objectContaining({ label: 'Manual Broker' }),
    ]);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('rejects a failed authenticated account create without exposing it in the cache', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'));
    const store = require('@/lib/accounts/manual-accounts-store') as typeof import('@/lib/accounts/manual-accounts-store');
    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    mockDispatchEvent.mockClear();

    await expect(
      store.addManualAccount({
        label: 'Unpersisted Account',
        kind: 'Brokerage',
      }),
    ).rejects.toThrow('permission-denied');

    expect(store.getAllManualAccounts()).toEqual([]);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('keeps an authenticated account cached when its Firestore delete fails', async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error('network-unavailable'));
    const store = require('@/lib/accounts/manual-accounts-store') as typeof import('@/lib/accounts/manual-accounts-store');
    mockAuthCallback?.({ uid: 'user-a' });
    mockSnapshotCallback?.({
      docs: [{ id: 'legacy-manual-account-1', data: () => ({ ...account(), userId: 'user-a' }) }],
      metadata: { hasPendingWrites: false },
    });
    mockDispatchEvent.mockClear();

    await expect(store.removeManualAccount('manual-broker')).rejects.toThrow(
      'network-unavailable',
    );

    expect(store.getAllManualAccounts()).toEqual([
      expect.objectContaining({ venue: 'manual-broker' }),
    ]);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('does not expose an authenticated risk setting before Firestore acknowledges it', async () => {
    let acknowledgeWrite: (() => void) | undefined;
    mockSetDoc.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledgeWrite = resolve;
      }),
    );
    const store = require('@/lib/config/asset-risk-store') as typeof import('@/lib/config/asset-risk-store');
    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    mockDispatchEvent.mockClear();

    const pending = store.saveAssetRisk('btc', 'High');
    mockSnapshotCallback?.({
      docs: [{ id: 'user-a_BTC', data: () => ({ symbol: 'BTC', risk: 'High', userId: 'user-a' }) }],
      metadata: { hasPendingWrites: true },
    });

    expect(store.readAssetRisks()).toEqual({});
    expect(mockDispatchEvent).not.toHaveBeenCalled();

    acknowledgeWrite?.();
    await pending;

    expect(store.readAssetRisks()).toEqual({ BTC: 'High' });
    expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed authenticated risk batch without mutating the cache', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    const store = require('@/lib/config/asset-risk-store') as typeof import('@/lib/config/asset-risk-store');
    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    mockDispatchEvent.mockClear();

    await expect(
      store.saveAssetRisks({ BTC: 'High', ETH: 'Medium' }),
    ).rejects.toThrow('permission-denied');

    expect(store.readAssetRisks()).toEqual({});
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('keeps Local Workspace transaction and account writes synchronous', () => {
    const transactionStore = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');
    const transactionResult = transactionStore.addManualTransaction(
      transaction('local-transaction'),
    );

    expect(Array.isArray(transactionResult)).toBe(true);
    expect(
      transactionStore.readManualTransactions().some((item) => item.id === 'local-transaction'),
    ).toBe(true);

    jest.resetModules();
    mockAuthCallback = undefined;
    mockSnapshotCallback = undefined;
    const accountStore = require('@/lib/accounts/manual-accounts-store') as typeof import('@/lib/accounts/manual-accounts-store');
    const accountResult = accountStore.addManualAccount({
      label: 'Local Account',
      kind: 'Brokerage',
    });

    expect(Array.isArray(accountResult)).toBe(true);
    expect(accountStore.readManualAccounts()).toEqual([
      expect.objectContaining({ label: 'Local Account' }),
    ]);
  });

  it('does not read or mutate Local Workspace accounts from the read-only Demo Snapshot', async () => {
    window.localStorage.setItem('investatlas.anonymous-workspace-mode', 'demo_snapshot');
    window.localStorage.setItem('investatlas.manual-accounts', JSON.stringify([
      account({ label: 'Private Local Account' }),
    ]));
    const store = require('@/lib/accounts/manual-accounts-store') as typeof import('@/lib/accounts/manual-accounts-store');

    expect(store.getAllManualAccounts()).toEqual([]);
    expect(() => store.addManualAccount({
      label: 'Demo Mutation',
      kind: 'Brokerage',
    })).toThrow(store.DemoAccountWorkspaceReadOnlyError);
    expect(() => store.updateManualAccount('manual-broker', {
      label: 'Demo Rename',
    })).toThrow(store.DemoAccountWorkspaceReadOnlyError);
    expect(() => store.removeManualAccount('manual-broker'))
      .toThrow(store.DemoAccountWorkspaceReadOnlyError);
    await expect(store.clearManualAccounts())
      .rejects.toThrow(store.DemoAccountWorkspaceReadOnlyError);

    expect(store.readManualAccounts()).toEqual([
      expect.objectContaining({ label: 'Private Local Account' }),
    ]);
  });

  it('discards user A transaction cache before a failing user B listener can render', () => {
    const store = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');
    mockAuthCallback?.({ uid: 'user-a' });
    mockSnapshotCallback?.({
      docs: [{
        id: 'legacy-a-record',
        data: () => ({ ...transaction('a-private'), userId: 'user-a' }),
      }],
      metadata: { hasPendingWrites: false },
    });
    expect(store.getAllTransactions().map((item) => item.id)).toContain('a-private');

    mockAuthCallback?.({ uid: 'user-b' });
    expect(store.getAllTransactions()).toEqual([]);
    mockSnapshotError?.({ code: 'permission-denied' });

    expect(store.getAllTransactions()).toEqual([]);
  });

  it('uses UID-scoped physical document IDs for equal logical IDs', async () => {
    mockSetDoc.mockResolvedValue(undefined);
    const store = require('@/lib/transactions/manual-store') as typeof import('@/lib/transactions/manual-store');

    mockAuthCallback?.({ uid: 'user-a' });
    acknowledgeEmptyCloudSnapshot();
    await store.addManualTransaction(transaction('shared-logical-id'));

    mockAuthCallback?.({ uid: 'user-b' });
    acknowledgeEmptyCloudSnapshot();
    await store.addManualTransaction(transaction('shared-logical-id'));

    expect(mockSetDoc.mock.calls[0][0]).toEqual({
      path: 'transactions/user-a~shared-logical-id',
    });
    expect(mockSetDoc.mock.calls[1][0]).toEqual({
      path: 'transactions/user-b~shared-logical-id',
    });
  });
});
