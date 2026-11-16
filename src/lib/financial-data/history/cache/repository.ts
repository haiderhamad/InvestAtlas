import type { HistoryCacheKey, HistoryCacheRecord } from './types';
import {
  historyKeyId, historyOwnerId, MAX_HISTORY_RECORDS, normalizeHistoryKey, normalizeHistoryRecord,
} from './validation';

export interface HistoryPersistence {
  mode: 'indexeddb' | 'memory';
  reason: 'unavailable' | 'blocked' | 'storage_error' | null;
}

export interface HistoryRepositoryStats {
  recordCount: number;
  barCount: number;
  persistence: HistoryPersistence;
}

export interface HistoryRepository {
  readonly persistence: HistoryPersistence;
  getOwnerEpoch(installation: string, owner: string): Promise<number>;
  read(key: HistoryCacheKey): Promise<HistoryCacheRecord | null>;
  write(record: HistoryCacheRecord, expectedOwnerEpoch?: number, signal?: AbortSignal): Promise<boolean>;
  clearOwner(installation: string, owner: string): Promise<void>;
  stats(installation: string, owner: string): Promise<HistoryRepositoryStats>;
}

interface StoredRecord {
  id: string;
  ownerId: string;
  record: HistoryCacheRecord;
}

const APPROVED_PROVIDERS = new Set(['eodhd_personal_daily', 'ecb_reference_rates']);
const DATABASE_NAME = 'investatlas-native-history-v1';

function requestResult<T>(request: IDBRequest<T>, success: (value: T) => void, fail: () => void): void {
  request.onerror = fail;
  request.onsuccess = () => {
    try { success(request.result); } catch { fail(); }
  };
}

function transactionResult<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, result: (value: T) => void, fail: () => void) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result: T;
    const cleanup = () => signal?.removeEventListener('abort', cancel);
    const fail = () => { cleanup(); reject(new Error('History storage transaction failed')); };
    const cancel = () => {
      try { transaction.abort(); } catch { /* The transaction may already have completed. */ }
      fail();
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
    transaction.oncomplete = () => { cleanup(); resolve(result); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    work(transaction, value => { result = value; }, fail);
  });
}

function epochOf(value: unknown): number {
  const epoch = value === undefined ? 0 : (value as { epoch?: unknown })?.epoch;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error('Invalid history owner epoch');
  }
  return epoch;
}

class BrowserHistoryRepository implements HistoryRepository {
  private capability: HistoryPersistence = { mode: 'memory', reason: 'unavailable' };
  private memory = new Map<string, HistoryCacheRecord>();
  private epochs = new Map<string, number>();
  private generations = new Map<string, number>();
  private opening: Promise<IDBDatabase | null> | null = null;
  private degraded = false;

  get persistence(): HistoryPersistence { return { ...this.capability }; }

  private fallback(reason: HistoryPersistence['reason']): void {
    this.degraded = true;
    this.capability = { mode: 'memory', reason };
  }

  private database(): Promise<IDBDatabase | null> {
    if (this.degraded) return Promise.resolve(null);
    if (this.opening) return this.opening;
    this.opening = new Promise(resolve => {
      try {
        if (!globalThis.indexedDB) {
          this.fallback('unavailable');
          resolve(null);
          return;
        }
        const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
        let failed = false;
        const fail = (reason: HistoryPersistence['reason']) => {
          failed = true;
          this.fallback(reason);
          resolve(null);
        };
        request.onerror = () => fail('storage_error');
        request.onblocked = () => fail('blocked');
        request.onupgradeneeded = () => {
          try {
            const database = request.result;
            const records = database.createObjectStore('records', { keyPath: 'id' });
            records.createIndex('owner', 'ownerId', { unique: false });
            database.createObjectStore('owners', { keyPath: 'id' });
          } catch { fail('storage_error'); }
        };
        request.onsuccess = () => {
          const database = request.result;
          if (failed) { database.close(); return; }
          database.onversionchange = () => {
            database.close();
            this.fallback('storage_error');
          };
          this.capability = { mode: 'indexeddb', reason: null };
          resolve(database);
        };
      } catch {
        this.fallback('storage_error');
        resolve(null);
      }
    });
    return this.opening;
  }

