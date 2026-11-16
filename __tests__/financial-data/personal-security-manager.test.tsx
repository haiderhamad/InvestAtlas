/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PersonalSecurityManager } from '@/components/settings/personal-security-manager';
import { searchYahooPersonalListings, resolveYahooPersonalListing } from '@/lib/financial-data/providers/yahoo-personal-discovery';
import { seedYahooPersonalSeries } from '@/lib/financial-data/providers/yahoo-personal';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { readUserAssets, writeUserAssets } from '@/lib/config/user-assets-store';
import { getPersonalAssetConfig } from '@/lib/config/personal-asset-registry';
import { getAssetShariahStatus } from '@/lib/config/supported-assets';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID as localOwner } from '@/lib/runtime/local-personal-provider';

let mockUser: { id: string } | null = null;
let mockAuthLoading = false;
let mockLanguage: 'en' | 'de' | 'ar' = 'en';
jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: mockUser, loading: mockAuthLoading }) }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ language: mockLanguage }) }));
jest.mock('@/lib/financial-data/providers/yahoo-personal-discovery', () => ({
  searchYahooPersonalListings: jest.fn(), resolveYahooPersonalListing: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/yahoo-personal', () => ({ seedYahooPersonalSeries: jest.fn() }));

const deployment = require('@/lib/runtime/deployment-mode') as { INVESTATLAS_DEPLOYMENT_MODE: string };
const search = jest.mocked(searchYahooPersonalListings);
const resolveListing = jest.mocked(resolveYahooPersonalListing);
const seed = jest.mocked(seedYahooPersonalSeries);
const candidate = { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', exchange: 'NMS' } as const;
const instrument = {
  version: 1, ...candidate, providerSymbol: 'ADBE', nativeCurrency: 'usd',
  source: 'yahoo_chart', resolvedAt: '2026-11-07T12:00:00.000Z',
} as const;
const series = {
  providerId: 'yahoo_personal_daily', assetSymbol: 'ADBE', providerSymbol: 'ADBE',
  exchange: 'NMS', assetClass: 'stock', listingCurrency: 'USD', cacheStatus: 'miss',
  retrievedAt: instrument.resolvedAt, latestObservationAt: '2026-11-06',
  bars: [
    { date: '2026-11-05', open: 90, high: 100, low: 85, close: 95, volume: 1000 },
    { date: '2026-11-06', open: 95, high: 105, low: 90, close: 100, volume: null },
  ],
} as const;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  mockUser = null; mockAuthLoading = false; mockLanguage = 'en';
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'local_personal';
  localStorage.setItem('investatlas.anonymous-workspace-mode', 'local_workspace');
  resolveBrowserWorkspace(null);
  clearPublicSourceConsent();
  saveSourceSelection(localOwner, { ...readSourceSelection(localOwner), yahoo: true });
  setPublicSourceConsent(localOwner, ['yahoo']);
  search.mockReset().mockResolvedValue([candidate]);
  resolveListing.mockReset().mockResolvedValue({ instrument, series: { ...series, bars: [...series.bars] } });
  seed.mockReset();
});
afterEach(() => { cleanup(); clearPublicSourceConsent(); jest.restoreAllMocks(); });

async function review() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review ADBE' }));
  return await screen.findByRole('button', { name: 'Track for review' });
}

test('requires an explicit metadata review before tracking and keeps Shariah evidence insufficient', async () => {
  render(<PersonalSecurityManager />);
  const confirm = await review();
  expect(search).toHaveBeenCalledWith(localOwner, 'Adobe', expect.anything());
  expect(resolveListing).toHaveBeenCalledWith(localOwner, 'ADBE', expect.anything());
  expect(readUserAssets()).toEqual([]);
  expect(seed).not.toHaveBeenCalled();
  expect(screen.getByText('USD').closest('bdi')?.dir).toBe('ltr');
  expect(screen.getByText('NMS').closest('bdi')?.dir).toBe('ltr');
  expect(screen.getByText('Insufficient Shariah evidence')).toBeTruthy();
  expect(screen.queryByText('Shariah-compliant')).toBeNull();
  fireEvent.click(confirm);
  await screen.findByText('Tracked for review. Shariah evidence is still insufficient.');
  expect(readUserAssets()).toEqual([{ symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'stock', listing: instrument }]);
  expect(getAssetShariahStatus(getPersonalAssetConfig('ADBE')!)).toBe('insufficient_data');
  expect(seed).toHaveBeenCalledWith(localOwner, series);
});

test('tracks a verified identity without fabricating or seeding missing history', async () => {
  resolveListing.mockResolvedValue({ instrument });
  render(<PersonalSecurityManager />);
  fireEvent.click(await review());
  await screen.findByText('Tracked for review. Shariah evidence is still insufficient.');
  expect(readUserAssets()[0].listing).toEqual(instrument);
  expect(seed).not.toHaveBeenCalled();
});

test('lets an owner resolve a legacy holding while preserving existing metadata', async () => {
  writeUserAssets([{ symbol: 'ADBE', name: 'Older holding', assetClass: 'stock', isin: 'US00724F1012' }]);
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Unresolved holdings' }), { target: { value: 'ADBE' } });
  expect((screen.getByRole('textbox', { name: 'Search securities' }) as HTMLInputElement).value).toBe('ADBE');
  expect(search).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review ADBE' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Track for review' }));
  await waitFor(() => expect(readUserAssets()[0]).toMatchObject({ listing: instrument, isin: 'US00724F1012' }));
  expect(screen.queryByRole('combobox', { name: 'Unresolved holdings' })).toBeNull();
});

