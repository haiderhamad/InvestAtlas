/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChartsPage from '@/app/charts/page';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import {
  TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT,
} from '@/lib/financial-data/providers/tiingo-browser';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import type { LanguagePreference } from '@/lib/preferences/app-preferences';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { availableField, createMoney, unavailableField } from '@/lib/financial-data/contracts';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';

let mockShellGate = false;
let mockRealSvg = false;
let mockCurrency: 'usd' | 'eur' = 'usd';
let mockLanguage: LanguagePreference = 'en';
let mockUser = { id: 'chart-test' };
jest.mock('@/components/layout/app-shell', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => mockShellGate ? <p>Loading cloud workspace</p> : children }));
jest.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: jest.fn() }));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({
    language: mockLanguage,
    t: (text: string) => jest.requireActual('@/lib/i18n/app-localization').translateAppText(text, mockLanguage),
  }),
}));
jest.mock('@/lib/preferences/display-currency', () => ({
  useDisplayCurrencyPreference: () => ({ displayCurrency: mockCurrency }),
  formatQuoteCurrency: (value: number) => `$${value.toFixed(2)}`,
}));
// Inspect the real page's boundary to the external SVG renderer, keeping
// fetching/state/indicator/window calculations real.
jest.mock('recharts', () => {
  const real = jest.requireActual('recharts');
  const mock = {
    AreaChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => <><output aria-label="Chart observations">{JSON.stringify(data)}</output>{React.Children.toArray(children).filter((child) => !React.isValidElement(child) || child.type !== 'defs')}</>,
    Area: ({ isAnimationActive }: { isAnimationActive: boolean }) => <output aria-label="Chart animation">{String(isAnimationActive)}</output>,
    CartesianGrid: () => null,
    Legend: () => null,
    Line: () => null,
    ReferenceLine: () => null,
    Tooltip: () => null,
    XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) => <output aria-label="Chart time labels">{[tickFormatter('2026-09-07T01:00:00Z'), tickFormatter('2026-09-07T02:00:00Z')].join('|')}</output>,
    YAxis: ({ domain, yAxisId }: { domain: unknown; yAxisId?: string }) => yAxisId ? null : <output aria-label="Chart price domain">{JSON.stringify(domain)}</output>,
  };
  return { ...real, ...Object.fromEntries(Object.entries(mock).map(([key, component]) => [
    key, (props: object) => React.createElement(mockRealSvg ? real[key] : component, props),
  ])) };
});

const daily = Array.from({ length: 250 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), close: 0.00001,
}));
const reply = (prices = daily) => ({ ok: true, json: async () => ({ prices, status: 'fresh' }) }) as Response;
const observations = () => JSON.parse(screen.getByLabelText('Chart observations').textContent!);

function sourcedQuote(symbol: string, price: number): CurrentPriceSnapshot {
  const source = symbol === 'GOLD' || symbol === 'SILVER' ? 'Gold API' : 'Yahoo Finance';
  const empty = unavailableField('not_provided');
  return {
    price, source, currency: 'usd', dataStatus: 'partial', change24h: null,
    volume24h: null, marketCap: null, changePeriod: 'unavailable', priceTiming: 'delayed',
    fields: {
      assetId: symbol, listingCurrency: 'USD', outputCurrency: 'USD',
      price: availableField(createMoney(price, 'USD'), {
        quality: 'observed', freshness: 'fresh', observedAt: '2026-11-06T16:00:00Z', asOf: '2026-11-06',
        provenance: { providerId: source, providerName: source, retrievedAt: '2026-11-08T09:00:00Z' },
      }),
      previousClose: empty, changePercent: empty, volume: empty, marketCap: empty,
      yearHigh: empty, yearLow: empty,
    },
  };
}

it.each([
  ['GOLD', 3110.34768, '$100.00/g'], ['SILVER', 31.1034768, '$1.00/g'], ['HLAL', 68.14, '$68.14'],
])('shows the independent %s quote when chart history is unavailable', async (symbol, price, expected) => {
  window.history.replaceState({}, '', `/charts?asset=${symbol}`);
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/prices/current') {
      const requested = url.searchParams.get('symbols')!;
      return { ok: true, json: async () => ({ prices: { [requested]: sourcedQuote(requested, Number(price)) } }) } as Response;
    }
    return reply([]);
  });
  render(<ChartsPage />);
  await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  expect(screen.getByText('Latest available quote')).toBeTruthy();
  expect(screen.getByText('History unavailable.')).toBeTruthy();
});