  private remember(record: HistoryCacheRecord): void {
    this.memory.set(historyKeyId(record.key), record);
    if (this.memory.size > MAX_HISTORY_RECORDS) {
      const oldest = [...this.memory].sort((a, b) => a[1].lastCheckedAt - b[1].lastCheckedAt)[0];
      this.memory.delete(oldest[0]);
    }
  }

  async getOwnerEpoch(installation: string, owner: string): Promise<number> {
    const ownerId = historyOwnerId(installation, owner);
    const generation = this.generations.get(ownerId) ?? 0;
    const database = await this.database();
    if (database) {
      try {
        const epoch = await transactionResult<number>(database, ['owners'], 'readonly', (transaction, result, fail) => {
          requestResult(transaction.objectStore('owners').get(ownerId), value => result(epochOf(value)), fail);
        });
        if ((this.generations.get(ownerId) ?? 0) !== generation) return this.getOwnerEpoch(installation, owner);
        this.epochs.set(ownerId, epoch);
      } catch { this.fallback('storage_error'); }
    }
    return this.epochs.get(ownerId) ?? 0;
  }

  async read(input: HistoryCacheKey): Promise<HistoryCacheRecord | null> {
    const key = normalizeHistoryKey(input);
    if (!key || !APPROVED_PROVIDERS.has(key.providerId)) return null;
    const id = historyKeyId(key);
    const ownerId = historyOwnerId(key.installation, key.owner);
    const generation = this.generations.get(ownerId) ?? 0;
    const database = await this.database();
    if (database) {
      try {
        const stored = await transactionResult<StoredRecord | undefined>(database, ['records'], 'readonly', (transaction, result, fail) => {
          requestResult(transaction.objectStore('records').get(id), result, fail);
        });
        if ((this.generations.get(ownerId) ?? 0) !== generation) return null;
        const record = normalizeHistoryRecord(stored?.record, Date.now());
        if (record && historyKeyId(record.key) === id) this.remember(record);
        else this.memory.delete(id);
      } catch { this.fallback('storage_error'); }
    }
    if ((this.generations.get(ownerId) ?? 0) !== generation) return null;
    return normalizeHistoryRecord(this.memory.get(id), Date.now());
  }

  async write(input: HistoryCacheRecord, expectedOwnerEpoch?: number, signal?: AbortSignal): Promise<boolean> {
    const record = normalizeHistoryRecord(input, Date.now());
    if (signal?.aborted || !record || !APPROVED_PROVIDERS.has(record.key.providerId)
      || (expectedOwnerEpoch !== undefined && (!Number.isSafeInteger(expectedOwnerEpoch) || expectedOwnerEpoch < 0))) return false;
    const id = historyKeyId(record.key);
    const ownerId = historyOwnerId(record.key.installation, record.key.owner);
    const generation = this.generations.get(ownerId) ?? 0;
    const currentGeneration = () => !signal?.aborted && (this.generations.get(ownerId) ?? 0) === generation;
    const database = await this.database();
    if (!currentGeneration()) return false;
    if (database) {
      try {
        const written = await transactionResult<boolean>(database, ['owners', 'records'], 'readwrite', (transaction, result, fail) => {
          requestResult(transaction.objectStore('owners').get(ownerId), value => {
            const epoch = epochOf(value);
            this.epochs.set(ownerId, epoch);
            if (!currentGeneration() || (expectedOwnerEpoch !== undefined && expectedOwnerEpoch !== epoch)) {
              result(false);
              return;
            }
            const records = transaction.objectStore('records');
            requestResult<StoredRecord[]>(records.getAll(), stored => {
              if (!currentGeneration()) { result(false); return; }
              const previous = stored.filter(entry => entry.id !== id)
                .sort((a, b) => (a.record?.lastCheckedAt ?? 0) - (b.record?.lastCheckedAt ?? 0));
              for (const evicted of previous.slice(0, Math.max(0, previous.length - MAX_HISTORY_RECORDS + 1))) {
                records.delete(evicted.id);
                this.memory.delete(evicted.id);
              }
              records.put({ id, ownerId, record } satisfies StoredRecord);
              result(true);
            }, fail);
          }, fail);
        }, signal);
        if (!written || !currentGeneration()) return false;
        this.remember(record);
        return true;
      } catch {
        if (signal?.aborted) return false;
        this.fallback('storage_error');
      }
    }
    if (!currentGeneration() || (expectedOwnerEpoch !== undefined && expectedOwnerEpoch !== (this.epochs.get(ownerId) ?? 0))) return false;
    this.remember(record);
    return true;
  }

