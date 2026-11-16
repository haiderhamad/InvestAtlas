import {
  getPersonalAssetConfig,
  getPersonalAssetsByClass,
  getPersonalListingIdentity,
  saveResolvedPersonalListing,
} from '@/lib/config/personal-asset-registry';
import { getAssetConfig, getAssetShariahStatus } from '@/lib/config/supported-assets';
import {
  readUserAssets, writeUserAssets, USER_ASSETS_CHANGE_EVENT, USER_ASSETS_STORAGE_KEY,
} from '@/lib/config/user-assets-store';
import {
  markBrowserWorkspacePending, resolveBrowserWorkspace,
} from '@/lib/storage/workspace-storage';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';

const listing = {
  version: 1, symbol: 'ADBE', providerSymbol: 'ADBE', name: 'Adobe Inc.',
  assetClass: 'stock', nativeCurrency: 'usd', exchange: 'NMS',
  source: 'yahoo_chart', resolvedAt: '2026-11-07T10:00:00.000Z',
} as const;

describe('personal asset registry', () => {
  let storage: Map<string, string>;
  let events: string[];

  beforeEach(() => {
    storage = new Map([[ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace']]);
    events = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => { events.push(event.type); return true; },
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => { storage.set(key, value); },
        },
      },
    });
    resolveBrowserWorkspace(null);
    events.length = 0;
  });

  afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

  it('adds a sourced listing with uncertain screening and its actual native currency', () => {
    expect(saveResolvedPersonalListing(listing)).toBe(true);
    expect(getPersonalAssetConfig(' adbe ')).toEqual({
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock',
      nativeCurrency: 'usd', yahooSymbol: 'ADBE', taxRegime: 'capital_income',
      compliance: { status: 'Blocked: Insufficient Evidence' },
    });
    expect(getAssetShariahStatus(getPersonalAssetConfig('ADBE')!)).toBe('insufficient_data');
    expect(getPersonalListingIdentity('ADBE')).toEqual(listing);
    expect(getPersonalAssetsByClass('stock').filter((asset) => asset.symbol === 'ADBE')).toHaveLength(1);
    expect(events).toContain(USER_ASSETS_CHANGE_EVENT);
    expect(getAssetConfig('ADBE')).toBeUndefined();
  });

  it('does not guess currency for old custom records', () => {
    const old = { symbol: 'OLD', name: 'Older holding', assetClass: 'stock' } as const;
    writeUserAssets([old]);
    expect(readUserAssets()).toEqual([old]);
    expect(getPersonalAssetConfig('OLD')).toBeUndefined();
    expect(getPersonalListingIdentity('OLD')).toBeUndefined();
  });

  it('preserves existing catalog mappings and does not duplicate catalog symbols', () => {
    const asset = getAssetConfig('SAP')!;
    expect(saveResolvedPersonalListing({
      ...listing, symbol: 'SAP', providerSymbol: 'SAP.DE', name: 'A personal label',
      nativeCurrency: 'eur', exchange: 'GER',
    })).toBe(true);
    expect(getPersonalAssetConfig('SAP')).toEqual(asset);
    expect(getPersonalAssetsByClass('stock').filter((entry) => entry.symbol === 'SAP')).toHaveLength(1);
    expect(saveResolvedPersonalListing({ ...listing, symbol: 'SAP' })).toBe(false);
    expect(getPersonalListingIdentity('SAP')?.providerSymbol).toBe('SAP.DE');
  });

  it('keeps local and individual owner identities separate with no stale registry cache', () => {
    expect(saveResolvedPersonalListing(listing)).toBe(true);
    resolveBrowserWorkspace('owner-a');
    expect(getPersonalListingIdentity('ADBE')).toBeUndefined();
    expect(saveResolvedPersonalListing({
      ...listing, symbol: 'VOW3.DE', providerSymbol: 'VOW3.DE',
      name: 'Volkswagen preferred', nativeCurrency: 'eur', exchange: 'GER',
    })).toBe(true);
    resolveBrowserWorkspace('owner-b');
    expect(getPersonalAssetConfig('VOW3.DE')).toBeUndefined();
    expect(getPersonalListingIdentity('ADBE')).toBeUndefined();
    resolveBrowserWorkspace('owner-a');
    expect(getPersonalListingIdentity('VOW3.DE')?.nativeCurrency).toBe('eur');
    resolveBrowserWorkspace(null);
    expect(getPersonalListingIdentity('ADBE')).toEqual(listing);
    expect(getPersonalListingIdentity('VOW3.DE')).toBeUndefined();
  });

  it('fails closed for unresolved auth and the read-only demo', () => {
    markBrowserWorkspacePending();
    expect(saveResolvedPersonalListing(listing)).toBe(false);
    resolveBrowserWorkspace(null);
    storage.set(ANONYMOUS_WORKSPACE_MODE_KEY, 'demo_snapshot');
    expect(saveResolvedPersonalListing(listing)).toBe(false);
    expect(getPersonalListingIdentity('ADBE')).toBeUndefined();
    expect(storage.get(USER_ASSETS_STORAGE_KEY)).toBeUndefined();
  });

  it('cannot replace the class, currency or venue of an existing custom listing', () => {
    saveResolvedPersonalListing(listing);
    for (const mutation of [
      { assetClass: 'etf' as const }, { nativeCurrency: 'eur' as const }, { exchange: 'GER' },
    ]) {
      expect(saveResolvedPersonalListing({ ...listing, ...mutation })).toBe(false);
    }
    expect(getPersonalListingIdentity('ADBE')).toEqual(listing);
    expect(readUserAssets()).toHaveLength(1);
  });

  it('retains existing optional metadata when resolving a legacy holding', () => {
    writeUserAssets([{
      symbol: 'ADBE', name: 'Earlier label', assetClass: 'stock',
      isin: 'US00724F1012', wkn: '871981', yahooSymbol: 'ADBE', searchAliases: ['Adobe'],
    }]);
    expect(saveResolvedPersonalListing(listing)).toBe(true);
    expect(readUserAssets()).toEqual([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock',
      isin: 'US00724F1012', wkn: '871981', yahooSymbol: 'ADBE', searchAliases: ['Adobe'], listing,
    }]);
  });

  it('drops invalid persisted hints and unsafe fields while retaining a legacy asset', () => {
    storage.set(USER_ASSETS_STORAGE_KEY, JSON.stringify([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock',
      listing: { ...listing, nativeCurrency: 'gbp' }, isHalal: true,
    }]));
    expect(readUserAssets()).toEqual([{ symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock' }]);
    expect(getPersonalAssetConfig('ADBE')).toBeUndefined();
  });

  it('deduplicates bounded stored records and rejects invalid writes atomically', () => {
    const original = { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock' } as const;
    storage.set(USER_ASSETS_STORAGE_KEY, JSON.stringify([original, { ...original, symbol: 'adbe' }]));
    expect(readUserAssets()).toEqual([original]);
    const before = storage.get(USER_ASSETS_STORAGE_KEY);
    expect(() => writeUserAssets([original, original])).toThrow();
    expect(() => writeUserAssets([{ ...original, symbol: '../ADBE' }])).toThrow();
    expect(() => writeUserAssets([{ ...original, symbol: 'ıbm' }])).toThrow();
    expect(() => writeUserAssets(Array.from({ length: 257 }, (_, i) => ({ ...original, symbol: `C${i}` })))).toThrow();
    expect(storage.get(USER_ASSETS_STORAGE_KEY)).toBe(before);
  });

  it('cannot upgrade oversized or mismatched persisted metadata into a usable listing', () => {
    storage.set(USER_ASSETS_STORAGE_KEY, JSON.stringify([{
      symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'etf', listing,
    }]));
    expect(getPersonalListingIdentity('ADBE')).toBeUndefined();
    storage.set(USER_ASSETS_STORAGE_KEY, JSON.stringify(Array.from({ length: 257 }, (_, index) => ({
      symbol: `C${index}`, name: `Company ${index}`, assetClass: 'stock',
    }))));
    expect(readUserAssets().length).toBeLessThanOrEqual(256);
  });

  it('reports restricted storage without saving an identity or emitting a successful change', () => {
    window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(saveResolvedPersonalListing(listing)).toBe(false);
    expect(getPersonalListingIdentity('ADBE')).toBeUndefined();
    expect(events).not.toContain(USER_ASSETS_CHANGE_EVENT);
  });
});
