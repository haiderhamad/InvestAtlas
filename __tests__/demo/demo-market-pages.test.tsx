/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChartsPage from '@/app/charts/page';
import WatchlistsPage from '@/app/watchlists/page';
import PortfolioPage from '@/app/portfolio/page';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { translateAppText } from '@/lib/i18n/app-localization';
import { writeAppPreferences, type LanguagePreference } from '@/lib/preferences/app-preferences';
import * as transactionStore from '@/lib/transactions/manual-store';
import { setHiddenAccountVenues } from '@/lib/accounts/account-visibility-store';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

let mockLanguage: LanguagePreference = 'en';

jest.mock('@/components/layout/app-shell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('@/components/dashboard/portfolio-donut', () => ({
  __esModule: true,
  default: () => null,
  assetColor: () => '#123456',
}));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: jest.fn() }));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({
    language: mockLanguage,
    t: (text: string) => translateAppText(text, mockLanguage),
  }),
}));

// Keep the page's history, indicators and display calculations real, and
// observe the series it supplies to the external SVG renderer.
jest.mock('recharts', () => ({
  AreaChart: ({ data }: { data: unknown[] }) =>
    React.createElement('output', { 'aria-label': 'Chart values' }, JSON.stringify(data.at(-1))),
  Area: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ data }: { data: unknown[] }) => <output aria-label="Portfolio performance series">{JSON.stringify(data)}</output>,
  Legend: () => null,
  Line: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function response(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as Response;
}

function renderFixtureRequest(input: RequestInfo | URL): Response {
  const url = new URL(String(input), window.location.origin);
  if (url.pathname === '/api/prices/current') {
    const symbols = (url.searchParams.get('symbols') ?? '').split(',');
    return response({
      status: 'partial',
      prices: Object.fromEntries(symbols.flatMap((symbol) => {
        const series = INVESTATLAS_SHOWCASE_SNAPSHOT.history[symbol];
        if (!series) return [];
        return [[symbol, {
          price: symbol === 'DEMO-GOLD' ? 3509.09687 : series.points.at(-1)!.close,
          change24h: 1,
          changePeriod: 'session',
        }]];
      })),
      refreshPolicy: 'manual_only',
    });
  }

  const symbol = url.searchParams.get('symbol') ?? '';
  const series = INVESTATLAS_SHOWCASE_SNAPSHOT.history[symbol];
  if (!series || (url.searchParams.get('interval') ?? '1d') !== '1d') {
    return response({ prices: [], error: 'Unsupported demo interval' }, false);
  }
  return response({
    status: 'partial', dataMode: 'demo_snapshot', freshness: 'unknown', isComplete: false,
    prices: series.points.map((point) => ({
      ...point,
      open: point.open * (symbol === 'DEMO-GOLD' ? 31.1035 : 1),
      high: point.high * (symbol === 'DEMO-GOLD' ? 31.1035 : 1),
      low: point.low * (symbol === 'DEMO-GOLD' ? 31.1035 : 1),
      close: point.close * (symbol === 'DEMO-GOLD' ? 31.1035 : 1),
    })),
  });
}

describe('Demo market page units and daily chart availability', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resolveBrowserWorkspace(null);
    window.history.replaceState({}, '', '/charts?asset=DEMO-GOLD');
    mockLanguage = 'en';
    jest.mocked(fetchFinancialData).mockReset();
    jest.mocked(fetchFinancialData).mockImplementation(async (input) => renderFixtureRequest(input));
    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 800, height: 500 } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(cleanup);

  it('renders the gold chart and its moving average in EUR per fine gram', async () => {
    const { container } = render(<ChartsPage />);
    await waitFor(() => {
      expect(container.querySelector('.security-profile-price')?.textContent).toBe('€112.82/g');
    });
    const chartValues = JSON.parse(screen.getByLabelText('Chart values').textContent!);
    expect(chartValues.close).toBeCloseTo(112.82, 8);
    const gramHistory = INVESTATLAS_SHOWCASE_SNAPSHOT.history['DEMO-GOLD'].points;
    const expectedSma50 = gramHistory.slice(-50).reduce((sum, point) => sum + point.close, 0) / 50;
    expect(chartValues.sma1).toBeCloseTo(expectedSma50, 8);
    expect(container.querySelector('.callout.error')).toBeNull();
  });

  it('loads the synthetic crypto 1M view from daily bars', async () => {
    window.history.replaceState({}, '', '/charts?asset=DEMO-CRYPTO');
    const { container } = render(<ChartsPage />);
    await waitFor(() => {
      expect(container.querySelector('.security-profile-price')?.textContent).toBe('€335.00');
    });
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    await waitFor(() => {
      expect(container.querySelector('.security-profile-price')?.textContent).toBe('€335.00');
    });
    expect(container.querySelector('.callout.error')).toBeNull();
    const cryptoRequests = jest.mocked(fetchFinancialData).mock.calls
      .map(([input]) => new URL(String(input), window.location.origin))
      .filter((url) => url.searchParams.get('symbol') === 'DEMO-CRYPTO');
    expect(cryptoRequests.every((url) => url.searchParams.get('interval') === '1d')).toBe(true);
  });

  it('renders the demo gold watchlist price per gram on desktop and mobile rows', async () => {
    const { container } = render(<WatchlistsPage />);
    await waitFor(() => {
      const prices = container.querySelectorAll('td.mono, .mobile-data-value.mono');
      expect([...prices].filter((price) => price.textContent === '112.82 EUR/g')).toHaveLength(2);
    });
    const goldRow = screen.getByRole('row', { name: /DEMO-GOLD/ });
    expect(within(goldRow).getByRole('link', { name: 'Chart' }).getAttribute('href'))
      .toBe('/charts?asset=DEMO-GOLD');
  });

  it.each([
    ['en', 'Price', '€112.82/g'],
    ['de', 'Preis', '112,82\u00a0€/g'],
    ['ar', 'السعر', '\u200f١١٢٫٨٢\u00a0€/g'],
  ] as const)('shows the portfolio gold price with cents and a gram unit in %s', async (language, priceLabel, goldPrice) => {
    mockLanguage = language;
    writeAppPreferences({ language });
    const { container } = render(<PortfolioPage />);
    const goldRow = await screen.findByRole('row', { name: /DEMO-GOLD/ });
    await waitFor(() => {
      expect(goldRow.querySelectorAll('td')[2].textContent)
        .toContain(`${priceLabel} ${goldPrice}`);
    });
    const desktopPrice = within(goldRow).getByText(goldPrice, { normalizer: (text) => text });
    expect(desktopPrice.getAttribute('dir')).toBe('ltr');

    const mobileGold = [...container.querySelectorAll('.mobile-data-card')].find(
      (card) => card.querySelector('.mobile-data-title')?.textContent === 'DEMO-GOLD',
    );
    expect(within(mobileGold as HTMLElement).getByText(priceLabel)).toBeTruthy();
    expect(within(mobileGold as HTMLElement).getByText(goldPrice, { normalizer: (text) => text }).getAttribute('dir')).toBe('ltr');
  });

  it.each([
    ['de', 'Beispielhafte Goldposition (XAU) in Feingramm', 'Synthetische Beispielwerte'],
    ['ar', 'حيازة ذهب توضيحية (XAU) بالغرام النقي', 'أصول العرض التجريبية'],
  ] as const)('localizes synthetic asset and list descriptions in %s', async (language, goldName, watchlistName) => {
    mockLanguage = language;
    const chart = render(<ChartsPage />);
    await screen.findByRole('heading', { name: goldName });
    chart.unmount();

    render(<WatchlistsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(goldName).length).toBeGreaterThan(0);
      expect(screen.getAllByText(watchlistName).length).toBeGreaterThan(0);
    });
  });
});

it.each([false, true])('guides an empty visible portfolio to accounts (hidden records: %s)', async (hiddenRecords) => {
  window.localStorage.clear();
  writeAnonymousWorkspaceMode('local_workspace');
  resolveBrowserWorkspace(null);
  mockLanguage = 'en';
  if (hiddenRecords) {
    const record = transactionStore.getDemoTransactions()[0];
    setHiddenAccountVenues([record.venue]);
    jest.spyOn(transactionStore, 'getAllTransactions').mockReturnValue([record]);
  }
  jest.mocked(fetchFinancialData).mockResolvedValue(response({ prices: {} }));
  render(<PortfolioPage />);
  const action = await screen.findByRole('link', { name: 'Set up an account' });
  expect(action.getAttribute('href')).toBe('/accounts');
  expect(screen.queryByLabelText('Portfolio performance series')).toBeNull();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