it('keeps late quotes attached to their asset after a selection change', async () => {
  let finishOld!: (value: Response) => void;
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/prices/current') {
      const requested = url.searchParams.get('symbols')!;
      if (requested === 'BTC') return new Promise(resolve => { finishOld = resolve; });
      return { ok: true, json: async () => ({ prices: { [requested]: sourcedQuote(requested, 3110.34768) } }) } as Response;
    }
    return reply();
  });
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('tab', { name: 'Metals' }));
  await screen.findByText('$100.00/g');
  await act(async () => finishOld({ ok: true, json: async () => ({ prices: { BTC: sourcedQuote('BTC', 999) } }) } as Response));
  expect(screen.getByText('$100.00/g')).toBeTruthy();
});

it.each(['currency', 'workspace', 'account', 'source', 'Tiingo credential'] as const)('clears the previous quote and historical close after a %s change', async change => {
  let oldScope = true;
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    if (!oldScope) return new Promise<Response>(() => {});
    if (String(input).startsWith('/api/prices/current?')) {
      return { ok: true, json: async () => ({ prices: { BTC: sourcedQuote('BTC', 321) } }) } as Response;
    }
    return reply([{ date: '2026-11-19', close: 320 }]);
  });
  const chart = render(<ChartsPage />);
  expect(await screen.findByText('$321.00')).toBeTruthy();
  expect(observations()).toMatchObject([{ close: 320 }]);
  oldScope = false;

  act(() => {
    if (change === 'currency') mockCurrency = 'eur';
    else if (change === 'workspace') resolveBrowserWorkspace('another-chart-owner');
    else if (change === 'account') mockUser = { id: 'another-chart-owner' };
    else if (change === 'Tiingo credential') window.dispatchEvent(new Event(TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT));
    else {
      const selection = readSourceSelection('chart-test');
      saveSourceSelection('chart-test', { ...selection, yahoo: !selection.yahoo });
    }
    chart.rerender(<ChartsPage />);
  });

  expect(screen.queryByText('$321.00')).toBeNull();
  expect(screen.queryByText('Last historical close')).toBeNull();
  expect(screen.queryByLabelText('Chart observations')).toBeNull();
  expect(screen.getByText('Loading quote…')).toBeTruthy();
});

it('keeps history and quote when the Tiingo request budget changes', async () => {
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    if (String(input).startsWith('/api/prices/current?')) {
      return { ok: true, json: async () => ({ prices: { BTC: sourcedQuote('BTC', 321) } }) } as Response;
    }
    return reply([{ date: '2026-11-19', close: 320 }]);
  });
  render(<ChartsPage />);
  expect(await screen.findByText('$321.00')).toBeTruthy();
  expect(observations()).toMatchObject([{ close: 320 }]);
  jest.mocked(fetchFinancialData).mockClear();

  act(() => window.dispatchEvent(new Event(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT)));

  expect(screen.getByText('$321.00')).toBeTruthy();
  expect(observations()).toMatchObject([{ close: 320 }]);
  expect(fetchFinancialData).not.toHaveBeenCalled();
});

it('labels history as a historical close when the separate quote is unavailable', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  expect(await screen.findByText('Last historical close')).toBeTruthy();
});

