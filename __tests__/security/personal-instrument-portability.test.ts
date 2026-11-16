import {
  ACCOUNT_EXPORT_SCHEMA,
  applyAccountImportPlan,
  buildAccountExportCsv,
  parseAccountExportCsv,
} from '@/lib/account-data/account-data-io';
import { readUserAssets, writeUserAssets } from '@/lib/config/user-assets-store';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';

jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(),
  query: jest.fn(), where: jest.fn(), writeBatch: jest.fn(),
  onSnapshot: jest.fn(), setDoc: jest.fn(), deleteDoc: jest.fn(),
}));

const listing = {
  version: 1, symbol: 'ADBE', providerSymbol: 'ADBE', name: 'Adobe Inc.',
  assetClass: 'stock', nativeCurrency: 'usd', exchange: 'NMS',
  source: 'yahoo_chart', resolvedAt: '2026-11-07T10:00:00.000Z',
} as const;

function fileFor(csv: string): File {
  return { size: Buffer.byteLength(csv), text: async () => csv } as File;
}

function assetsCsv(assets: unknown[]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const row = (type: string, id: string, payload: unknown) => [
    ACCOUNT_EXPORT_SCHEMA, listing.resolvedAt, type, id, '', '', '', '', JSON.stringify(payload),
  ].map(cell).join(',');
  return [
    'schema,exportedAt,recordType,recordId,label,date,amount,currency,payloadJson',
    row('metadata', 'export', {
      schema: ACCOUNT_EXPORT_SCHEMA, exportedAt: listing.resolvedAt, app: 'InvestAtlas',
    }),
    row('user-assets', 'user-assets', assets),
  ].join('\n');
}

describe('portable personal listing metadata', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map([[ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace']]);
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

  afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

  it('imports and re-exports listing hints alongside unchanged legacy asset metadata', async () => {
    const assets = [
      { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', listing },
      {
        symbol: 'LEGACY', name: 'Legacy ETF', assetClass: 'etf',
        isin: 'IE000EXAMPLE1', wkn: 'ABC123', yahooSymbol: 'LEGACY.DE', searchAliases: ['Legacy fund'],
      },
    ];
    const plan = await parseAccountExportCsv(fileFor(assetsCsv(assets)));
    await applyAccountImportPlan(plan, 'append');
    expect(readUserAssets()).toEqual(assets);
    const exported = await buildAccountExportCsv();
    const restored = await parseAccountExportCsv(fileFor(exported));
    expect(restored.localRecords['user-assets']).toEqual(assets);
  });

  it('rejects metadata that reassigns a stored asset to another listing', async () => {
    await expect(parseAccountExportCsv(fileFor(assetsCsv([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock',
      listing: { ...listing, providerSymbol: 'MSFT' },
    }])))).rejects.toThrow(/listing/i);
  });

  it('rejects imported screening claims inside listing metadata', async () => {
    await expect(parseAccountExportCsv(fileFor(assetsCsv([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock',
      listing: { ...listing, compliance: { status: 'Compliant' } },
    }])))).rejects.toThrow(/listing/i);
  });

  it('rejects imported top-level screening flags', async () => {
    await expect(parseAccountExportCsv(fileFor(assetsCsv([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', listing, isHalal: true,
    }])))).rejects.toThrow('unsupported fields');
  });

  it('rejects non-ASCII ticker lookalikes before they become another holding', async () => {
    await expect(parseAccountExportCsv(fileFor(assetsCsv([{
      symbol: 'ıbm', name: 'Different holding', assetClass: 'stock',
    }])))).rejects.toThrow(/invalid/i);
  });

  it('keeps legacy records exportable without inventing a listing or currency', async () => {
    writeUserAssets([{ symbol: 'OLD', name: 'Older holding', assetClass: 'stock' }]);
    const csv = await buildAccountExportCsv();
    const plan = await parseAccountExportCsv(fileFor(csv));
    expect(plan.localRecords['user-assets']).toEqual([
      { symbol: 'OLD', name: 'Older holding', assetClass: 'stock' },
    ]);
  });
});
