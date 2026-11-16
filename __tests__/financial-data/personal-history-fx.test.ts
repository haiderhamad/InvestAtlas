import { loadPersonalHistoryFx } from '@/lib/financial-data/fx/personal-history-fx';
import * as cache from '@/lib/financial-data/history/cache';
import * as workspace from '@/lib/storage/workspace-storage';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
const NOW = Date.UTC(2026, 10, 7, 12);
const DAY = 86_400_000;
const installation = 'https://private.example:private_cloud';
const oldWindow = globalThis.window;
const oldIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const oldFetch = global.fetch;
let owner: string;
const key = (): cache.HistoryCacheKey => ({
  installation, owner, instrument: 'USD-EUR', exchange: 'ECB', providerId: 'ecb_reference_rates',
  currency: 'EUR', interval: '1d', adjustment: 'reference_rate', version: 1,
});
function responseFor(url: string | URL | Request): Response {
  const query = new URL(String(url), 'https://private.example').searchParams;
  const from = Date.parse(query.get('startDate')! + 'T00:00:00.000Z');
  const to = Date.parse(query.get('endDate')! + 'T00:00:00.000Z');
  const data: Array<{ date: string; rate: number; asOf: string }> = [];
  for (let stamp = from; stamp <= to; stamp += DAY) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    if (![0, 6].includes(new Date(stamp).getUTCDay())) data.push({ date, rate: 0.91, asOf: date });
  }
  return Response.json({ status: 'complete', data, generatedAt: new Date(Date.now()).toISOString(), sourceAttribution: 'Source: ECB statistics.' });
}
beforeAll(() => {
  const view = new EventTarget();
  Object.assign(view, { location: new URL('https://private.example'), localStorage: { getItem: () => null, setItem: () => {} } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: view });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
});
beforeEach(() => {
  owner = 'fx-owner-' + Math.random().toString(16).slice(2);
  workspace.resolveBrowserWorkspace(owner);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = jest.fn(async url => responseFor(url));
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = oldFetch; });
afterAll(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  if (oldIndexedDb) Object.defineProperty(globalThis, 'indexedDB', oldIndexedDb);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
});