it.each([
  ['another market source', { sourceRef: 'market_2' }, 'Latest market source'],
  ['legacy missing reference', {}, 'Earlier market source'],
  ['an unresolved reference', { sourceRef: 'unlisted' }, null],
  ['an explicit null reference', { sourceRef: null }, null],
  ['an FX reference', { sourceRef: 'fx_1' }, null],
  ['an unknown provider', { sourceRef: 'market_3' }, null],
] as const)('attributes the latest fall-back close with %s', async (_case, metadata, expectedSource) => {
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: true, json: async () => ({
    status: 'partial',
    prices: [
      { date: '2026-11-17', close: 111, sourceRef: 'market_1' },
      { date: '2026-11-18', close: 222, ...metadata },
    ],
    sources: [
      { ref: 'market_1', kind: 'market', providerName: 'Earlier market source' },
      { ref: 'market_2', kind: 'market', providerId: 'market_latest', providerName: 'Latest market source' },
      { ref: 'fx_1', kind: 'fx', providerId: 'fx', providerName: 'FX source' },
      { ref: 'market_3', kind: 'market', providerId: 'unknown_provider', providerName: 'Unknown provider' },
    ],
  }) } as Response);
  render(<ChartsPage />);
  const fallback = (await screen.findByText('Last historical close')).parentElement!;
  expect(screen.getByText('$222.00')).toBeTruthy();
  expect(fallback.textContent).toBe(`Last historical close · USD${expectedSource ? ` · ${expectedSource}` : ''} · As of Nov 18, 2026`);
});

it.each([
  { source: 'InvestAtlas synthetic showcase data', providerId: 'investatlas_demo_snapshot', synthetic: true, dataMode: 'demo_snapshot' },
  { source: 'Twelve Data (official AAPL demo history)', providerId: 'twelve_demo_daily', synthetic: false, dataMode: 'public_market_api' },
])('identifies a close from $source as demo data', async ({ source, providerId, synthetic, dataMode }) => {
  window.history.replaceState({}, '', `/charts?asset=${synthetic ? 'BTC' : 'AAPL'}`);
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: true, json: async () => ({
    status: 'partial', synthetic, dataMode,
    prices: [{ date: '2026-11-18', close: 222, sourceRef: 'demo_1' }],
    sources: [{ ref: 'demo_1', kind: 'market', providerId, providerName: source }],
  }) } as Response);
  render(<ChartsPage />);
  const fallback = (await screen.findByText('Illustrative demo close')).parentElement!;
  expect(fallback.textContent).toContain(source);
  expect(screen.queryByText('Last historical close')).toBeNull();
});

it('keeps a still-fresh quote after a failed refresh, then shows the dated historical close on expiry', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  try {
    let refresh = false;
    const quote = sourcedQuote('BTC', 123);
    Object.assign(quote, { freshUntil: Date.parse('2026-11-20T12:01:00Z') });
    quote.fields.price = availableField(createMoney(123, 'USD'), {
      quality: 'observed', freshness: 'fresh',
      observedAt: '2026-11-20T11:56:00Z', asOf: '2026-11-20T11:56:00Z',
      provenance: { providerId: 'coingecko_public', providerName: 'CoinGecko', retrievedAt: '2026-11-20T12:00:00Z' },
    });
    quote.source = 'CoinGecko';
    jest.mocked(fetchFinancialData).mockImplementation(async input => {
      if (!String(input).startsWith('/api/prices/current?')) return { ok: true, json: async () => ({
        status: 'partial', prices: [{ date: '2026-11-19', close: 120 }],
        sources: [{ kind: 'market', providerName: 'Historical source' }],
      }) } as Response;
      if (refresh) return { ok: false, status: 502 } as Response;
      return { ok: true, json: async () => ({ status: 'partial', prices: { BTC: quote } }) } as Response;
    });
    render(<ChartsPage />);
    expect(await screen.findByText('$123.00')).toBeTruthy();
    const quoteDetails = screen.getByText(/Nov 20, 2026, 11:56 AM UTC/);
    expect(within(quoteDetails).getByText('USD')).toBeTruthy();
    refresh = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }));
    expect(await screen.findByText('Quote refresh failed.')).toBeTruthy();
    expect(screen.getByText('$123.00')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(60_001); });
    expect(screen.queryByText('$123.00')).toBeNull();
    expect(await screen.findByText('Last historical close')).toBeTruthy();
    expect(screen.getByText('$120.00')).toBeTruthy();
    expect(screen.getByText(/As of Nov 19, 2026/)).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('prevents a manual quote retry until the reported rate limit expires', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(fetchFinancialData).mockImplementation(async input => {
      if (!String(input).startsWith('/api/prices/current?')) return reply([]);
      return {
        ok: false, status: 429, headers: new Headers({ 'Retry-After': '15' }),
      } as Response;
    });
    render(<ChartsPage />);
    expect(await screen.findByText('Quote requests are temporarily limited.')).toBeTruthy();
    expect(screen.getByText(/Retry available at/)).toBeTruthy();
    const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh quote' });
    expect(retry.disabled).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Metals' }));
    expect(jest.mocked(fetchFinancialData).mock.calls.filter(([input]) => String(input).startsWith('/api/prices/current?'))).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(15_001); });
    expect(retry.disabled).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

