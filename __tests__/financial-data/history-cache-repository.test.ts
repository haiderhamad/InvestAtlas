import type { HistoryCacheKey, HistoryCacheRecord } from '@/lib/financial-data/history/cache';

const now = Date.UTC(2026, 10, 7, 12);
const key: HistoryCacheKey = {
  installation: 'local_personal', owner: 'owner-a', instrument: 'AAPL.US', exchange: 'NASDAQ',
  providerId: 'eodhd_personal_daily', currency: 'USD', interval: '1d', adjustment: 'raw_unadjusted', version: 1,
};
const record = (keyChanges: Partial<HistoryCacheKey> = {}): HistoryCacheRecord => ({
  key: { ...key, ...keyChanges },
  bars: [{ date: '2026-10-01', open: 10, high: 15, low: 9, close: 12, volume: null, adjustedClose: 6 }],
  coverage: [{ from: '2026-10-01', to: '2026-11-06' }],
  retrievedAt: now - 1_000, lastCheckedAt: now - 1_000,
});
const repository = () => (require('@/lib/financial-data/history/cache') as typeof import('@/lib/financial-data/history/cache'))
  .getHistoryRepository();

describe('provider-aware per-owner history repository', () => {
  let originalIndexedDb: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  it('reuses the repository and clones eligible records at both boundaries', async () => {
    const repo = repository();
    const incoming = record();
    expect(repository()).toBe(repo);
    expect(await repo.write(incoming)).toBe(true);
    incoming.key.instrument = 'MUTATED';
    incoming.bars[0].close = 14;
    const loaded = await repo.read(key);
    expect(loaded?.bars[0].close).toBe(12);
    loaded!.bars[0].close = 13;
    loaded!.coverage[0].from = '2026-01-01';
    expect(await repo.read(key)).toEqual(record());
    expect(await repo.stats('local_personal', 'owner-a')).toMatchObject({
      recordCount: 1, barCount: 1, persistence: { mode: 'memory', reason: 'unavailable' },
    });
  });

  it('allows separately sourced ECB reference data', async () => {
    const repo = repository();
    const incoming = record({ providerId: 'ecb_reference_rates', instrument: 'EUR-USD', exchange: 'ECB' });
    expect(await repo.write(incoming)).toBe(true);
    expect(await repo.read(incoming.key)).toEqual(incoming);
  });

  it('partitions browser-origin deployments and accepts bounded provider venue names', async () => {
    const repo = repository();
    const incoming = record({ installation: 'http://127.0.0.1:3187:local_personal', exchange: 'NYSE ARCA' });
    expect(await repo.write(incoming)).toBe(true);
    expect(await repo.read(incoming.key)).toEqual(incoming);
    expect((await repo.stats(incoming.key.installation, incoming.key.owner)).recordCount).toBe(1);
    await repo.clearOwner(incoming.key.installation, incoming.key.owner);
    expect(await repo.read(incoming.key)).toBeNull();
  });

  it.each([
    'https://user:secret@example.test:private_cloud',
    'https://example.test/path:private_cloud',
    'https://example.test?token=secret:private_cloud',
    'file:///private/data:local_personal',
  ])('rejects credentialed and non-origin deployment values: %s', async installation => {
    expect(await repository().write(record({ installation }))).toBe(false);
  });

  it.each(['tiingo_personal_daily', 'tiingo', 'yahoo_chart', 'twelve_data', 'unreviewed_provider'])
  ('denies all repository retention for unapproved provider %s', async providerId => {
    const repo = repository();
    const incoming = record({ providerId });
    expect(await repo.write(incoming)).toBe(false);
    expect(await repo.read(incoming.key)).toBeNull();
    expect((await repo.stats('local_personal', 'owner-a')).recordCount).toBe(0);
  });

  it('partitions native identities by installation, owner, listing, venue, currency, source and adjustment', async () => {
    const repo = repository();
    const variants: Partial<HistoryCacheKey>[] = [
      {}, { installation: 'another-installation' }, { owner: 'owner-b' }, { instrument: 'MSFT.US' },
      { exchange: 'NYSE' }, { currency: 'EUR' }, { providerId: 'ecb_reference_rates' }, { adjustment: 'adjusted_close' },
    ];
    for (const variant of variants) expect(await repo.write(record(variant))).toBe(true);
    for (const variant of variants) expect(await repo.read(record(variant).key)).toEqual(record(variant));
    expect((await repo.stats('local_personal', 'owner-a')).recordCount).toBe(6);
  });

  it.each([
    { owner: '' }, { instrument: 'https://example.test/secret' }, { currency: 'GBP' },
    { interval: '1h' }, { version: 2 }, { adjustment: 'raw?api_token=secret' },
  ])('rejects invalid identities without storing them: %j', async changes => {
    const repo = repository();
    expect(await repo.write(record(changes as Partial<HistoryCacheKey>))).toBe(false);
    expect((await repo.stats('local_personal', 'owner-a')).recordCount).toBe(0);
  });

  it('whitelists stored fields so arbitrary metadata, credentials and URLs cannot survive', async () => {
    const repo = repository();
    const incoming = {
      ...record(), apiKey: 'secret', upstreamUrl: 'https://example.test/?api_token=secret',
      key: { ...key, credential: 'secret' },
      bars: [{ ...record().bars[0], authorization: 'secret' }],
      coverage: [{ ...record().coverage[0], token: 'secret' }],
    };
    expect(await repo.write(incoming)).toBe(true);
    expect(await repo.read(key)).toEqual(record());
    expect(JSON.stringify(await repo.read(key))).not.toContain('secret');
  });

  it('rejects oversized records before retaining bars', async () => {
    const repo = repository();
    const incoming = record();
    incoming.bars = Array.from({ length: 5_001 }, (_, index) => ({
      ...incoming.bars[0], date: new Date(Date.UTC(2000, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    }));
    expect(await repo.write(incoming)).toBe(false);
    expect(await repo.read(key)).toBeNull();
  });

  it('bounds the complete memory cache to 128 records and evicts the least recently checked', async () => {
    const repo = repository();
    for (let index = 0; index < 129; index++) {
      const incoming = record({ instrument: `TEST-${index}` });
      incoming.lastCheckedAt += index;
      expect(await repo.write(incoming)).toBe(true);
    }
    expect(await repo.read(record({ instrument: 'TEST-0' }).key)).toBeNull();
    expect(await repo.read(record({ instrument: 'TEST-128' }).key)).not.toBeNull();
    expect((await repo.stats('local_personal', 'owner-a')).recordCount).toBe(128);
  });

  it('clears only the requested owner and installation', async () => {
    const repo = repository();
    await repo.write(record());
    await repo.write(record({ owner: 'owner-b' }));
    await repo.write(record({ installation: 'private_cloud' }));
    await repo.clearOwner('local_personal', 'owner-a');
    expect(await repo.read(key)).toBeNull();
    expect(await repo.read(record({ owner: 'owner-b' }).key)).not.toBeNull();
    expect(await repo.read(record({ installation: 'private_cloud' }).key)).not.toBeNull();
  });

  it('rejects a pending write when deletion starts before the write completes', async () => {
    const repo = repository();
    const write = repo.write(record());
    const clear = repo.clearOwner('local_personal', 'owner-a');
    expect(await write).toBe(false);
    await clear;
    expect(await repo.read(key)).toBeNull();
  });

  it('rejects an in-flight write when its request is cancelled', async () => {
    const repo = repository();
    const controller = new AbortController();
    const pending = repo.write(record(), undefined, controller.signal);
    controller.abort();
    expect(await pending).toBe(false);
    expect(await repo.read(key)).toBeNull();
  });

  it('rejects late responses carrying an epoch from before owner deletion', async () => {
    const repo = repository();
    const oldEpoch = await repo.getOwnerEpoch('local_personal', 'owner-a');
    await repo.clearOwner('local_personal', 'owner-a');
    expect(await repo.write(record(), oldEpoch)).toBe(false);
    expect(await repo.read(key)).toBeNull();
    const newEpoch = await repo.getOwnerEpoch('local_personal', 'owner-a');
    expect(newEpoch).toBeGreaterThan(oldEpoch);
    expect(await repo.write(record(), newEpoch)).toBe(true);
  });

  it.each(['error', 'blocked'] as const)('falls back when IndexedDB open asynchronously reports %s', async failure => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => {
        const request: Partial<IDBOpenDBRequest> = {};
        queueMicrotask(() => {
          const callback = failure === 'blocked' ? request.onblocked : request.onerror;
          callback?.call(request as IDBOpenDBRequest, new Event(failure) as IDBVersionChangeEvent);
        });
        return request;
      } },
    });
    const repo = repository();
    expect(await repo.read(key)).toBeNull();
    expect(await repo.write(record())).toBe(true);
    expect(await repo.read(key)).toEqual(record());
    expect(repo.persistence).toEqual({ mode: 'memory', reason: failure === 'blocked' ? 'blocked' : 'storage_error' });
    await expect(repo.clearOwner('local_personal', 'owner-a')).rejects.toThrow('deletion could not be confirmed');
  });

  it('falls back when an already opened database asynchronously fails a read', async () => {
    const database = {
      close: () => undefined,
      transaction: () => ({ objectStore: () => ({ get: () => {
        const request: Partial<IDBRequest> = {};
        queueMicrotask(() => request.onerror?.call(request as IDBRequest, new Event('error')));
        return request;
      } }) }),
    };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => {
        const request: Partial<IDBOpenDBRequest> = { result: database as unknown as IDBDatabase };
        queueMicrotask(() => request.onsuccess?.call(request as IDBOpenDBRequest, new Event('success')));
        return request;
      } },
    });
    const repo = repository();
    expect(await repo.read(key)).toBeNull();
    expect(await repo.write(record())).toBe(true);
    expect(await repo.read(key)).toEqual(record());
    expect(repo.persistence).toEqual({ mode: 'memory', reason: 'storage_error' });
    await expect(repo.clearOwner('local_personal', 'owner-a')).rejects.toThrow('deletion could not be confirmed');
  });
});
