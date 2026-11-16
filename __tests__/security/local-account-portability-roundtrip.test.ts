import {
  applyAccountImportPlan, buildAccountExportCsv, parseAccountExportCsv,
} from '@/lib/account-data/account-data-io';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';

jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(),
  query: jest.fn(), where: jest.fn(), writeBatch: jest.fn(),
  onSnapshot: jest.fn(), setDoc: jest.fn(), deleteDoc: jest.fn(),
}));

const createdAt = '2026-10-27T08:00:00.000Z';
const accounts = [{
  id: 'ia-test-investment-cash', venue: 'ia-test-cash',
  label: 'Investment cash', kind: 'Bank Account',
  portfolioScope: 'portfolio', cashCategory: 'investment_cash',
  cashRoutes: ['stock', 'etf'], needsPortfolioScopeReview: false,
  notes: 'separate settlement', createdAt,
}, {
  id: 'ia-test-broker', venue: 'ia-test-broker',
  label: 'Broker portfolio', kind: 'Brokerage',
  portfolioScope: 'portfolio', cashCategory: 'investment_cash',
  cashRoutes: [], needsPortfolioScopeReview: false, notes: '', createdAt,
}];

const transactions = [{
  id: 'ia-test-deposit', date: '2026-10-27T09:00:00.000Z',
  venue: 'ia-test-cash', type: 'deposit', asset: 'EUR',
  assetClass: 'cash', quote: 'EUR', amount: 2000,
  price: 1, total: 2000, fee: 0, taxType: 'cash_in', source: 'manual',
}, {
  id: 'ia-test-buy', date: '2026-10-27T10:00:00.000Z',
  venue: 'ia-test-broker', settlementVenue: 'ia-test-cash',
  type: 'buy', asset: 'AAPL', assetClass: 'stock', quote: 'EUR',
  amount: 2, price: 100, total: 200, fee: 0,
  taxType: 'acquisition', source: 'manual',
}];

function fileFor(csv: string): File {
  return { size: Buffer.byteLength(csv), text: async () => csv } as File;
}

describe('Local Workspace account CSV export/import roundtrip', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map<string, string>();
    storage.set(ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => { storage.set(key, value); },
          removeItem: (key: string) => { storage.delete(key); },
        },
      },
    });
    resolveBrowserWorkspace(null);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('restores accounts, cash+stock transaction history, watchlist and language in a clean local workspace', async () => {
    storage.set('investatlas.manual-accounts', JSON.stringify(accounts));
    storage.set('investatlas.manual-transactions', JSON.stringify(transactions));
    const watchlists = [{ id: 'personal', name: 'ETF & stock ideas', symbols: ['AAPL', 'ISWD'] }];
    storage.set('investatlas.watchlists', JSON.stringify(watchlists));
    storage.set('investatlas.preferences', JSON.stringify({
      theme: 'light', language: 'de', displayCurrency: 'eur',
      accountProfile: { signedIn: false, fullName: '', email: '' },
    }));
    // Unrelated browser state is not a portable API credential.
    storage.set('investatlas.test.local-secret', 'DO_NOT_EXPORT_SYNTHETIC_SECRET');

    const csv = await buildAccountExportCsv();
    expect(csv).toContain('ia-test-buy');
    expect(csv).toContain('ia-test-cash');
    expect(csv).not.toContain('DO_NOT_EXPORT_SYNTHETIC_SECRET');

    storage.delete('investatlas.manual-accounts');
    storage.delete('investatlas.manual-transactions');
    storage.delete('investatlas.watchlists');
    storage.delete('investatlas.preferences');

    const plan = await parseAccountExportCsv(fileFor(csv));
    expect(plan.conflicts).toEqual([]);
    expect(plan.summary).toMatchObject({ accounts: 2, transactions: 2, watchlists: 1 });

    await applyAccountImportPlan(plan, 'append');

    const restoredAccounts = JSON.parse(storage.get('investatlas.manual-accounts') ?? '[]');
    const restoredTransactions = JSON.parse(storage.get('investatlas.manual-transactions') ?? '[]');
    const restoredPreferences = JSON.parse(storage.get('investatlas.preferences') ?? '{}');
    expect(restoredAccounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ia-test-broker', venue: 'ia-test-broker' }),
      expect.objectContaining({ id: 'ia-test-investment-cash', cashRoutes: ['stock', 'etf'] }),
    ]));
    expect(restoredTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ia-test-deposit', type: 'deposit', amount: 2000 }),
      expect.objectContaining({ id: 'ia-test-buy', settlementVenue: 'ia-test-cash', amount: 2 }),
    ]));
    expect(JSON.parse(storage.get('investatlas.watchlists') ?? '[]')).toEqual(watchlists);
    expect(restoredPreferences).toMatchObject({ language: 'de', theme: 'light' });
  });

  it('restores a larger personal ledger without weakening the cloud-batch cap', async () => {
    const ledger = Array.from({ length: 205 }, (_, index) => ({
      ...transactions[0],
      id: `qa-deposit-${index}`,
      date: new Date(Date.parse('2026-10-27T09:00:00.000Z') - index * 60_000).toISOString(),
      amount: 100 + index,
      total: 100 + index,
    }));
    storage.set('investatlas.manual-accounts', JSON.stringify(accounts));
    storage.set('investatlas.manual-transactions', JSON.stringify(ledger));

    const csv = await buildAccountExportCsv();
    storage.delete('investatlas.manual-accounts');
    storage.delete('investatlas.manual-transactions');
    const plan = await parseAccountExportCsv(fileFor(csv));
    expect(plan.transactions).toHaveLength(205);
    await applyAccountImportPlan(plan, 'append');
    expect(JSON.parse(storage.get('investatlas.manual-transactions') ?? '[]')).toHaveLength(205);

    // A shared Firestore write batch has a separate, lower record budget.
    const firebase = require('@/lib/firebase') as {
      auth: { currentUser: { uid: string } | null };
    };
    firebase.auth.currentUser = { uid: 'synthetic-cloud-owner' };
    try {
      await expect(parseAccountExportCsv(fileFor(csv))).rejects.toThrow('too many cloud records');
      await expect(applyAccountImportPlan(plan, 'append')).rejects.toThrow('too many cloud records');
    } finally {
      firebase.auth.currentUser = null;
    }
  });

  it('does not overwrite conflicting accounts or transactions without explicit replace choice', async () => {
    storage.set('investatlas.manual-accounts', JSON.stringify(accounts));
    storage.set('investatlas.manual-transactions', JSON.stringify(transactions));
    const csv = await buildAccountExportCsv();
    const plan = await parseAccountExportCsv(fileFor(csv));
    expect(plan.conflicts.length).toBeGreaterThan(0);
    const oldAccounts = storage.get('investatlas.manual-accounts');
    const oldTransactions = storage.get('investatlas.manual-transactions');

    await expect(applyAccountImportPlan(plan, 'append')).rejects.toThrow('conflicts');
    expect(storage.get('investatlas.manual-accounts')).toBe(oldAccounts);
    expect(storage.get('investatlas.manual-transactions')).toBe(oldTransactions);
  });
});
