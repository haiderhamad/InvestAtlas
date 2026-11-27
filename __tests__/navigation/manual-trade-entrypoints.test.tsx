/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PortfolioPage from '@/app/portfolio/page';
import TransactionsPage from '@/app/transactions/page';
import AccountDetailPage from '@/app/accounts/[venue]/page';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { MANUAL_ACCOUNTS_STORAGE_KEY, type ManualAccount } from '@/lib/accounts/manual-accounts-store';
import { MANUAL_TRANSACTIONS_STORAGE_KEY, type AppTransaction } from '@/lib/transactions/manual-store';
import { saveResolvedPersonalListing } from '@/lib/config/personal-asset-registry';

let mockVenue = 'audit-broker';
jest.mock('next/navigation', () => ({ useParams: () => ({ venue: mockVenue }) }));
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/components/layout/app-shell', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/dashboard/portfolio-donut', () => ({ __esModule: true, default: () => null, assetColor: () => '#123456' }));
jest.mock('recharts', () => ({ ResponsiveContainer: () => null }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ t: (text: string) => text, language: 'en' }) }));
jest.mock('@/lib/preferences/display-currency', () => ({ useDisplayCurrencyPreference: () => ({
  displayCurrency: 'eur', formatMoney: (value: number) => `€${value}`,
}) }));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: async () => ({
  ok: false, json: async () => ({}),
}) }));

// Record the route's inputs at the shared dialog boundary. Form behavior is
// covered by the real dialog tests.
jest.mock('@/components/layout/global-add-modal', () => ({
  __esModule: true,
  default: ({ initialType, initialVenue, initialAsset, onClose }:
    { initialType?: string; initialVenue?: string; initialAsset?: string; onClose: () => void }) => (
    <div role="dialog">
      <output aria-label="Side">{initialType}</output>
      <output aria-label="Account">{initialVenue}</output>
      <output aria-label="Asset">{initialAsset}</output>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const broker: ManualAccount = {
  id: 'broker-id', label: 'Fixture Brokerage', venue: 'audit-broker',
  kind: 'Brokerage', createdAt: '2025-01-01T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  resolveBrowserWorkspace(null);
  writeAnonymousWorkspaceMode('local_workspace');
  mockVenue = broker.venue;
});

it.each([['Portfolio', PortfolioPage], ['Ledger', TransactionsPage]] as const)(
  'opens the chosen side from the empty %s',
  (_name, Page) => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Record sell' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Side')).toHaveTextContent('sell');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record buy' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Side')).toHaveTextContent('buy');
  },
);

it('passes the compatible account when choosing a side on account detail', async () => {
  localStorage.setItem(MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([broker]));
  render(<AccountDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record buy' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Side')).toHaveTextContent('buy');
  expect(within(dialog).getByLabelText('Account')).toHaveTextContent('audit-broker');
});

it('leaves the manual cash action available on a bank account', async () => {
  mockVenue = 'audit-bank';
  localStorage.setItem(MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([
    { ...broker, venue: mockVenue, kind: 'Bank Account' },
  ]));
  render(<AccountDetailPage />);
  expect(screen.queryByRole('button', { name: 'Record buy' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
  fireEvent.click(screen.getByRole('button', { name: /Add Manual Entry/ }));
  expect(within(screen.getByRole('dialog')).getByLabelText('Account')).toHaveTextContent('audit-bank');
});

it('supplies the exact registered listing and the holding account from a Portfolio row', async () => {
  expect(saveResolvedPersonalListing({
    symbol: 'META.DE', name: 'Fixture Meta German Listing', assetClass: 'stock',
    providerSymbol: 'META.DE', exchange: 'XETRA', nativeCurrency: 'eur',
    version: 1, source: 'yahoo_chart', resolvedAt: '2025-01-01T00:00:00.000Z',
  })).toBe(true);
  const deposit: AppTransaction = {
    id: 'position', type: 'deposit', venue: broker.venue, assetClass: 'stock', asset: 'META.DE',
    quote: 'EUR', amount: 3, price: 23, total: 69, fee: 0,
    date: '2025-01-01T02:00:00Z', taxType: 'transfer_in', source: 'manual',
  };
  localStorage.setItem(MANUAL_ACCOUNTS_STORAGE_KEY, JSON.stringify([broker]));
  localStorage.setItem(MANUAL_TRANSACTIONS_STORAGE_KEY, JSON.stringify([deposit]));
  render(<PortfolioPage />);
  const row = await screen.findByRole('row', { name: /META.DE/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Record sell' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Asset')).toHaveTextContent(/^META\.DE$/);
  expect(within(dialog).getByLabelText('Account')).toHaveTextContent('audit-broker');
  expect(within(dialog).getByLabelText('Side')).toHaveTextContent('sell');
});

it('closes an open trade and removes its launchers when switching to Demo', () => {
  render(<TransactionsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Record buy' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  act(() => writeAnonymousWorkspaceMode('demo_snapshot'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record buy' })).not.toBeInTheDocument();
  expect(screen.getByText('Demo snapshot is read-only.')).toBeInTheDocument();
});