it('localizes unavailable primary history instead of rendering provider error text', async () => {
  mockLanguage = 'de';
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: true, json: async () => ({
    prices: [], error: 'No historical data available for BTC',
  }) } as Response);
  render(<ChartsPage />);
  expect(await screen.findByText('Historie nicht verfügbar.')).toBeTruthy();
  expect(screen.queryByText('No historical data available for BTC')).toBeNull();
});

it('renders fine-gram prices and daily-observation labels for close-only metal history', async () => {
  window.history.replaceState({}, '', '/charts?asset=GOLD');
  jest.mocked(fetchFinancialData).mockImplementation(async input => {
    if (String(input).startsWith('/api/prices/current?')) return { ok: true, json: async () => ({ prices: {} }) } as Response;
    return { ok: true, json: async () => ({
      prices: [
        { date: '2026-11-13', close: 31.1035, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' },
        { date: '2026-11-14', close: 62.207, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' },
      ], status: 'partial', adjustment: 'raw_unadjusted',
      sources: [{ kind: 'market', providerId: 'standard_bullion_daily', providerName: 'Standard Bullion (indicative daily closes)' }],
    }) } as Response;
  });
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(2));
  // The plot intentionally projects close-only chart data; the API/cache tests
  // separately verify that unavailable native OHLC remains null.
  expect(observations().map((point: { close: number }) => point.close)).toEqual([1, 2]);
  expect(screen.getAllByText(/Daily observations/).length).toBeGreaterThan(0);
});

it('does not promise a 24-hour maximum for an older saved metal history fallback', async () => {
  window.history.replaceState({}, '', '/charts?asset=GOLD');
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: true, json: async () => ({
    prices: [{ date: '2026-01-01', close: 31.1035, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }],
    status: 'partial', freshness: 'stale', cache: { status: 'hit_stale' }, adjustment: 'raw_unadjusted',
  }) } as Response);
  render(<ChartsPage />);
  expect(await screen.findByText('Saved history is shown because refresh is unavailable. Check the last observation date.')).toBeTruthy();
  expect(screen.queryByText(/up to 24 hours old/)).toBeNull();
});

it('does not download the current quote again when only the chart range changes', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '1M' }));
  fireEvent.click(screen.getByRole('button', { name: '3Y' }));
  await waitFor(() => expect(observations()).toHaveLength(250));
  expect(jest.mocked(fetchFinancialData).mock.calls.filter(([input]) => String(input).startsWith('/api/prices/current?'))).toHaveLength(1);
});

beforeEach(() => {
  mockShellGate = false;
  mockRealSvg = false;
  mockCurrency = 'usd';
  mockLanguage = 'en';
  mockUser = { id: 'chart-test' };
  resolveBrowserWorkspace(mockUser.id);
  window.localStorage.clear();
  window.history.replaceState({}, '', '/charts');
  jest.mocked(fetchFinancialData).mockReset();
  jest.mocked(fetchFinancialData).mockResolvedValue(reply());
  global.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 800, height: 500 } } as ResizeObserverEntry], this); }
    disconnect() {} unobserve() {}
  };
});
afterEach(cleanup);

it('renders the measured chart when a cloud workspace gate mounts its surface later', async () => {
  mockShellGate = true;
  const page = render(<ChartsPage />);
  expect(screen.queryByRole('group', { name: 'Price · Bitcoin' })).toBeNull();
  await act(async () => {});

  mockShellGate = false;
  page.rerender(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));

  // Reconnection can gate and remount the surface without remounting the page.
  mockShellGate = true;
  page.rerender(<ChartsPage />);
  expect(screen.queryByLabelText('Chart observations')).toBeNull();
  mockShellGate = false;
  page.rerender(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
});

