import type { ProviderStoreUser } from '@/lib/ai/provider-store';
import { listFinancialCredentialsRaw } from '@/lib/financial-data/providers/credential-store';
import {
  fetchEcbCurrentFx,
  fetchEcbFxHistory,
} from '@/lib/financial-data/fx/ecb';
import {
  getPersonalCurrentQuotes,
  getPersonalHistory,
} from '@/lib/financial-data/providers/personal-market-data';
import { fetchTiingoDailyPrices } from '@/lib/financial-data/providers/tiingo';

jest.mock('@/lib/financial-data/providers/credential-store', () => ({
  listFinancialCredentialsRaw: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/tiingo', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/tiingo'),
  fetchTiingoDailyPrices: jest.fn(),
}));
jest.mock('@/lib/financial-data/fx/ecb', () => ({
  ...jest.requireActual('@/lib/financial-data/fx/ecb'),
  fetchEcbCurrentFx: jest.fn(),
  fetchEcbFxHistory: jest.fn(),
}));

const mockedCredentials = jest.mocked(listFinancialCredentialsRaw);
const mockedTiingo = jest.mocked(fetchTiingoDailyPrices);
const mockedCurrentFx = jest.mocked(fetchEcbCurrentFx);
const mockedHistoryFx = jest.mocked(fetchEcbFxHistory);

function user(uid: string): ProviderStoreUser {
  return { uid, token: `token-for-${uid}` };
}

function credential(apiKey: string, revision: number) {
  return [{
    id: 'tiingo' as const,
    apiKey,
    enabled: true,
    priority: 0,
    status: 'connected' as const,
    detectedCapabilities: ['quote', 'history'] as Array<'quote' | 'history'>,
    lastValidatedAt: new Date().toISOString(),
    credentialRevision: revision,
  }];
}

function rows(close: number) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  return [yesterday, today].map((date, index) => ({
    date: date.toISOString(),
    open: close - 2 + index,
    high: close + index,
    low: close - 3 + index,
    close: close - 1 + index,
    volume: 1_000 + index,
  }));
}

