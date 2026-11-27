/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PortfolioPage from '@/app/portfolio/page';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT,
} from '@/lib/financial-data/providers/tiingo-browser';
import { MANUAL_TRANSACTIONS_STORAGE_KEY, type AppTransaction } from '@/lib/transactions/manual-store';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

jest.mock('@/components/layout/app-shell', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/dashboard/portfolio-donut', () => ({ __esModule: true, default: () => null, assetColor: () => '#123456' }));
jest.mock('recharts', () => ({ ResponsiveContainer: () => null }));
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ t: (text: string) => text, language: 'en' }) }));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: jest.fn() }));
jest.mock('@/lib/preferences/display-currency', () => {
  const actual = jest.requireActual('@/lib/preferences/display-currency');
  return {
    ...actual,
    useDisplayCurrencyPreference: () => ({
      displayCurrency: mockCurrency, formatMoney: (value: number) => `€${value.toFixed(2)}`,
    }),
  };
});

let mockCurrency: 'eur' | 'usd' = 'eur';

const holdings = [
  ['AAPL', 'stock'],
  ['ISWD', 'etf'],
  ['BTC', 'crypto'],
  ['GOLD', 'metal'],
  ['SILVER', 'metal'],
] as const;

const transactions = holdings.map(([symbol, assetClass]): AppTransaction => ({
  id: symbol, venue: 'ibkr', type: 'deposit', asset: symbol, assetClass, quote: 'EUR',
  date: '2025-01-01T00:00:00.000Z', amount: 2, price: 20, total: 40, fee: 0,
  taxType: 'transfer_in', source: 'manual',
  ...(assetClass === 'metal' ? { metalFineness: 1000 } : {}),
}));

function response(payload: unknown, status = 200, retryAfter?: string): Response {
  return {
    ok: status === 200, status,
    headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
    json: async () => payload,
  } as Response;
}

function quote(symbol: string, price: number, observedAt = new Date().toISOString()) {
  return {
    price, freshUntil: Date.parse(observedAt) + 5 * 60_000, change24h: null, volume24h: null, marketCap: null, source: 'Fixture source',
    currency: 'eur', dataStatus: 'partial', changePeriod: 'unavailable', priceTiming: 'realtime',
    fields: {
      assetId: symbol, outputCurrency: 'EUR',
      price: { status: 'available', quality: 'observed', freshness: 'fresh', observedAt,
        value: { amount: price, currency: 'EUR' },
        provenance: { providerName: 'Fixture source', providerId: 'fixture', sourceType: 'market_api' } },
    },
  };
}

const complete = () => response({
  status: 'complete', timestamp: new Date().toISOString(), prices: {
    AAPL: quote('AAPL', 97),
    ISWD: quote('ISWD', 29),
    BTC: quote('BTC', 42000),
    GOLD: quote('GOLD', 3110.34768),
    SILVER: quote('SILVER', 31.1034768),
  },
});

const quoteRow = (symbol: string) => within(screen.getByRole('row', { name: new RegExp(`\\b${symbol}\\b`) }));

function mockRequests(getCurrent: () => Promise<Response>, getHistory?: (symbol: string) => Response) {
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/prices/current') return getCurrent();
    return getHistory?.(url.searchParams.get('symbol') ?? '') ?? response({ status: 'unavailable', prices: [] });
  });
}

beforeEach(() => {
  localStorage.clear();
  resolveBrowserWorkspace(null);
  writeAnonymousWorkspaceMode('local_workspace');
  localStorage.setItem(MANUAL_TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions));
  mockCurrency = 'eur';
  jest.mocked(fetchFinancialData).mockReset();
});

it('refreshes prices on a Tiingo credential change without refreshing on quote budget updates', async () => {
  const request = jest.fn(async () => complete());
  mockRequests(request);
  render(<PortfolioPage />);
  await waitFor(() => expect(quoteRow('AAPL').getByText('Latest available quote')).toBeInTheDocument());
  const calls = request.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT));
  });
  expect(request).toHaveBeenCalledTimes(calls);
  await act(async () => {
    window.dispatchEvent(new Event(TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT));
  });
  expect(request).toHaveBeenCalledTimes(calls + 1);
});

it('keeps fresh individual prices through an unavailable retry', async () => {
  mockRequests(jest.fn().mockResolvedValueOnce(complete()).mockResolvedValue(response({
    status: 'unavailable', prices: {},
  })));
  render(<PortfolioPage />);
  await waitFor(() => expect(quoteRow('AAPL').getByText('Latest available quote')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));
  await screen.findByText('Market-data refresh is degraded.');
  for (const [symbol] of holdings) {
    expect(quoteRow(symbol).getByText('Latest available quote')).toBeInTheDocument();
    expect(quoteRow(symbol).getByText(/Fixture source/)).toBeInTheDocument();
  }
});