it('keeps SMA calculation valid while the period draft is empty or fractional', async () => {
  render(<ChartsPage />);
  const input = (await screen.findAllByRole('spinbutton'))[0];
  await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
  fireEvent.change(input, { target: { value: '' } });
  expect((input as HTMLInputElement).value).toBe('');
  expect(observations().at(-1).sma1).toBeCloseTo(0.00001, 10);
  fireEvent.change(input, { target: { value: '2.5' } });
  expect(observations().at(-1).sma1).toBeCloseTo(0.00001, 10);
  fireEvent.blur(input);
  expect((input as HTMLInputElement).value).toBe('50');
});

it('leaves each unavailable indicator undecided with short history', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(reply(daily.slice(0, 10)));
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(10));
  expect(screen.queryByText('Above long trend')).toBeNull();
  expect(screen.queryByText('Oversold')).toBeNull();
  expect(screen.queryByText('Positive momentum')).toBeNull();
  expect(screen.getAllByText('Needs more history').length).toBeGreaterThan(0);
});

it('explains SMA warmup and omits the unplottable series from the legend', async () => {
  mockRealSvg = true;
  jest.mocked(fetchFinancialData).mockResolvedValue(reply(daily.slice(0, 90)));
  render(<ChartsPage />);
  const legend = await screen.findByRole('group', { name: 'Chart legend' });
  expect(await within(legend).findByText('SMA 50')).toBeTruthy();
  expect(within(legend).queryByText('SMA 200')).toBeNull();
  expect(screen.getByText(/First value at observation 50\./)).toBeTruthy();
  expect(screen.getByText(/90 of 200 observations available\./)).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: /SMA 2$/ }).disabled).toBe(false);
});

it('shows a marker for the first SMA 200 value when exactly 200 observations exist', async () => {
  mockRealSvg = true;
  jest.mocked(fetchFinancialData).mockResolvedValue(reply(daily.slice(0, 200)));
  const { container } = render(<ChartsPage />);
  await waitFor(() => {
    expect(container.querySelectorAll('.recharts-line-dot[stroke="var(--series-crypto)"]')).toHaveLength(1);
  }, { timeout: 2500 });
  const legend = screen.getByRole('group', { name: 'Chart legend' });
  expect(within(legend).getByText('SMA 200')).toBeTruthy();
});

it('distinguishes an earlier window without SMA values from insufficient total history', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '6M' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Previous window' }));
  expect(screen.getByText(/No calculated values in this window\./)).toBeTruthy();
  expect(screen.queryByText(/observations available\./)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Latest window' }));
  expect(screen.queryByText(/No calculated values in this window\./)).toBeNull();
});

it('does not import an out-of-window close when only one close exists in a range', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(reply([
    { date: '2026-01-01', close: 1 }, { date: '2026-02-01', close: 2 },
  ]));
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: '7D' }));
  await waitFor(() => expect(observations()).toEqual([{ date: '2026-02-01', close: 2, sma1: null, sma2: null, goldSilverRatio: null }]));
  expect(screen.getByText('Only one observation in this window.')).toBeTruthy();
});

it('hides the previous asset payload immediately while another asset is loading', async () => {
  let resolveNext!: (value: Response) => void;
  jest.mocked(fetchFinancialData).mockImplementation(async (input) => {
    const symbol = new URL(String(input), 'http://localhost').searchParams.get('symbol');
    return symbol === 'ETH' ? new Promise<Response>((resolve) => { resolveNext = resolve; }) : reply();
  });
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: /ETH Ethereum/ }));
  expect(screen.queryByLabelText('Chart observations')).toBeNull();
  expect(screen.getAllByText('Loading history').length).toBeGreaterThan(0);
  await act(async () => resolveNext(reply(daily.map((point) => ({ ...point, close: 2 })))));
  await waitFor(() => expect(observations().at(-1).close).toBe(2));
});

