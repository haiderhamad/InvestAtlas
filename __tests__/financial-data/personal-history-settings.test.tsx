/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PersonalHistorySettings } from '@/components/settings/personal-history-settings';
import { clearEodhd, connectEodhd, loadEodhdHistory, EODHD_CHANGE_EVENT } from '@/lib/financial-data/providers/eodhd-personal';
import {
  clearPersonalHistoryCache, getPersonalHistoryCacheStats, HISTORY_CACHE_CHANGE_EVENT,
} from '@/lib/financial-data/providers/personal-history-service';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

let mockLanguage: 'en' | 'de' | 'ar' = 'en';
let mockConnectedOwner: string | null = null;
let mockDepth: 1 | 5 = 1;
jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ language: mockLanguage }) }));
jest.mock('@/lib/financial-data/providers/eodhd-personal', () => ({
  connectEodhd: jest.fn(), clearEodhd: jest.fn(), loadEodhdHistory: jest.fn(),
  hasEodhd: (owner: string) => owner === mockConnectedOwner,
  readEodhdHistoryYears: () => mockDepth,
  EODHD_CHANGE_EVENT: 'investatlas:eodhd-session-changed',
}));
jest.mock('@/lib/financial-data/providers/personal-history-service', () => ({
  clearPersonalHistoryCache: jest.fn(), getPersonalHistoryCacheStats: jest.fn(),
  HISTORY_CACHE_CHANGE_EVENT: 'investatlas:personal-history-cache-change',
}));

type CacheStats = Awaited<ReturnType<typeof getPersonalHistoryCacheStats>>;
const ownerA = 'history-ui-owner-a';
const ownerB = 'history-ui-owner-b';
const key = 'SYNTHETIC_PRIVATE_EODHD_KEY';
const statsFor = (barCount: number, ephemeralBarCount = 3): CacheStats => ({
  recordCount: barCount ? 1 : 0, barCount, ephemeralBarCount, ephemeralRecordCount: ephemeralBarCount ? 1 : 0,
  persistence: { mode: 'indexeddb', reason: null },
});
const stats = new Map<string, CacheStats>();
const connect = jest.mocked(connectEodhd);
const disconnect = jest.mocked(clearEodhd);
const historyLoad = jest.mocked(loadEodhdHistory);
const readStats = jest.mocked(getPersonalHistoryCacheStats);
const clearCache = jest.mocked(clearPersonalHistoryCache);
const originalFetch = global.fetch;

function savedCount(value: number) {
  return (_text: string, element: Element | null) => element?.getAttribute('role') === 'status'
    && element.textContent?.startsWith(`Saved daily observations: ${value} ·`) === true;
}

function emitEodhd() {
  window.dispatchEvent(new Event(EODHD_CHANGE_EVENT));
  window.dispatchEvent(new Event(SOURCE_CHANGE));
}

function enterKey() {
  const input = screen.getByLabelText('My EODHD API key') as HTMLInputElement;
  fireEvent.input(input, { target: { value: key } });
  fireEvent.click(screen.getByRole('checkbox'));
  return input;
}

beforeEach(() => {
  mockLanguage = 'en'; mockConnectedOwner = null; mockDepth = 1;
  localStorage.clear(); sessionStorage.clear();
  resolveBrowserWorkspace(ownerA);
  stats.clear(); stats.set(ownerA, statsFor(25)); stats.set(ownerB, statsFor(70));
  disconnect.mockReset().mockImplementation(() => { mockConnectedOwner = null; emitEodhd(); });
  connect.mockReset().mockImplementation(async (owner, _key, years, signal) => {
    // The real provider clears an old credential and emits both events before awaiting I/O.
    disconnect();
    await Promise.resolve();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    mockConnectedOwner = owner; mockDepth = years ?? 1; emitEodhd();
  });
  historyLoad.mockReset();
  readStats.mockReset().mockImplementation(async owner => stats.get(owner) ?? statsFor(0, 0));
  clearCache.mockReset().mockImplementation(async owner => {
    stats.set(owner, statsFor(0, 0));
    window.dispatchEvent(new Event(HISTORY_CACHE_CHANGE_EVENT));
  });
  global.fetch = jest.fn();
});
afterEach(() => { cleanup(); global.fetch = originalFetch; jest.restoreAllMocks(); });