test('shows the source-consent requirement and prevents calls while Yahoo is off', () => {
  clearPublicSourceConsent();
  render(<PersonalSecurityManager />);
  expect(screen.getByText('Enable Yahoo and approve personal use under My market data before searching.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  expect(search).not.toHaveBeenCalled();
});

test('shows the separate Shariah review requirement before any search', () => {
  render(<PersonalSecurityManager />);
  expect(screen.getByText('Listing details do not establish Shariah compliance. A separate review is required.')).toBeTruthy();
});

test.each(['public_demo', 'legacy'])('renders no personal manager in %s', mode => {
  deployment.INVESTATLAS_DEPLOYMENT_MODE = mode;
  const view = render(<PersonalSecurityManager />);
  expect(view.container.textContent).toBe('');
  expect(search).not.toHaveBeenCalled();
});

test('renders no personal manager in the anonymous showcase or without a private owner', () => {
  localStorage.setItem('investatlas.anonymous-workspace-mode', 'demo_snapshot');
  const view = render(<PersonalSecurityManager />);
  expect(view.container.textContent).toBe('');
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  view.rerender(<PersonalSecurityManager />);
  expect(view.container.textContent).toBe('');
});

test('rejects an obsolete result after the query changes even if the provider ignores abort', async () => {
  let finish!: (value: typeof candidate[]) => void;
  search.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PersonalSecurityManager />);
  const input = screen.getByRole('textbox', { name: 'Search securities' });
  fireEvent.change(input, { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  const signal = search.mock.calls[0][2]!;
  fireEvent.change(input, { target: { value: 'Other listing' } });
  await act(async () => { finish([candidate]); });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: 'Review ADBE' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Track for review' })).toBeNull();
});

test('query edits clear a resolved review before it can be saved', async () => {
  render(<PersonalSecurityManager />);
  await review();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Other listing' } });
  expect(screen.queryByRole('button', { name: 'Track for review' })).toBeNull();
  expect(readUserAssets()).toEqual([]);
});

test.each(['consent', 'source'])('clears a pending resolution and review after %s changes', async kind => {
  let finish!: (value: { instrument: typeof instrument }) => void;
  resolveListing.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review ADBE' }));
  await waitFor(() => expect(resolveListing).toHaveBeenCalledTimes(1));
  const signal = resolveListing.mock.calls[0][2]!;
  act(() => {
    if (kind === 'consent') { clearPublicSourceConsent(); setPublicSourceConsent(localOwner, ['yahoo']); }
    else saveSourceSelection(localOwner, { ...readSourceSelection(localOwner), yahoo: false });
  });
  await act(async () => { finish({ instrument }); });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: 'Track for review' })).toBeNull();
  expect(readUserAssets()).toEqual([]);
});

test('private owner changes abort pending work and never display another owner’s review', async () => {
  deployment.INVESTATLAS_DEPLOYMENT_MODE = 'private_cloud';
  mockUser = { id: 'owner-a' };
  resolveBrowserWorkspace('owner-a'); setPublicSourceConsent('owner-a', ['yahoo']);
  let finish!: (value: { instrument: typeof instrument }) => void;
  resolveListing.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review ADBE' }));
  await waitFor(() => expect(resolveListing).toHaveBeenCalledTimes(1));
  const signal = resolveListing.mock.calls[0][2]!;
  mockUser = { id: 'owner-b' };
  act(() => { resolveBrowserWorkspace('owner-b'); setPublicSourceConsent('owner-b', ['yahoo']); });
  view.rerender(<PersonalSecurityManager />);
  await act(async () => { finish({ instrument }); });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Adobe Inc.')).toBeNull();
  expect(readUserAssets()).toEqual([]);
});

test('shows an actionable unsupported message without allowing malformed identities to be tracked', async () => {
  resolveListing.mockResolvedValue({ instrument: { ...instrument, nativeCurrency: 'gbp' } } as never);
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review ADBE' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Only verified EUR/USD stocks and ETFs are supported.');
  expect(screen.queryByRole('button', { name: 'Track for review' })).toBeNull();
  expect(readUserAssets()).toEqual([]);
});