it('exposes previous/next/latest pan actions with bounded state and the actual quote currency', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  const surface = screen.getByRole('group', { name: 'Price · Bitcoin' });
  expect(screen.queryByRole('group', { name: 'Chart navigation' })).toBeNull();
  expect(surface.hasAttribute('aria-describedby')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '1M' }));
  await waitFor(() => expect(observations()).toHaveLength(31));
  expect(surface.getAttribute('aria-describedby')).toBe('chart-pan-help');
  expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
  const previous = screen.getByRole('button', { name: 'Previous window' });
  const next = screen.getByRole('button', { name: 'Next window' });
  expect(next.hasAttribute('disabled')).toBe(true);
  fireEvent.click(previous);
  expect(observations().at(-1).date).not.toBe('2026-09-07');
  expect(next.hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Latest window' }));
  expect(observations().at(-1).date).toBe('2026-09-07');
});

it('calculates subunit trend percentages from the actual SMA denominator', async () => {
  const prices = daily.map((point, index) => ({ ...point, close: index === 249 ? 0.00002 : 0.00001 }));
  jest.mocked(fetchFinancialData).mockResolvedValue(reply(prices));
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  expect(observations()[48].sma1).toBeNull();
  expect(observations()[49].sma1).toBeCloseTo(0.00001, 10);
  expect(observations()[198].sma2).toBeNull();
  expect(observations()[199].sma2).toBeCloseTo(0.00001, 10);
  // SMA50 = 49 × .00001 + .00002, divided by 50 = .0000102.
  expect(screen.getByText('SMA(50) +96.08%')).toBeTruthy();
});

it('distinguishes hourly observations on the time axis', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '7D' }));
  await waitFor(() => expect(observations()).toHaveLength(8));
  const labels = screen.getByLabelText('Chart time labels').textContent!.split('|');
  expect(labels[0]).not.toBe(labels[1]);
  expect(labels[0]).toContain('01:00');
  expect(labels[1]).toContain('02:00');
});

it('pads enabled visible SMA overlays and excludes them when hidden', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(reply(daily.map((point, index) => ({ ...point, close: index >= 242 ? 10 : 100 }))));
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '7D' }));
  await waitFor(() => expect(observations()).toHaveLength(8));
  expect(JSON.parse(screen.getByLabelText('Chart price domain').textContent!)[1]).toBeGreaterThan(90);
  fireEvent.click(screen.getByRole('button', { name: 'SMA 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'SMA 2' }));
  expect(JSON.parse(screen.getByLabelText('Chart price domain').textContent!)[1]).toBeLessThan(11);
});

it('preserves raw-history indicator restrictions', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: true, json: async () => ({ prices: daily, adjustment: 'raw_unadjusted' }) } as Response);
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  expect(observations().at(-1).sma1).toBeNull();
  expect(screen.getByRole('button', { name: 'SMA 1' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText('Above long trend')).toBeNull();
});

it('moves the focused chart by keyboard and resets to the latest window', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '1M' }));
  await waitFor(() => expect(observations()).toHaveLength(31));
  const surface = screen.getByRole('group', { name: 'Price · Bitcoin' });
  fireEvent.keyDown(surface, { key: 'ArrowLeft' });
  expect(observations().at(-1).date).toBe('2026-08-23');
  fireEvent.keyDown(surface, { key: 'Home' });
  expect(observations().at(-1).date).toBe('2026-09-07');
  fireEvent.keyDown(surface, { key: 'ArrowRight' });
  expect(observations().at(-1).date).toBe('2026-09-07');
});

function chartPointer(type: string, clientX: number, buttons: number, clientY = 100) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX, clientY });
  return event;
}

function providePointerCapture(surface: HTMLElement) {
  // jsdom omits native capture. Keep page event/state logic real and supply
  // only this browser boundary so the test can observe the chart window.
  let captured = false;
  surface.setPointerCapture = () => { captured = true; };
  surface.hasPointerCapture = () => captured;
  surface.releasePointerCapture = () => { captured = false; };
}