test('requires an explicit key, plan consent and connect action without automatic price requests', async () => {
  render(<PersonalHistorySettings owner={ownerA} />);
  await screen.findByText(savedCount(25));
  expect(connect).not.toHaveBeenCalled();
  expect(historyLoad).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Test and connect EODHD' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  const input = screen.getByLabelText('My EODHD API key') as HTMLInputElement;
  fireEvent.input(input, { target: { value: key } });
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(connect).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(input.value).toBe('');
  await screen.findByText('EODHD connected for this tab');
  expect(connect).toHaveBeenCalledWith(ownerA, key, 1, expect.anything());
  expect(JSON.stringify(Object.entries(localStorage))).not.toContain(key);
  expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(key);
  expect(historyLoad).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('sends five-year entitlement only after the owner explicitly selects it', async () => {
  render(<PersonalHistorySettings owner={ownerA} />);
  enterKey();
  fireEvent.change(screen.getByRole('combobox', { name: 'History available in my plan' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test and connect EODHD' }));
  await screen.findByText('EODHD connected for this tab');
  expect(connect).toHaveBeenCalledWith(ownerA, key, 5, expect.anything());
});

test('owner changes discard unsubmitted key material, consent, entitlement and old cache statistics', async () => {
  const view = render(<PersonalHistorySettings owner={ownerA} />);
  await screen.findByText(savedCount(25));
  enterKey();
  fireEvent.change(screen.getByRole('combobox', { name: 'History available in my plan' }), { target: { value: '5' } });
  let finish!: (value: CacheStats) => void;
  readStats.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { resolveBrowserWorkspace(ownerB); });
  view.rerender(<PersonalHistorySettings owner={ownerB} />);
  expect((screen.getByLabelText('My EODHD API key') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1');
  expect(screen.queryByText(savedCount(25))).toBeNull();
  await act(async () => { finish(statsFor(70)); });
  expect(screen.getByText(savedCount(70))).toBeTruthy();
});

test('an external source change aborts an in-flight connect and permits a fresh attempt', async () => {
  let finish!: () => void;
  connect.mockImplementationOnce(() => { disconnect(); return new Promise(resolve => { finish = resolve; }); });
  render(<PersonalHistorySettings owner={ownerA} />);
  enterKey();
  fireEvent.click(screen.getByRole('button', { name: 'Test and connect EODHD' }));
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  const signal = connect.mock.calls[0][3]!;
  act(() => window.dispatchEvent(new Event(SOURCE_CHANGE)));
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('My EODHD API key') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

test.each(['owner', 'unmount'])('aborts a pending connection on %s and ignores a late error', async action => {
  let reject!: (error: Error) => void;
  connect.mockImplementationOnce(() => { disconnect(); return new Promise((_resolve, fail) => { reject = fail; }); });
  const view = render(<PersonalHistorySettings owner={ownerA} />);
  enterKey();
  fireEvent.click(screen.getByRole('button', { name: 'Test and connect EODHD' }));
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  const signal = connect.mock.calls[0][3]!;
  if (action === 'owner') {
    act(() => resolveBrowserWorkspace(ownerB));
    view.rerender(<PersonalHistorySettings owner={ownerB} />);
  } else view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { reject(new Error('OLD_OWNER_SECRET_ERROR')); });
  expect(screen.queryByRole('alert')).toBeNull();
  if (action === 'owner') expect((screen.getByLabelText('My EODHD API key') as HTMLInputElement).disabled).toBe(false);
});

test('a newer cache refresh cannot be overwritten by an older asynchronous statistics read', async () => {
  let finish!: (value: CacheStats) => void;
  readStats.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<PersonalHistorySettings owner={ownerA} />);
  stats.set(ownerA, statsFor(0, 0));
  act(() => window.dispatchEvent(new Event(HISTORY_CACHE_CHANGE_EVENT)));
  await screen.findByText(savedCount(0));
  await act(async () => { finish(statsFor(25)); });
  expect(screen.queryByText(savedCount(25))).toBeNull();
  expect(screen.getByText(savedCount(0))).toBeTruthy();
});

test('refreshes statistics after the provider’s paired source event invalidates its earlier read', async () => {
  let revision = 0;
  const invalidate = () => { revision += 1; };
  window.addEventListener(EODHD_CHANGE_EVENT, invalidate);
  window.addEventListener(SOURCE_CHANGE, invalidate);
  readStats.mockImplementation(async owner => {
    const started = revision;
    await Promise.resolve();
    if (started !== revision) throw new DOMException('Cache session changed', 'AbortError');
    return stats.get(owner)!;
  });
  try {
    render(<PersonalHistorySettings owner={ownerA} />);
    enterKey();
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect EODHD' }));
    await screen.findByText('EODHD connected for this tab');
    await screen.findByText(savedCount(25));
  } finally {
    window.removeEventListener(EODHD_CHANGE_EVENT, invalidate);
    window.removeEventListener(SOURCE_CHANGE, invalidate);
  }
});

test('explicit cache clearing affects only the displayed owner and refreshes that owner’s counts', async () => {
  localStorage.setItem('investatlas.manual-transactions::user::' + ownerA, 'SYNTHETIC_LEDGER');
  render(<PersonalHistorySettings owner={ownerA} />);
  await screen.findByText(savedCount(25));
  expect(clearCache).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete saved market history' }));
  await screen.findByText(savedCount(0));
  expect(clearCache).toHaveBeenCalledWith(ownerA);
  expect(stats.get(ownerB)?.barCount).toBe(70);
  expect(localStorage.getItem('investatlas.manual-transactions::user::' + ownerA)).toBe('SYNTHETIC_LEDGER');
  expect(disconnect).not.toHaveBeenCalled();
  expect(historyLoad).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an old owner’s late cache deletion error cannot appear in the new owner’s form', async () => {
  let reject!: (error: Error) => void;
  clearCache.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const view = render(<PersonalHistorySettings owner={ownerA} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete saved market history' }));
  await waitFor(() => expect(clearCache).toHaveBeenCalledTimes(1));
  act(() => resolveBrowserWorkspace(ownerB));
  view.rerender(<PersonalHistorySettings owner={ownerB} />);
  await act(async () => { reject(new Error('OLD_OWNER_DELETE_FAILED')); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'Delete saved market history' }) as HTMLButtonElement).disabled).toBe(false);
});

test('an inactive owner cannot mount key or cache controls', () => {
  const view = render(<PersonalHistorySettings owner={ownerB} />);
  expect(view.container.textContent).toBe('');
  expect(readStats).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test.each([
  ['en', 'History and storage', 'My EODHD API key', 'Test and connect EODHD', 'Connection unavailable.'],
  ['de', 'Historie und Speicherung', 'Mein EODHD-API-Schlüssel', 'EODHD testen und verbinden', 'Verbindung nicht verfügbar.'],
  ['ar', 'السجل والتخزين', 'مفتاح EODHD الخاص بي', 'فحص EODHD وربطه', 'الاتصال غير متاح.'],
])('keeps the %s connection, failure and memory-storage state translated', async (locale, title, inputLabel, button, failed) => {
  mockLanguage = locale as typeof mockLanguage;
  readStats.mockResolvedValue({ ...statsFor(0, 0), persistence: { mode: 'memory', reason: 'unavailable' } });
  connect.mockRejectedValue(new Error('DO_NOT_DISPLAY_PROVIDER_SECRET'));
  render(<PersonalHistorySettings owner={ownerA} />);
  expect(screen.getByText(title)).toBeTruthy();
  fireEvent.input(screen.getByLabelText(inputLabel), { target: { value: key } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: button }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(failed);
  expect(alert.textContent).not.toContain('DO_NOT_DISPLAY_PROVIDER_SECRET');
  expect((screen.getByLabelText(inputLabel) as HTMLInputElement).value).toBe('');
});
