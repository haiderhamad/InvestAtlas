import {
  ACCOUNT_EXPORT_SCHEMA,
  MAX_ACCOUNT_IMPORT_BYTES,
  applyAccountImportPlan,
  buildAccountExportCsv,
  parseAccountExportCsv,
} from '@/lib/account-data/account-data-io';
import { decodeManualAccount } from '@/lib/accounts/manual-account-schema';
import { decodeInvestmentTransaction } from '@/lib/transactions/transaction-schema';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { MANUAL_ACCOUNTS_STORAGE_KEY } from '@/lib/accounts/manual-accounts-store';

jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  writeBatch: jest.fn(),
  onSnapshot: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
}));

const EXPORTED_AT = '2026-07-28T12:00:00.000Z';
const COLUMNS = [
  'schema',
  'exportedAt',
  'recordType',
  'recordId',
  'label',
  'date',
  'amount',
  'currency',
  'payloadJson',
];

function csvCell(value: string): string {
  return /[",\n\r]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function row(
  recordType: string,
  recordId: string,
  payload: unknown,
  extra: string[] = [],
): string {
  return [
    ACCOUNT_EXPORT_SCHEMA,
    EXPORTED_AT,
    recordType,
    recordId,
    'label',
    '',
    '',
    '',
    JSON.stringify(payload),
    ...extra,
  ].map(csvCell).join(',');
}

function exportCsv(...rows: string[]): string {
  return [
    COLUMNS.join(','),
    row('metadata', 'export', {
      schema: ACCOUNT_EXPORT_SCHEMA,
      exportedAt: EXPORTED_AT,
      app: 'InvestAtlas',
    }),
    ...rows,
  ].join('\n');
}

function fakeFile(text: string, size = Buffer.byteLength(text)): File {
  return {
    size,
    text: async () => text,
  } as File;
}

const account = {
  id: 'account-1',
  venue: 'broker-1',
  label: 'Broker 1',
  kind: 'Brokerage',
  portfolioScope: 'portfolio',
  cashCategory: 'investment_cash',
  cashRoutes: [],
  needsPortfolioScopeReview: false,
  notes: '',
  createdAt: EXPORTED_AT,
};

const transaction = {
  id: 'transaction-1',
  date: EXPORTED_AT,
  venue: 'broker-1',
  type: 'deposit',
  asset: 'EUR',
  assetClass: 'cash',
  quote: 'EUR',
  amount: 1_000,
  price: 1,
  total: 1_000,
  fee: 0,
  taxType: 'cash_in',
  source: 'manual',
};

describe('bounded account import validation', () => {
  it('parses a valid InvestAtlas export into typed records', async () => {
    const plan = await parseAccountExportCsv(fakeFile(exportCsv(
      row('manual-account', account.id, account),
      row('manual-transaction', transaction.id, transaction),
    )));

    expect(plan.accounts).toEqual([account]);
    expect(plan.transactions).toEqual([transaction]);
    expect(plan.summary).toEqual(expect.objectContaining({
      accounts: 1,
      transactions: 1,
    }));
  });

  it('rejects files above the bounded byte limit before parsing', async () => {
    await expect(parseAccountExportCsv(
      fakeFile(exportCsv(), MAX_ACCOUNT_IMPORT_BYTES + 1),
    )).rejects.toThrow('too large');
  });

  it('rejects extra CSV columns and mismatched logical IDs', async () => {
    await expect(parseAccountExportCsv(fakeFile(exportCsv(
      row('manual-account', account.id, account, ['unexpected']),
    )))).rejects.toThrow('invalid number of columns');

    await expect(parseAccountExportCsv(fakeFile(exportCsv(
      row('manual-account', 'different-id', account),
    )))).rejects.toThrow('mismatched account ID');
  });

  it('rejects duplicate account identities inside the import itself', async () => {
    await expect(parseAccountExportCsv(fakeFile(exportCsv(
      row('manual-account', account.id, account),
      row('manual-account', 'account-2', {
        ...account,
        id: 'account-2',
      }),
    )))).rejects.toThrow('duplicate account identities');
  });

  it('neutralizes spreadsheet formulas in exported display cells', async () => {
    const values = new Map<string, string>([
      [
        'investatlas.manual-accounts',
        JSON.stringify([{
          ...account,
          label: '=HYPERLINK("https://attacker.invalid")',
        }]),
      ],
    ]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace(null);

    const csv = await buildAccountExportCsv();
    expect(csv).toContain(`'=HYPERLINK`);

    Reflect.deleteProperty(globalThis, 'window');
  });

  it('commits authenticated accounts and transactions in one Firestore batch', async () => {
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    const firestore = require('firebase/firestore') as {
      collection: jest.Mock;
      doc: jest.Mock;
      getDocs: jest.Mock;
      query: jest.Mock;
      where: jest.Mock;
      writeBatch: jest.Mock;
    };
    const set = jest.fn();
    const deleteDocument = jest.fn();
    const commit = jest.fn().mockResolvedValue(undefined);
    firestore.collection.mockImplementation((_db: unknown, path: string) => ({ path }));
    firestore.query.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.where.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.doc.mockImplementation(
      (_db: unknown, collectionName: string, id: string) => ({
        path: `${collectionName}/${id}`,
      }),
    );
    firestore.getDocs.mockResolvedValue({ docs: [] });
    firestore.writeBatch.mockReturnValue({
      set,
      delete: deleteDocument,
      commit,
    });
    firebase.auth.currentUser = { uid: 'user-a' };

    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace('user-a');

    await applyAccountImportPlan({
      schema: ACCOUNT_EXPORT_SCHEMA,
      exportedAt: EXPORTED_AT,
      accounts: [decodeManualAccount(account)],
      transactions: [decodeInvestmentTransaction(transaction)],
      localRecords: {},
      conflicts: [],
      summary: {
        accounts: 1,
        transactions: 1,
        hiddenAccounts: 0,
        watchlists: 0,
        budgetEntries: 0,
        localSettings: 0,
      },
    }, 'append');

    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.map((call) => call[0].path)).toEqual([
      'manual-accounts/user-a~account-1',
      'transactions/user-a~transaction-1',
    ]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(deleteDocument).not.toHaveBeenCalled();

    firebase.auth.currentUser = null;
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('validates browser-only records before starting an authenticated cloud write', async () => {
    jest.clearAllMocks();
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    const firestore = require('firebase/firestore') as {
      writeBatch: jest.Mock;
    };
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace('user-a');
    firebase.auth.currentUser = { uid: 'user-a' };

    try {
      await expect(applyAccountImportPlan({
        schema: ACCOUNT_EXPORT_SCHEMA,
        exportedAt: EXPORTED_AT,
        accounts: [decodeManualAccount(account)],
        transactions: [decodeInvestmentTransaction(transaction)],
        localRecords: {
          'budget-state': {},
        },
        conflicts: [],
        summary: {
          accounts: 1,
          transactions: 1,
          hiddenAccounts: 0,
          watchlists: 0,
          budgetEntries: 0,
          localSettings: 1,
        },
      }, 'append')).rejects.toThrow('Budget state');

      expect(firestore.writeBatch).not.toHaveBeenCalled();
    } finally {
      firebase.auth.currentUser = null;
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('restores browser-only settings when the authenticated cloud batch fails', async () => {
    jest.clearAllMocks();
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    const firestore = require('firebase/firestore') as {
      collection: jest.Mock;
      doc: jest.Mock;
      getDocs: jest.Mock;
      query: jest.Mock;
      where: jest.Mock;
      writeBatch: jest.Mock;
    };
    const commit = jest.fn().mockRejectedValue(new Error('cloud unavailable'));
    firestore.collection.mockImplementation((_db: unknown, path: string) => ({ path }));
    firestore.query.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.where.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.doc.mockImplementation(
      (_db: unknown, collectionName: string, id: string) => ({
        path: `${collectionName}/${id}`,
      }),
    );
    firestore.getDocs.mockResolvedValue({ docs: [] });
    firestore.writeBatch.mockReturnValue({
      set: jest.fn(),
      delete: jest.fn(),
      commit,
    });

    const hiddenAccountsKey =
      'investatlas.hidden-accounts::user::user-a';
    const values = new Map<string, string>([
      [hiddenAccountsKey, JSON.stringify(['existing-venue'])],
    ]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace('user-a');
    firebase.auth.currentUser = { uid: 'user-a' };

    try {
      await expect(applyAccountImportPlan({
        schema: ACCOUNT_EXPORT_SCHEMA,
        exportedAt: EXPORTED_AT,
        accounts: [decodeManualAccount(account)],
        transactions: [decodeInvestmentTransaction(transaction)],
        localRecords: {
          'hidden-accounts': ['incoming-venue'],
        },
        conflicts: [],
        summary: {
          accounts: 1,
          transactions: 1,
          hiddenAccounts: 1,
          watchlists: 0,
          budgetEntries: 0,
          localSettings: 1,
        },
      }, 'append')).rejects.toThrow('cloud unavailable');

      expect(commit).toHaveBeenCalledTimes(1);
      expect(values.get(hiddenAccountsKey)).toBe(
        JSON.stringify(['existing-venue']),
      );
    } finally {
      firebase.auth.currentUser = null;
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('does not replace a same-label account that belongs to another venue', async () => {
    jest.clearAllMocks();
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    const firestore = require('firebase/firestore') as {
      writeBatch: jest.Mock;
    };
    const existingAccount = {
      ...account,
      id: 'existing-account',
      venue: 'existing-venue',
      label: 'Shared Broker',
    };
    const incomingAccount = {
      ...account,
      id: 'incoming-account',
      venue: 'incoming-venue',
      label: 'Shared Broker',
    };
    const values = new Map<string, string>([
      [MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([existingAccount])],
    ]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace('user-a');
    firebase.auth.currentUser = { uid: 'user-a' };

    try {
      await expect(applyAccountImportPlan({
        schema: ACCOUNT_EXPORT_SCHEMA,
        exportedAt: EXPORTED_AT,
        accounts: [decodeManualAccount(incomingAccount)],
        transactions: [],
        localRecords: {},
        conflicts: [],
        summary: {
          accounts: 1,
          transactions: 0,
          hiddenAccounts: 0,
          watchlists: 0,
          budgetEntries: 0,
          localSettings: 0,
        },
      }, 'replace-conflicts')).rejects.toThrow(
        'account ID or label is already associated with a different venue',
      );

      expect(firestore.writeBatch).not.toHaveBeenCalled();
    } finally {
      firebase.auth.currentUser = null;
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('does not move an existing account ID to another venue', async () => {
    jest.clearAllMocks();
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    const firestore = require('firebase/firestore') as {
      writeBatch: jest.Mock;
    };
    const existingAccount = {
      ...account,
      id: 'stable-account-id',
      venue: 'existing-venue',
      label: 'Existing Broker',
    };
    const incomingAccount = {
      ...account,
      id: 'stable-account-id',
      venue: 'new-venue',
      label: 'Renamed Broker',
    };
    const values = new Map<string, string>([
      [MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([existingAccount])],
    ]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    resolveBrowserWorkspace('user-a');
    firebase.auth.currentUser = { uid: 'user-a' };

    try {
      await expect(applyAccountImportPlan({
        schema: ACCOUNT_EXPORT_SCHEMA,
        exportedAt: EXPORTED_AT,
        accounts: [decodeManualAccount(incomingAccount)],
        transactions: [],
        localRecords: {},
        conflicts: [],
        summary: {
          accounts: 1,
          transactions: 0,
          hiddenAccounts: 0,
          watchlists: 0,
          budgetEntries: 0,
          localSettings: 0,
        },
      }, 'replace-conflicts')).rejects.toThrow(
        'account ID or label is already associated with a different venue',
      );

      expect(firestore.writeBatch).not.toHaveBeenCalled();
    } finally {
      firebase.auth.currentUser = null;
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
});

describe('account and transaction runtime schemas', () => {
  it('normalizes legacy optional account fields to a Firestore-safe shape', () => {
    expect(decodeManualAccount({
      id: 'legacy-account',
      venue: 'legacy-broker',
      label: 'Legacy Broker',
      kind: 'Brokerage',
      createdAt: EXPORTED_AT,
    })).toEqual(expect.objectContaining({
      portfolioScope: 'portfolio',
      cashCategory: 'investment_cash',
      cashRoutes: [],
      notes: '',
    }));
  });

  it('rejects unsupported account fields and inconsistent transaction tax types', () => {
    expect(() => decodeManualAccount({
      ...account,
      userId: 'attacker-controlled',
    })).toThrow('unsupported fields');

    expect(() => decodeInvestmentTransaction({
      ...transaction,
      taxType: 'disposal',
    })).toThrow('tax classification is inconsistent');
  });

  it('rejects non-finite and negative financial inputs', () => {
    expect(() => decodeInvestmentTransaction({
      ...transaction,
      total: Number.NaN,
    })).toThrow('Transaction total is invalid');
    expect(() => decodeInvestmentTransaction({
      ...transaction,
      fee: -1,
    })).toThrow('Transaction fee is invalid');
  });
});