it('keeps a dated sourced historical close separate from missing present value', async () => {
  mockRequests(async () => response({
    status: 'partial',
    prices: { AAPL: quote('AAPL', 97), BTC: quote('BTC', 42000), GOLD: quote('GOLD', 3110.34768) },
    issues: [{ symbol: 'ISWD', code: 'fx_unavailable' }],
  }), symbol => symbol === 'ISWD' ? response({
    contractVersion: 'history.v2', symbol: 'ISWD', currency: 'eur', status: 'partial',
    prices: [{ date: '2025-01-10', close: 29, sourceRef: 'market-1' }],
    sources: [{ kind: 'market', ref: 'market-1', providerId: 'fixture_history', providerName: 'Fixture close source' }],
  }) : response({ status: 'unavailable', prices: [] }));
  render(<PortfolioPage />);
  await waitFor(() => expect(quoteRow('ISWD').getByText('Last historical close')).toBeInTheDocument());
  expect(quoteRow('ISWD').getByText(/Fixture close source/)).toBeInTheDocument();
  expect(quoteRow('ISWD').getAllByText('Unavailable').length).toBeGreaterThan(0);
  expect(quoteRow('SILVER').getByText('Quote unavailable')).toBeInTheDocument();
  expect(quoteRow('GOLD').getByText(/100\.00\/g/)).toBeInTheDocument();
  expect(screen.getByText(/Valued positions only \(incomplete total\)/)).toBeInTheDocument();
});

it('honors a validated quote retry delay', async () => {
  mockRequests(async () => response({}, 429, '60'));
  render(<PortfolioPage />);
  await screen.findByText('Quote requests are temporarily limited.');
  expect(screen.getByRole('button', { name: 'Refresh portfolio' })).toBeDisabled();
});

it('drops a delayed request when the display currency changes', async () => {
  let resolveCurrent!: (value: Response) => void;
  const previous = new Promise<Response>(resolve => { resolveCurrent = resolve; });
  mockRequests(jest.fn().mockReturnValueOnce(previous).mockResolvedValue(response({ status: 'unavailable', prices: {} })));
  const page = render(<PortfolioPage />);
  await screen.findByRole('button', { name: 'Refreshing…' });
  mockCurrency = 'usd';
  page.rerender(<PortfolioPage />);
  await screen.findByText('Market-data refresh is degraded.');
  await act(async () => { resolveCurrent(complete()); });
  expect(quoteRow('AAPL').getByText('Quote unavailable')).toBeInTheDocument();
  expect(screen.queryByText(/Fixture source/)).not.toBeInTheDocument();
});

it('drops a delayed request during a workspace switch', async () => {
  let resolveCurrent!: (value: Response) => void;
  const previous = new Promise<Response>(resolve => { resolveCurrent = resolve; });
  mockRequests(jest.fn().mockReturnValueOnce(previous).mockResolvedValue(response({ status: 'unavailable', prices: {} })));
  render(<PortfolioPage />);
  await screen.findByRole('button', { name: 'Refreshing…' });
  act(() => writeAnonymousWorkspaceMode('demo_snapshot'));
  await act(async () => { resolveCurrent(complete()); });
  expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
  expect(screen.queryByText(/Fixture source/)).not.toBeInTheDocument();
});

it('retains other current symbols while a replacement holding loads', async () => {
  let resolveCurrent!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { resolveCurrent = resolve; });
  mockRequests(jest.fn().mockResolvedValueOnce(complete()).mockReturnValue(pending));
  render(<PortfolioPage />);
  await waitFor(() => expect(quoteRow('BTC').getByText('Latest available quote')).toBeInTheDocument());

  act(() => {
    localStorage.setItem(MANUAL_TRANSACTIONS_STORAGE_KEY, JSON.stringify([
      { ...transactions[0], id: 'META', asset: 'META' }, ...transactions.slice(1),
    ]));
    window.dispatchEvent(new Event('storage'));
  });
  expect(quoteRow('META').getByText('Loading quote…')).toBeInTheDocument();
  expect(quoteRow('BTC').getByText('Latest available quote')).toBeInTheDocument();
  expect(screen.queryByText('AAPL')).not.toBeInTheDocument();

  await act(async () => { resolveCurrent(complete()); });
  expect(quoteRow('META').getByText('Quote unavailable')).toBeInTheDocument();
  expect(quoteRow('BTC').getByText('Latest available quote')).toBeInTheDocument();
});

it('expires a previously retained observation after its freshness deadline', async () => {
  jest.useFakeTimers();
  try {
    mockRequests(jest.fn().mockResolvedValueOnce(response({
      status: 'partial', prices: { AAPL: { ...quote('AAPL', 97), freshUntil: Date.now() + 3_000 } },
    })).mockResolvedValue(response({ status: 'unavailable', prices: {} })));
    render(<PortfolioPage />);
    await waitFor(() => expect(quoteRow('AAPL').getByText('Latest available quote')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));
    await screen.findByRole('button', { name: 'Refresh portfolio' });
    expect(quoteRow('AAPL').getByText('Latest available quote')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(3_000));
    expect(quoteRow('AAPL').getByText('Quote unavailable')).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