test('keeps a storage failure visible and does not seed or claim a saved listing', async () => {
  render(<PersonalSecurityManager />);
  const confirm = await review();
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
  fireEvent.click(confirm);
  expect((await screen.findByRole('alert')).textContent).toContain('Could not save this listing. Check browser storage and existing asset details.');
  expect(seed).not.toHaveBeenCalled();
  expect(readUserAssets()).toEqual([]);
});

test.each([
  ['en', 'My securities', 'Search securities', 'Search', 'ltr'],
  ['de', 'Meine Wertpapiere', 'Wertpapiere suchen', 'Suchen', 'ltr'],
  ['ar', 'أوراقي المالية', 'البحث عن الأوراق المالية', 'بحث', 'rtl'],
])('provides a complete %s search surface with the correct writing direction', (locale, title, label, button, direction) => {
  mockLanguage = locale as typeof mockLanguage;
  render(<PersonalSecurityManager />);
  const heading = screen.getByRole('heading', { name: title });
  expect(heading.closest('section')?.dir).toBe(direction);
  expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
  expect(screen.getByRole('button', { name: button })).toBeTruthy();
});

test('does not promote a financial or Islamic name into a compliance claim', async () => {
  resolveListing.mockResolvedValue({ instrument: { ...instrument, name: 'Islamic Halal World Fund', assetClass: 'etf' } });
  render(<PersonalSecurityManager />);
  await review();
  expect(screen.getByText('Insufficient Shariah evidence')).toBeTruthy();
  expect(readUserAssets()).toEqual([]);
});

test.each([
  ['de', 'Wertpapiere suchen', 'Suchen', 'Prüfen ADBE', 'Börsennotierung prüfen', 'Unzureichende Scharia-Nachweise', 'Zur Prüfung vormerken', 'Zur Prüfung vorgemerkt. Die Scharia-Nachweise sind weiterhin unzureichend.'],
  ['ar', 'البحث عن الأوراق المالية', 'بحث', 'مراجعة ADBE', 'مراجعة بيانات الإدراج', 'أدلة شرعية غير كافية', 'متابعة للمراجعة', 'تمت الإضافة للمتابعة والمراجعة. الأدلة الشرعية ما زالت غير كافية.'],
])('completes the review and confirmation in %s without English fallback', async (locale, label, searchLabel, candidateLabel, reviewTitle, status, trackLabel, saved) => {
  mockLanguage = locale as typeof mockLanguage;
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: searchLabel }));
  fireEvent.click(await screen.findByRole('button', { name: candidateLabel }));
  const track = await screen.findByRole('button', { name: trackLabel });
  expect(screen.getByRole('heading', { name: reviewTitle })).toBeTruthy();
  expect(screen.getByText(status)).toBeTruthy();
  expect(screen.queryByText('Review this listing')).toBeNull();
  expect(screen.queryByText('Insufficient Shariah evidence')).toBeNull();
  expect(screen.getByText('ADBE').closest('bdi')?.dir).toBe('ltr');
  fireEvent.click(track);
  await screen.findByText(saved);
  expect(readUserAssets()[0].listing).toEqual(instrument);
});

test.each([
  ['en', 'Search securities', 'Search', 'Search is unavailable.'],
  ['de', 'Wertpapiere suchen', 'Suchen', 'Die Suche ist nicht verfügbar.'],
  ['ar', 'البحث عن الأوراق المالية', 'بحث', 'البحث غير متاح.'],
])('shows a translated %s failure without exposing upstream error content', async (locale, label, button, expected) => {
  mockLanguage = locale as typeof mockLanguage;
  search.mockRejectedValue(new Error('DO_NOT_DISPLAY_UPSTREAM_ERROR'));
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: 'Adobe' } });
  fireEvent.click(screen.getByRole('button', { name: button }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(expected);
  expect(alert.textContent).not.toContain('DO_NOT_DISPLAY_UPSTREAM_ERROR');
});

test('provides loading and empty-result feedback without automatically resolving candidates', async () => {
  let finish!: (value: []) => void;
  search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'Unknown listing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.getByRole('status').textContent).toBe('Searching…');
  await act(async () => { finish([]); });
  expect(screen.getByRole('status').textContent).toBe('No matching securities. Try an exact ticker or another name.');
  expect(resolveListing).not.toHaveBeenCalled();
});

test('shows the actual EUR ETF metadata before tracking a new European listing', async () => {
  const european = { symbol: 'FUSD.DE', name: 'European fund', assetClass: 'etf', exchange: 'GER' } as const;
  search.mockResolvedValue([european]);
  resolveListing.mockResolvedValue({ instrument: {
    ...instrument, ...european, providerSymbol: 'FUSD.DE', nativeCurrency: 'eur',
  } });
  render(<PersonalSecurityManager />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search securities' }), { target: { value: 'European fund' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review FUSD.DE' }));
  await screen.findByRole('button', { name: 'Track for review' });
  expect(screen.getByText('EUR')).toBeTruthy();
  expect(screen.getByText('ETF')).toBeTruthy();
  expect(screen.getByText('GER')).toBeTruthy();
  expect(readUserAssets()).toEqual([]);
});
