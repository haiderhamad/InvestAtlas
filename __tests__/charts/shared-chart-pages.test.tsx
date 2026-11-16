/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DividendsPage from '@/app/dividends/page';
import SavingsPlanPage from '@/app/savings-plan/page';
import PortfolioPage from '@/app/portfolio/page';
import AnalyticsPage from '@/app/analytics/page';
import AccountDetailPage from '@/app/accounts/[venue]/page';
import type { AppTransaction } from '@/lib/transactions/manual-store';

let mockLanguage = 'en';
jest.mock('next/navigation', () => ({ useParams: () => ({ venue: 'broker' }) }));
jest.mock('@/lib/accounts/account-detail', () => ({
  ...jest.requireActual('@/lib/accounts/account-detail'),
  buildAccountMonitorSeries: () => [
    { date: '2026-11-01', shortDate: 'Nov 1', invested: 10000, marketValue: 10000, cashBalance: 0, cumulativeDividends: 0 },
    { date: '2026-11-02', shortDate: 'Nov 2', invested: 10000, marketValue: 10010, cashBalance: 0, cumulativeDividends: 0 },
  ],
}));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('@/components/dashboard/portfolio-donut', () => ({ __esModule: true, default: () => null, assetColor: () => '#123456' }));
jest.mock('@/lib/portfolio/benchmarking', () => ({
  ...jest.requireActual('@/lib/portfolio/benchmarking'),
  buildBenchmarkComparisonSeries: () => [
    { date: '2026-11-01', shortDate: 'Nov 1', portfolioPct: 1, benchmarkPct: 2, realPct: -10000 },
    { date: '2026-11-02', shortDate: 'Nov 2', portfolioPct: 3, benchmarkPct: 4, realPct: -20000 },
  ],
}));
let mockTotals: number[] = [100, 200];
jest.mock('@/components/layout/app-shell', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/layout/page-quick-start', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ t: (text: string) => text, language: mockLanguage }) }));
jest.mock('@/lib/preferences/display-currency', () => ({ useDisplayCurrencyPreference: () => ({
  displayCurrency: 'eur', formatMoney: (value: number) => `€${value}`, eurToUsdRate: null,
}) }));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: async () => ({ ok: true, json: async () => ({ prices: {} }) }) }));
jest.mock('@/lib/storage/workspace-storage', () => ({ readWorkspaceStorageItem: () => null, writeWorkspaceStorageItem: () => undefined }));
jest.mock('@/lib/transactions/manual-store', () => ({
  MANUAL_TRANSACTIONS_EVENT: 'test-transactions',
  getAllTransactions: () => mockTotals.map((total, index) => ({
    id: `dividend-${index}`, date: `2026-0${index + 8}-01T00:00:00Z`, venue: 'broker', type: 'dividend', asset: 'AAPL',
    assetClass: 'stock', quote: 'EUR', amount: 1, price: total, total, fee: 0, taxType: 'dividend_income', source: 'manual',
  } satisfies AppTransaction)),
}));
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children, { width: 800, height: 320 } as object) };
});
afterEach(() => { cleanup(); mockLanguage = 'en'; mockTotals = [100, 200]; });

it.each([{ values: [100, 200] }, { values: [100, 100] }, { values: [0, 0] }, { values: [-100, 200] }])('keeps dividend bar lengths proportional around zero for $values', async ({ values }) => {
  mockTotals = values;
  const { container } = render(<DividendsPage />);
  const labels = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(labels.length).toBeGreaterThan(0);
  if (values.every(value => value >= 0)) expect(labels).toContain('€0');
  if (values.some(value => value < 0)) {
    expect(labels.some(text => text?.startsWith('€-'))).toBe(true);
    expect(labels.some(text => text?.startsWith('€') && !text.includes('-'))).toBe(true);
  }
  if (values[0] === 100 && values[1] === 200) {
    await waitFor(() => expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(2), { timeout: 2500 });
    const bars = [...container.querySelectorAll('.recharts-bar-rectangle path')];
    const heights = bars.map(bar => Number(bar.getAttribute('height')));
    expect(heights).toHaveLength(2);
    expect(heights[1] / heights[0]).toBeCloseTo(2, 1);
  }
});

it('places Arabic dividend tick labels outside the right side of the plot', () => {
  mockLanguage = 'ar';
  const { container } = render(<DividendsPage />);
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')];
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every(node => Number(node.getAttribute('x')) > 0 && node.getAttribute('text-anchor') === 'start')).toBe(true);
});

it('distinguishes small savings balances instead of labeling every tick 0k', () => {
  const { container } = render(<SavingsPlanPage />);
  fireEvent.change(container.querySelectorAll('input[type="number"]')[0], { target: { value: '1' } });
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(new Set(ticks).size).toBeGreaterThan(2);
});


it('labels portfolio percentage series as performance and a zero-percent reference', () => {
  const { container } = render(<PortfolioPage />);
  const legend = container.querySelector('.recharts-default-legend');
  expect(legend?.textContent).toContain('Performance');
  expect(legend?.textContent).toContain('0% reference');
});

it('scales analytics using the plotted series while preserving the hidden inflation metric', async () => {
  const { container } = render(<AnalyticsPage />);
  await waitFor(() => expect(container.querySelector('.recharts-yAxis-tick-labels')).not.toBeNull());
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(ticks.every(text => !text?.includes('-'))).toBe(true);
  expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true');
});


it('keeps account balance movement ticks precise and exposes range selection', async () => {
  const { container } = render(<AccountDetailPage />);
  await waitFor(() => expect(container.querySelector('.recharts-yAxis-tick-labels')).not.toBeNull());
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(new Set(ticks).size).toBeGreaterThan(2);
  expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
});


it.each(['de', 'ar'])('localizes dashboard-sized savings axes in %s', (language) => {
  mockLanguage = language;
  const { container } = render(<SavingsPlanPage />);
  fireEvent.change(container.querySelectorAll('input[type="number"]')[0], { target: { value: '1' } });
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')];
  expect(new Set(ticks.map(node => node.textContent)).size).toBeGreaterThan(2);
  if (language === 'ar') {
    expect(ticks.some(node => /[٠-٩]/.test(node.textContent ?? ''))).toBe(true);
    expect(ticks.every(node => node.getAttribute('text-anchor') === 'start')).toBe(true);
  }
});