it('discards an unstarted pan when the pointer leaves and releases outside the chart', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '1M' }));
  await waitFor(() => expect(observations()).toHaveLength(31));
  fireEvent.click(screen.getByRole('button', { name: 'Previous window' }));
  const surface = screen.getByRole('group', { name: 'Price · Bitcoin' });
  providePointerCapture(surface);
  expect(observations().at(-1).date).toBe('2026-08-23');

  fireEvent(surface, chartPointer('pointerdown', 798, 1));
  fireEvent(surface, chartPointer('pointermove', 801, 1));
  fireEvent(surface, chartPointer('pointerout', 801, 1));
  // No capture exists before the drag threshold, so an outside release does
  // not bubble through the chart. Returning hover must not move its window.
  fireEvent(document.body, chartPointer('pointerup', 801, 0));
  fireEvent(surface, chartPointer('pointermove', 600, 0));
  expect(observations().at(-1).date).toBe('2026-08-23');
});

it('continues an active captured pan outside the plot until release', async () => {
  render(<ChartsPage />);
  await waitFor(() => expect(observations()).toHaveLength(250));
  fireEvent.click(screen.getByRole('button', { name: '1M' }));
  await waitFor(() => expect(observations()).toHaveLength(31));
  const surface = screen.getByRole('group', { name: 'Price · Bitcoin' });
  providePointerCapture(surface);
  fireEvent(surface, chartPointer('pointerdown', 400, 1));
  fireEvent(surface, chartPointer('pointermove', 450, 1));
  const initialDragDate = observations().at(-1).date;
  expect(initialDragDate).not.toBe('2026-09-07');
  fireEvent(surface, chartPointer('pointerout', 801, 1));
  fireEvent(surface, chartPointer('pointermove', 850, 1));
  const finalDragDate = observations().at(-1).date;
  expect(finalDragDate < initialDragDate).toBe(true);
  fireEvent(surface, chartPointer('pointerup', 850, 0));
  fireEvent(surface, chartPointer('pointermove', 600, 0));
  expect(observations().at(-1).date).toBe(finalDragDate);
});

// Regressions from the independent Impeccable audit (2026-11-14).
it('moves and focuses the asset tabs with arrow keys, Home and End', async () => {
  render(<ChartsPage />);
  const crypto = screen.getByRole('tab', { name: 'Crypto' });
  const stocks = screen.getByRole('tab', { name: 'Stocks' });
  crypto.focus();
  fireEvent.keyDown(crypto, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(stocks);
  expect(stocks.getAttribute('aria-selected')).toBe('true');
  expect(crypto.tabIndex).toBe(-1);
  fireEvent.keyDown(stocks, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Metals' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(crypto);
});

it('names the security search independently of placeholder text', () => {
  render(<ChartsPage />);
  expect(screen.getByRole('searchbox', { name: 'Search by name, ticker, WKN, or ISIN' })).toBeTruthy();
});

it('does not signal live history when no observations exist', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(reply([]));
  const { container } = render(<ChartsPage />);
  await screen.findByText('History unavailable.');
  expect(container.querySelector('.page-header-meta .status-pill.live')).toBeNull();
  expect(screen.queryByText('Unavailable')).toBeNull();
  expect(screen.getAllByText('History unavailable').length).toBeGreaterThan(0);
});

it('starts the mobile picker collapsed and returns focus after choosing an asset', async () => {
  const original = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 768px)', media: query,
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
  try {
    const { container } = render(<ChartsPage />);
    const picker = container.querySelector('details.chart-asset-picker') as HTMLDetailsElement;
    expect(picker).not.toBeNull();
    expect(picker.open).toBe(false);
    picker.open = true;
    fireEvent(picker, new Event('toggle'));
    const ethereum = screen.getByRole('button', { name: /ETH Ethereum/ });
    fireEvent.click(ethereum);
    await waitFor(() => expect(picker.open).toBe(false));
    expect(document.activeElement).toBe(picker.querySelector('summary'));
  } finally { window.matchMedia = original; }
});

it('disables chart animation when the user requests reduced motion', async () => {
  const original = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)', media: query,
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
  try {
    render(<ChartsPage />);
    await waitFor(() => expect(observations()).toHaveLength(250));
    expect(screen.getByLabelText('Chart animation').textContent).toBe('false');
  } finally { window.matchMedia = original; }
});