test('shares five-year ECB chunks across callers, adds seven carry days and limits transport concurrency to two', async () => {
  let active = 0;
  let peak = 0;
  global.fetch = jest.fn(async url => {
    active += 1; peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return responseFor(url);
  });
  const results = await Promise.all([
    loadPersonalHistoryFx(owner, '2021-11-07', '2026-11-06'),
    loadPersonalHistoryFx(owner, '2021-11-07', '2026-11-06'),
    loadPersonalHistoryFx(owner, '2021-11-07', '2026-11-06'),
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(peak).toBe(2);
  const windows = jest.mocked(global.fetch).mock.calls.map(([url, options]) => {
    const request = new URL(String(url), 'https://private.example');
    expect(request.pathname).toBe('/api/financial-data/fx/history');
    expect(request.searchParams.get('from')).toBe('USD');
    expect(request.searchParams.get('to')).toBe('EUR');
    expect(request.searchParams.get('exactWindow')).toBe('true');
    expect(options?.credentials).toBe('same-origin');
    return { from: request.searchParams.get('startDate')!, to: request.searchParams.get('endDate')! };
  }).sort((a, b) => a.from.localeCompare(b.from));
  expect(windows[0].from).toBe('2021-10-31');
  expect(windows.at(-1)?.to).toBe('2026-11-06');
  windows.forEach((range, index) => {
    expect((Date.parse(range.to) - Date.parse(range.from)) / DAY + 1).toBeLessThanOrEqual(400);
    if (index) expect(Date.parse(range.from) - Date.parse(windows[index - 1].to)).toBe(DAY);
  });
  expect(results[0]?.[0]).toEqual({ date: '2021-11-01', rate: 0.91, asOf: '2021-11-01' });
  expect(results[1]).toEqual(results[0]);
  results[0]![0].rate = 99;
  expect(results[1]![0].rate).toBe(0.91);
  expect((await cache.getHistoryRepository().read(key()))?.bars[0]).toEqual({ date: '2021-11-01', open: 0.91, high: 0.91, low: 0.91, close: 0.91, volume: null });
});

test('converts the full five-year history boundary measured from the last closed day', async () => {
  jest.mocked(Date.now).mockReturnValue(Date.UTC(2026, 10, 10, 12));
  const rows = await loadPersonalHistoryFx(owner, '2021-11-09', '2026-11-09');
  expect(rows?.[0]).toEqual({ date: '2021-11-02', rate: 0.91, asOf: '2021-11-02' });
  expect(rows?.at(-1)).toEqual({ date: '2026-11-09', rate: 0.91, asOf: '2026-11-09' });
  expect(global.fetch).toHaveBeenCalledTimes(5);
  const first = new URL(String(jest.mocked(global.fetch).mock.calls[0][0]), 'https://private.example');
  expect(first.searchParams.get('startDate')).toBe('2021-11-02');
});

test('a fresh helper instance reuses the repository rather than fetching the same licensed window', async () => {
  await loadPersonalHistoryFx(owner, '2026-01-01', '2026-03-31');
  let reloaded!: typeof import('@/lib/financial-data/fx/personal-history-fx');
  jest.isolateModules(() => {
    jest.doMock('@/lib/financial-data/history/cache', () => cache);
    jest.doMock('@/lib/storage/workspace-storage', () => workspace);
    reloaded = require('@/lib/financial-data/fx/personal-history-fx');
  });
  jest.dontMock('@/lib/financial-data/history/cache');
  jest.dontMock('@/lib/storage/workspace-storage');
  expect((await reloaded.loadPersonalHistoryFx(owner, '2026-01-01', '2026-03-31'))?.at(-1)?.asOf).toBe('2026-03-31');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('serializes overlapping ranges and fetches only the missing extension', async () => {
  await Promise.all([
    loadPersonalHistoryFx(owner, '2026-01-01', '2026-06-30'),
    loadPersonalHistoryFx(owner, '2026-01-01', '2026-11-06'),
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  const last = new URL(String(jest.mocked(global.fetch).mock.calls[1][0]), 'https://private.example');
  expect(last.searchParams.get('startDate')).toBe('2026-07-01');
  expect(last.searchParams.get('endDate')).toBe('2026-11-06');
});

test('one cancelled subscriber detaches without cancelling another subscriber', async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  let requestUrl!: string | URL | Request;
  let transportSignal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  global.fetch = jest.fn((url, options) => new Promise(resolve => {
    requestUrl = url; transportSignal = options?.signal ?? undefined; release = resolve; started();
  }));
  const first = new AbortController();
  const a = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06', first.signal);
  const b = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06');
  await entered;
  first.abort();
  await expect(a).rejects.toMatchObject({ name: 'AbortError' });
  expect(transportSignal?.aborted).toBe(false);
  release(responseFor(requestUrl));
  expect((await b)?.at(-1)?.date).toBe('2026-11-06');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('cancelling the last subscriber stops transport and cannot leave a late cache write', async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  let requestUrl!: string | URL | Request;
  let transportSignal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  global.fetch = jest.fn((url, options) => new Promise(resolve => {
    requestUrl = url; transportSignal = options?.signal ?? undefined; release = resolve; started();
  }));
  const controller = new AbortController();
  const task = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06', controller.signal);
  await entered;
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  expect(transportSignal?.aborted).toBe(true);
  release(responseFor(requestUrl));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(await cache.getHistoryRepository().read(key())).toBeNull();
});

test('cancellation while storage is pending reaches the repository write before any rates persist', async () => {
  const repository = cache.getHistoryRepository();
  const write = repository.write.bind(repository);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(repository, 'write').mockImplementation(async (record, epoch, signal) => {
    entered(); await gate;
    return write(record, epoch, signal);
  });
  const controller = new AbortController();
  const task = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06', controller.signal);
  await started;
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(await repository.read(key())).toBeNull();
});

test('owner changes and a deletion epoch prevent pending FX results from being returned or retained', async () => {
  for (const change of ['owner', 'delete'] as const) {
    let release!: (response: Response) => void;
    let started!: () => void;
    let requestUrl!: string | URL | Request;
    const entered = new Promise<void>(resolve => { started = resolve; });
    global.fetch = jest.fn(url => new Promise(resolve => { requestUrl = url; release = resolve; started(); }));
    const task = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06');
    await entered;
    if (change === 'owner') workspace.resolveBrowserWorkspace(owner + '-other');
    else await cache.getHistoryRepository().clearOwner(installation, owner);
    release(responseFor(requestUrl));
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(await cache.getHistoryRepository().read(key())).toBeNull();
    workspace.resolveBrowserWorkspace(owner);
  }
});

test.each(['workspace', 'consent', 'source', 'anonymous'] as const)('an immediate %s switch and restoration cannot revive an old flight', async change => {
  let release!: (response: Response) => void;
  let started!: () => void;
  let requestUrl!: string | URL | Request;
  let transportSignal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  global.fetch = jest.fn((url, options) => new Promise(resolve => {
    requestUrl = url; transportSignal = options?.signal ?? undefined; release = resolve; started();
  }));
  const task = loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06');
  await entered;
  if (change === 'workspace') { workspace.resolveBrowserWorkspace(owner + '-other'); workspace.resolveBrowserWorkspace(owner); }
  if (change === 'consent') { clearPublicSourceConsent(); setPublicSourceConsent(owner, ['yahoo']); }
  if (change === 'source') { saveSourceSelection(owner, { ...readSourceSelection(owner), fx: false }); saveSourceSelection(owner, { ...readSourceSelection(owner), fx: true }); }
  if (change === 'anonymous') { writeAnonymousWorkspaceMode('local_workspace'); writeAnonymousWorkspaceMode('demo_snapshot'); }
  release(responseFor(requestUrl));
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  expect(transportSignal?.aborted).toBe(true);
  expect(await cache.getHistoryRepository().read(key())).toBeNull();
});

test('partial offline reuse preserves actual old dates and never fabricates a fresh conversion rate', async () => {
  await loadPersonalHistoryFx(owner, '2026-10-01', '2026-10-20');
  global.fetch = jest.fn(async () => Response.json({}, { status: 503 }));
  const rows = await loadPersonalHistoryFx(owner, '2026-10-01', '2026-11-06');
  expect(rows?.at(-1)).toEqual({ date: '2026-10-20', rate: 0.91, asOf: '2026-10-20' });
  expect(rows?.some(row => row.date === '2026-11-06')).toBe(false);
  expect(await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06')).toBeNull();
});

test('a failed stale-tail refresh preserves prior source dates and the last successful check time', async () => {
  await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06');
  jest.mocked(Date.now).mockReturnValue(NOW + 7 * 3_600_000);
  global.fetch = jest.fn(async () => Response.json({}, { status: 503 }));
  const rows = await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06');
  expect(rows?.at(-1)).toEqual({ date: '2026-11-06', rate: 0.91, asOf: '2026-11-06' });
  const query = new URL(String(jest.mocked(global.fetch).mock.calls[0][0]), 'https://private.example').searchParams;
  expect(query.get('startDate')).toBe('2026-10-31');
  expect((await cache.getHistoryRepository().read(key()))?.lastCheckedAt).toBe(NOW);
});

test.each([
  { date: '2026-10-31', rate: 0, asOf: '2026-10-31' },
  { date: '2026-02-30', rate: 0.91, asOf: '2026-02-30' },
  { date: '2026-10-24', rate: 0.91, asOf: '2026-10-24' },
  { date: '2026-11-07', rate: 0.91, asOf: '2026-11-07' },
  { date: '2026-10-31', rate: 0.91, asOf: '2026-10-30' },
])('rejects invalid, future, pre-window or mismatched source dates: %j', async row => {
  global.fetch = jest.fn(async () => Response.json({ status: 'complete', data: [row], sourceAttribution: 'Source: ECB statistics.' }));
  expect(await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06')).toBeNull();
  expect(await cache.getHistoryRepository().read(key())).toBeNull();
});

test('rejects duplicate observations and another provider attribution', async () => {
  const row = { date: '2026-11-06', rate: 0.91, asOf: '2026-11-06' };
  for (const payload of [
    { status: 'complete', data: [row, row], sourceAttribution: 'Source: ECB statistics.' },
    { status: 'complete', data: [row], sourceAttribution: 'Source: another provider.' },
    { status: 'complete', data: [row], sourceAttribution: 'Source: ECB statistics.', baseCurrency: 'EUR' },
  ]) {
    global.fetch = jest.fn(async () => Response.json(payload));
    expect(await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06')).toBeNull();
  }
  expect(await cache.getHistoryRepository().read(key())).toBeNull();
});

test('rejects malformed, reversed, future and older-than-five-year input without network access', async () => {
  for (const [from, to] of [['2026-02-30', '2026-11-06'], ['2026-11-06', '2026-11-01'], ['2020-01-01', '2026-11-06'], ['2026-11-06', '2026-11-08']]) {
    expect(await loadPersonalHistoryFx(owner, from, to)).toBeNull();
  }
  expect(global.fetch).not.toHaveBeenCalled();
});

test('inactive owners and already cancelled callers cannot inspect history or start transport', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  workspace.resolveBrowserWorkspace(owner + '-other');
  await expect(loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06')).rejects.toMatchObject({ name: 'AbortError' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('oversized declared/streamed replies and more than 400 observations never enter the repository', async () => {
  const row = { date: '2026-11-06', rate: 0.91, asOf: '2026-11-06' };
  const responses = [
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '1000000' } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(96 * 1024 + 1)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ status: 'complete', data: Array(401).fill(row), sourceAttribution: 'Source: ECB statistics.' }),
  ];
  for (const response of responses) {
    global.fetch = jest.fn(async () => response);
    expect(await loadPersonalHistoryFx(owner, '2026-11-01', '2026-11-06')).toBeNull();
  }
  expect(await cache.getHistoryRepository().read(key())).toBeNull();
});
