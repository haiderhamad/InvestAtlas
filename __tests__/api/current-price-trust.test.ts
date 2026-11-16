import { GET } from '@/app/api/prices/current/route';
import { fetchProvider } from '@/lib/data/provider-fetch';
import { fetchEcbCurrentFx } from '@/lib/financial-data/fx/ecb';
import { hasActivePublicFinancialDataProvider } from '@/lib/financial-data/providers/catalog';
import { fetchBitfinexPrice } from '@/lib/prices/bitfinex';
import { fetchYahooCurrentQuote } from '@/lib/prices/yahoo';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));
jest.mock('@/lib/prices/bitfinex', () => ({
  fetchBitfinexPrice: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/prices/yahoo', () => ({
  fetchFxRate: jest.fn(),
  fetchYahooCurrentQuote: jest.fn(),
}));
jest.mock('@/lib/financial-data/fx/ecb', () => ({
  fetchEcbCurrentFx: jest.fn(),
  convertMoneyWithFx: jest.requireActual('@/lib/financial-data/fx/ecb').convertMoneyWithFx,
}));
jest.mock('@/lib/financial-data/providers/catalog', () => ({
  isFinancialDataProviderActive: jest.fn(() => true),
  hasActivePublicFinancialDataProvider: jest.fn(() => true),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);
const mockedFetchYahooCurrentQuote = jest.mocked(fetchYahooCurrentQuote);
const mockedFetchBitfinexPrice = jest.mocked(fetchBitfinexPrice);
const mockedFetchEcbCurrentFx = jest.mocked(fetchEcbCurrentFx);
const mockedHasActivePublicProvider = jest.mocked(hasActivePublicFinancialDataProvider);

describe('current-price fallback trust boundary', () => {
  beforeEach(() => {
    mockedFetchProvider.mockReset();
    mockedFetchYahooCurrentQuote.mockReset();
    mockedFetchBitfinexPrice.mockReset().mockResolvedValue(null);
    mockedFetchEcbCurrentFx.mockReset();
    mockedHasActivePublicProvider.mockReset().mockReturnValue(true);
  });

  it('short-circuits hosted polling when no public quote provider is active', async () => {
    mockedHasActivePublicProvider.mockReturnValue(false);

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC&currency=eur'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      status: 'unavailable',
      prices: {},
      refreshPolicy: 'manual_only',
    }));
    expect(mockedFetchProvider).not.toHaveBeenCalled();
    expect(mockedFetchYahooCurrentQuote).not.toHaveBeenCalled();
  });

  it('uses an explicitly USD-denominated Coinbase quote without fabricating metrics', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            amount: '100',
            base: 'BTC',
            currency: 'USD',
          },
        }),
      );

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prices.BTC).toEqual(expect.objectContaining({
      price: 100,
      change24h: null,
      volume24h: null,
      marketCap: null,
      verified: false,
      source: 'Coinbase USD spot',
      currency: 'usd',
      fields: expect.objectContaining({
        price: expect.objectContaining({
          status: 'available',
          value: { amount: 100, currency: 'USD' },
          freshness: 'fresh',
        }),
        marketCap: { status: 'unavailable', reason: 'not_provided' },
      }),
    }));
    expect(body.source).toBe('Coinbase USD spot');
  });

  it('rejects a malformed or differently denominated Coinbase fallback', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            amount: '100junk',
            base: 'BTC',
            currency: 'USDT',
          },
        }),
      );

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prices).toEqual({});
    expect(body.source).toBe('n/a');
  });

  it('keeps valid assets when one Yahoo symbol fails', async () => {
    mockedFetchProvider.mockResolvedValueOnce(Response.json({
      bitcoin: {
        usd: 100,
        usd_24h_change: 2,
        usd_24h_vol: 1_000,
        usd_market_cap: 2_000,
        last_updated_at: Math.floor(Date.now() / 1_000),
      },
    }));
    mockedFetchYahooCurrentQuote.mockRejectedValueOnce(
      new Error('upstream ticker failure'),
    );

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC,AAPL&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('partial');
    expect(body.prices.BTC.price).toBe(100);
    expect(body.prices.AAPL).toBeUndefined();
    expect(body.issues).toEqual(expect.arrayContaining([
      { symbol: 'AAPL', code: 'provider_unavailable' },
    ]));
    expect(JSON.stringify(body)).not.toContain('upstream ticker failure');
  });

  it('does not label an old CoinGecko observation as a fresh current quote', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(Response.json({
        bitcoin: {
          usd: 100,
          usd_24h_change: 2,
          usd_24h_vol: 1_000,
          usd_market_cap: 2_000,
          last_updated_at: Math.floor(Date.now() / 1_000) - 3_600,
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC&currency=usd'),
    );
    const body = await response.json();

    expect(body.prices).toEqual({});
    expect(body.issues).toEqual(expect.arrayContaining([
      { symbol: 'BTC', code: 'provider_unavailable' },
    ]));
  });

  it('does not count the same Yahoo futures fallback twice as independent metal verification', async () => {
    mockedFetchYahooCurrentQuote.mockResolvedValueOnce({
      price: 2_000,
      previousClose: 1_990,
      volume: 100,
      marketCap: null,
      currency: 'usd',
      displayName: 'Gold Futures',
      fiftyTwoWeekHigh: 2_100,
      fiftyTwoWeekLow: 1_800,
      instrumentType: 'FUTURE',
      nativeCurrency: 'usd',
      sourceSymbol: 'GC=F',
      asOf: '2026-07-31T15:30:00.000Z',
      retrievedAt: '2026-07-31T15:31:00.000Z',
      marketFreshness: 'fresh',
      fx: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        rate: 1,
        asOf: null,
        freshness: 'fresh',
        retrievedAt: '2026-07-31T15:31:00.000Z',
        method: 'identity exchange rate',
      },
    });

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=GOLD&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedFetchYahooCurrentQuote).toHaveBeenCalledTimes(1);
    expect(body.prices.GOLD).toEqual(expect.objectContaining({
      price: 2_000,
      verified: false,
      source: 'Yahoo Futures',
    }));
  });

  it('does not call two observations from the same Yahoo provider independently verified', async () => {
    const baseQuote = {
      previousClose: 1_990,
      volume: 100,
      marketCap: null,
      currency: 'usd' as const,
      displayName: 'Gold',
      fiftyTwoWeekHigh: 2_100,
      fiftyTwoWeekLow: 1_800,
      nativeCurrency: 'usd' as const,
      asOf: '2026-07-31T15:30:00.000Z',
      retrievedAt: '2026-07-31T15:31:00.000Z',
      marketFreshness: 'fresh' as const,
      fx: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        rate: 1,
        asOf: null,
        freshness: 'fresh' as const,
        retrievedAt: '2026-07-31T15:31:00.000Z',
        method: 'identity exchange rate',
      },
    };
    mockedFetchYahooCurrentQuote
      .mockResolvedValueOnce({
        ...baseQuote,
        price: 2_000,
        instrumentType: 'CURRENCY',
        sourceSymbol: 'XAUUSD=X',
      })
      .mockResolvedValueOnce({
        ...baseQuote,
        price: 2_010,
        instrumentType: 'FUTURE',
        sourceSymbol: 'GC=F',
      });

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=GOLD&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prices.GOLD).toEqual(expect.objectContaining({
      verified: false,
    }));
  });

  it('fails closed when independent metal sources do not agree', async () => {
    const quote = {
      previousClose: 1_990,
      volume: 100,
      marketCap: null,
      currency: 'usd' as const,
      displayName: 'Gold',
      fiftyTwoWeekHigh: 2_100,
      fiftyTwoWeekLow: 1_800,
      nativeCurrency: 'usd' as const,
      asOf: '2026-07-31T15:30:00.000Z',
      retrievedAt: '2026-07-31T15:31:00.000Z',
      marketFreshness: 'fresh' as const,
      fx: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        rate: 1,
        asOf: null,
        freshness: 'fresh' as const,
        retrievedAt: '2026-07-31T15:31:00.000Z',
        method: 'identity exchange rate',
      },
    };
    mockedFetchYahooCurrentQuote
      .mockResolvedValueOnce({
        ...quote,
        price: 2_000,
        instrumentType: 'CURRENCY',
        sourceSymbol: 'XAUUSD=X',
      })
      .mockResolvedValueOnce({
        ...quote,
        price: 2_010,
        instrumentType: 'FUTURE',
        sourceSymbol: 'GC=F',
      });
    mockedFetchBitfinexPrice.mockResolvedValueOnce(2_600);

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=GOLD&currency=usd'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('unavailable');
    expect(body.prices.GOLD).toBeUndefined();
    expect(body.verificationLogs).toEqual(expect.arrayContaining([
      expect.stringContaining('Source conflict for GOLD'),
    ]));
  });

  it('does not retain base-session change fields after replacing a metal price with consensus', async () => {
    const quote = {
      previousClose: 1_900,
      volume: 100,
      marketCap: null,
      currency: 'usd' as const,
      displayName: 'Gold',
      fiftyTwoWeekHigh: 2_100,
      fiftyTwoWeekLow: 1_800,
      nativeCurrency: 'usd' as const,
      asOf: '2026-07-31T15:30:00.000Z',
      retrievedAt: '2026-07-31T15:31:00.000Z',
      marketFreshness: 'fresh' as const,
      fx: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        rate: 1,
        asOf: null,
        freshness: 'fresh' as const,
        retrievedAt: '2026-07-31T15:31:00.000Z',
        method: 'identity exchange rate',
      },
    };
    mockedFetchYahooCurrentQuote
      .mockResolvedValueOnce({
        ...quote,
        price: 2_000,
        instrumentType: 'CURRENCY',
        sourceSymbol: 'XAUUSD=X',
      })
      .mockResolvedValueOnce({
        ...quote,
        price: 2_010,
        instrumentType: 'FUTURE',
        sourceSymbol: 'GC=F',
      });
    mockedFetchBitfinexPrice.mockResolvedValueOnce(2_040);

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=GOLD&currency=usd'),
    );
    const body = await response.json();

    expect(body.prices.GOLD).toEqual(expect.objectContaining({
      price: 2_020,
      verified: true,
      change24h: null,
      changePeriod: 'unavailable',
      fields: expect.objectContaining({
        previousClose: { status: 'unavailable', reason: 'source_conflict' },
        changePercent: { status: 'unavailable', reason: 'source_conflict' },
      }),
    }));
  });

  it('uses sourced ECB conversion for a Coinbase USD fallback', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        data: { amount: '100', base: 'BTC', currency: 'USD' },
      }));
    mockedFetchEcbCurrentFx.mockResolvedValueOnce({
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      rate: {
        status: 'available',
        value: 0.8,
        quality: 'calculated',
        freshness: 'fresh',
        observedAt: null,
        asOf: '2026-07-31',
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: '2026-07-31T16:00:00.000Z',
          method: 'inverse of ECB EUR/USD reference rate',
        },
      },
    });

    const response = await GET(
      new Request('http://localhost/api/prices/current?symbols=BTC&currency=eur'),
    );
    const body = await response.json();

    expect(body.prices.BTC).toEqual(expect.objectContaining({
      price: 80,
      currency: 'eur',
      fields: expect.objectContaining({
        price: expect.objectContaining({
          value: { amount: 80, currency: 'EUR' },
          quality: 'calculated',
          provenance: expect.objectContaining({
            derivedFrom: expect.arrayContaining([
              expect.objectContaining({ providerId: 'coinbase_public' }),
              expect.objectContaining({ providerId: 'ecb_reference_rates' }),
            ]),
          }),
        }),
      }),
    }));
  });
});