  async clearOwner(installation: string, owner: string): Promise<void> {
    const ownerId = historyOwnerId(installation, owner);
    this.generations.set(ownerId, (this.generations.get(ownerId) ?? 0) + 1);
    this.epochs.set(ownerId, (this.epochs.get(ownerId) ?? 0) + 1);
    for (const [id, record] of this.memory) {
      if (record.key.installation === installation && record.key.owner === owner) this.memory.delete(id);
    }
    const database = await this.database();
    if (!database) {
      if (this.capability.reason === 'blocked' || this.capability.reason === 'storage_error') {
        throw new Error('History storage deletion could not be confirmed');
      }
      return;
    }
    try {
      const epoch = await transactionResult<number>(database, ['owners', 'records'], 'readwrite', (transaction, result, fail) => {
        const owners = transaction.objectStore('owners');
        requestResult(owners.get(ownerId), value => {
          const epoch = Math.max(epochOf(value) + 1, this.epochs.get(ownerId) ?? 0);
          owners.put({ id: ownerId, epoch });
          const records = transaction.objectStore('records');
          requestResult<IDBCursorWithValue | null>(records.index('owner').openCursor(ownerId), cursor => {
            if (cursor) { cursor.delete(); cursor.continue(); }
            else result(epoch);
          }, fail);
        }, fail);
      });
      this.epochs.set(ownerId, Math.max(epoch, this.epochs.get(ownerId) ?? 0));
    } catch {
      this.fallback('storage_error');
      // A failed durable deletion must not be reported as a confirmed clear.
      throw new Error('History storage deletion could not be confirmed');
    }
  }

  async stats(installation: string, owner: string): Promise<HistoryRepositoryStats> {
    const ownerId = historyOwnerId(installation, owner);
    const generation = this.generations.get(ownerId) ?? 0;
    const database = await this.database();
    if (database) {
      try {
        const stored = await transactionResult<StoredRecord[]>(database, ['records'], 'readonly', (transaction, result, fail) => {
          requestResult(transaction.objectStore('records').index('owner').getAll(ownerId), result, fail);
        });
        const records = stored.map(entry => normalizeHistoryRecord(entry.record, Date.now()))
          .filter((record): record is HistoryCacheRecord => record !== null
            && record.key.installation === installation && record.key.owner === owner
            && APPROVED_PROVIDERS.has(record.key.providerId));
        if ((this.generations.get(ownerId) ?? 0) === generation) {
          return { recordCount: records.length, barCount: records.reduce((total, record) => total + record.bars.length, 0), persistence: this.persistence };
        }
      } catch { this.fallback('storage_error'); }
    }
    const records = [...this.memory.values()].filter(record => record.key.installation === installation && record.key.owner === owner);
    return { recordCount: records.length, barCount: records.reduce((total, record) => total + record.bars.length, 0), persistence: this.persistence };
  }
}

let repository: HistoryRepository | undefined;

export function getHistoryRepository(): HistoryRepository {
  return repository ??= new BrowserHistoryRepository();
}