describe('personal market-data retention and isolation', () => {
  beforeEach(() => {
    mockedCredentials.mockReset();
    mockedTiingo.mockReset();
    mockedCurrentFx.mockReset();
    mockedHistoryFx.mockReset();
  });

  it('does not retain raw Tiingo rows between requests or mix users', async () => {
    mockedCredentials.mockImplementation(async (candidate) => (
      candidate.uid === 'user-a'
        ? credential('key_for_user_a_123', 1)
        : credential('key_for_user_b_456', 1)
    ));
    mockedTiingo.mockImplementation(async ({ apiKey }) => (
      apiKey.includes('user_a') ? rows(100) : rows(200)
    ));

    const firstA = await getPersonalCurrentQuotes(
      user('user-a'), ['AAPL'], 'usd',
    );
    const firstB = await getPersonalCurrentQuotes(
      user('user-b'), ['AAPL'], 'usd',
    );
    const secondA = await getPersonalCurrentQuotes(
      user('user-a'), ['AAPL'], 'usd',
    );

    expect(firstA.prices.AAPL.price).toBe(100);
    expect(firstB.prices.AAPL.price).toBe(200);
    expect(secondA.prices.AAPL.price).toBe(100);
    expect(firstA.prices.AAPL.yearHigh).toBeNull();
    expect(firstA.prices.AAPL.fields.yearHigh).toEqual({
      status: 'unavailable',
      reason: 'not_provided',
    });
    expect(mockedTiingo).toHaveBeenCalledTimes(3);
    expect(mockedTiingo.mock.calls[0][0].healthKey).toContain('user-a');
    expect(mockedTiingo.mock.calls[1][0].healthKey).toContain('user-b');
    expect(mockedTiingo.mock.calls[2][0].healthKey).toContain('user-a');
  });

  it('resolves the current credential revision once for every market-data request', async () => {
    let revision = 1;
    mockedCredentials.mockImplementation(async () => (
      credential('key_for_user_a_123', revision)
    ));
    mockedTiingo
      .mockResolvedValueOnce(rows(100))
      .mockResolvedValueOnce(rows(150));

    const before = await getPersonalCurrentQuotes(
      user('user-a'), ['AAPL'], 'usd',
    );
    revision = 2;
    const after = await getPersonalCurrentQuotes(
      user('user-a'), ['AAPL'], 'usd',
    );

    expect(before.prices.AAPL.price).toBe(100);
    expect(after.prices.AAPL.price).toBe(150);
    expect(mockedTiingo).toHaveBeenCalledTimes(2);
    expect(mockedTiingo.mock.calls[0][0].healthKey).toContain(':1');
    expect(mockedTiingo.mock.calls[1][0].healthKey).toContain(':2');
  });

  it('bounds multi-symbol concurrency and reuses one credential read and deadline', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_concurrent_user_123',
      7,
    ));
    let active = 0;
    let maximumActive = 0;
    mockedTiingo.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return rows(100);
    });

    const result = await getPersonalCurrentQuotes(
      user('concurrent-user'),
      ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'],
      'usd',
    );

    expect(result.status).toBe('partial');
    expect(Object.keys(result.prices)).toHaveLength(7);
    expect(mockedCredentials).toHaveBeenCalledTimes(1);
    expect(mockedTiingo).toHaveBeenCalledTimes(7);
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
    const signals = mockedTiingo.mock.calls.map((call) => call[0].signal);
    expect(signals.every((candidate) => candidate instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(1);
    expect(mockedCredentials.mock.calls[0][1]).toBe(signals[0]);
  });

  it('uses one sourced ECB observation for all EUR quote conversions', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_eur_user_123',
      3,
    ));
    mockedTiingo.mockResolvedValue(rows(100));
    mockedCurrentFx.mockResolvedValue({
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      rate: {
        status: 'available',
        value: 0.9,
        quality: 'observed',
        freshness: 'fresh',
        observedAt: '2026-08-08',
        asOf: '2026-08-08',
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: '2026-08-09T00:00:00.000Z',
        },
      },
    });

    const result = await getPersonalCurrentQuotes(
      user('eur-user'),
      ['AAPL', 'MSFT'],
      'eur',
    );

    expect(result.status).toBe('partial');
    expect(result.prices.AAPL.price).toBe(90);
    expect(result.prices.MSFT.price).toBe(90);
    expect(mockedCurrentFx).toHaveBeenCalledTimes(1);
    expect(mockedCredentials).toHaveBeenCalledTimes(1);
    expect(mockedTiingo).toHaveBeenCalledTimes(2);
  });

  it('fails EUR quotes closed without consuming Tiingo quota when FX is unavailable', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_missing_fx_user_123',
      4,
    ));
    mockedCurrentFx.mockResolvedValue({
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      rate: { status: 'unavailable', reason: 'provider_unavailable' },
    });

    const result = await getPersonalCurrentQuotes(
      user('missing-fx-user'),
      ['AAPL', 'MSFT'],
      'eur',
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'unavailable',
      prices: {},
      issues: [
        { symbol: 'AAPL', code: 'fx_unavailable' },
        { symbol: 'MSFT', code: 'fx_unavailable' },
      ],
    }));
    expect(mockedCurrentFx).toHaveBeenCalledTimes(1);
    expect(mockedCredentials).toHaveBeenCalledTimes(1);
    expect(mockedTiingo).not.toHaveBeenCalled();
  });

  it.each([
    ['a thrown FX request', () => mockedCurrentFx.mockRejectedValue(new Error('aborted'))],
    ['a stale FX observation', () => mockedCurrentFx.mockResolvedValue({
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      rate: {
        status: 'available',
        value: 0.9,
        quality: 'observed',
        freshness: 'stale',
        observedAt: '2026-07-01',
        asOf: '2026-07-01',
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: '2026-08-09T00:00:00.000Z',
        },
      },
    })],
  ])('fails closed before Tiingo for %s', async (_label, arrange) => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_fx_failure_user_123',
      5,
    ));
    arrange();

    const result = await getPersonalCurrentQuotes(
      user('fx-failure-user'),
      ['AAPL'],
      'eur',
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'unavailable',
      issues: [{ symbol: 'AAPL', code: 'fx_unavailable' }],
    }));
    expect(mockedTiingo).not.toHaveBeenCalled();
  });

  it('deduplicates symbols and reports unsupported assets without hiding them', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_mixed_assets_user_123',
      6,
    ));
    mockedTiingo.mockResolvedValue(rows(100));

    const result = await getPersonalCurrentQuotes(
      user('mixed-assets-user'),
      ['AAPL', 'AAPL', 'BTC'],
      'usd',
    );

    expect(result.status).toBe('partial');
    expect(Object.keys(result.prices)).toEqual(['AAPL']);
    expect(result.issues).toContainEqual({
      symbol: 'BTC',
      code: 'provider_unavailable',
    });
    expect(mockedTiingo).toHaveBeenCalledTimes(1);
  });

  it('preserves successful symbols when another worker fails', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_partial_worker_user_123',
      8,
    ));
    mockedTiingo
      .mockResolvedValueOnce(rows(100))
      .mockRejectedValueOnce(new Error('unexpected worker failure'));

    const result = await getPersonalCurrentQuotes(
      user('partial-worker-user'),
      ['AAPL', 'MSFT'],
      'usd',
    );

    expect(result.status).toBe('partial');
    expect(result.prices.AAPL.price).toBe(100);
    expect(result.prices.MSFT).toBeUndefined();
    expect(result.issues).toContainEqual({
      symbol: 'MSFT',
      code: 'provider_unavailable',
    });
  });

  it('does not label stale or short personal history as complete', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_history_user_123',
      1,
    ));
    mockedTiingo.mockResolvedValueOnce([
      {
        date: '2022-01-03T00:00:00.000Z',
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
      },
      {
        date: '2022-01-04T00:00:00.000Z',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_100,
      },
    ]);

    const result = await getPersonalHistory(
      user('history-user'),
      'AAPL',
      'usd',
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'partial',
      freshness: 'stale',
      isComplete: false,
    }));
    expect(result?.provenance[0].status).toBe('partial');
    expect(result?.warnings).toEqual(expect.arrayContaining([
      'Historical coverage is shorter than four years.',
      'Latest personal-provider history is stale.',
    ]));
    expect(mockedCredentials.mock.calls[0][1]).toBe(
      mockedTiingo.mock.calls[0][0].signal,
    );
  });

  it('does not label sparse endpoint-only history as complete', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_sparse_history_123',
      1,
    ));
    const today = new Date();
    const old = new Date(today);
    old.setUTCFullYear(today.getUTCFullYear() - 5);
    mockedTiingo.mockResolvedValueOnce([
      {
        date: old.toISOString(),
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
      },
      {
        date: today.toISOString(),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_100,
      },
    ]);

    const result = await getPersonalHistory(
      user('sparse-history-user'),
      'AAPL',
      'usd',
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'partial',
      freshness: 'fresh',
      isComplete: false,
    }));
    expect(result?.warnings).toContain(
      'Historical coverage is too sparse to be considered complete.',
    );
    expect(result?.provenance[0]).toMatchObject({
      startDate: old.toISOString().slice(0, 10),
      endDate: today.toISOString().slice(0, 10),
      dataPoints: 2,
      status: 'partial',
    });
  });

  it('never labels partially FX-converted history as complete', async () => {
    mockedCredentials.mockResolvedValue(credential(
      'key_for_partial_fx_history_123',
      9,
    ));
    const today = new Date();
    const start = new Date(today);
    start.setUTCFullYear(today.getUTCFullYear() - 5);
    const historyRows = Array.from({ length: 802 }, (_, index) => {
      const date = new Date(
        start.getTime()
          + ((today.getTime() - start.getTime()) * index) / 801,
      );
      return {
        date: date.toISOString(),
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1_000,
      };
    });
    mockedTiingo.mockResolvedValue(historyRows);
    mockedHistoryFx.mockResolvedValue(
      historyRows.slice(1).map((row) => ({
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        rate: {
          status: 'available' as const,
          value: 0.9,
          quality: 'observed' as const,
          freshness: 'fresh' as const,
          observedAt: row.date.slice(0, 10),
          asOf: row.date.slice(0, 10),
          provenance: {
            providerId: 'ecb_reference_rates',
            providerName: 'European Central Bank',
            retrievedAt: today.toISOString(),
          },
        },
      })),
    );

    const result = await getPersonalHistory(
      user('partial-fx-history-user'),
      'AAPL',
      'eur',
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'partial',
      isComplete: false,
    }));
    expect(result?.warnings).toContain('Historical FX coverage is incomplete.');
    expect(result?.prices).toHaveLength(801);
    const sharedSignal = mockedTiingo.mock.calls[0][0].signal;
    expect(mockedCredentials.mock.calls[0][1]).toBe(sharedSignal);
    expect(mockedHistoryFx.mock.calls[0][5]).toBe(sharedSignal);
  });
});
