import {
  buildCurrentHoldingValuations,
  isCurrentValuationComplete,
  getUnavailableValuationSymbols,
  summarizeCurrentValuationCoverage,
} from '@/lib/portfolio/current-valuation';
import type { DerivedHolding } from '@/lib/transactions/holdings-engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const holding = (
  overrides: Partial<DerivedHolding> = {},
): DerivedHolding => ({
  symbol: 'AAPL',
  name: 'Apple',
  assetClass: 'stock',
  amount: 2,
  avgCost: 100,
  costBasisAvailable: true,
  venue: 'broker',
  ...overrides,
});

describe('current market valuation integrity', () => {
  it('does not replace a missing live quote with acquisition cost', () => {
    const [result] = buildCurrentHoldingValuations([holding()]);

    expect(result).toMatchObject({
      currentPrice: 0,
      value: 0,
      pnl: 0,
      allocation: 0,
      valuationAvailable: false,
    });
    expect(isCurrentValuationComplete([result])).toBe(false);
  });

  it('marks a partial provider response as an incomplete portfolio valuation', () => {
    const results = buildCurrentHoldingValuations(
      [holding(), holding({ symbol: 'MSFT', name: 'Microsoft' })],
      {
        AAPL: {
          price: 150,
          change24h: null,
        },
      },
    );

    expect(results[0].valuationAvailable).toBe(true);
    expect(results[1].valuationAvailable).toBe(false);
    expect(results.every((item) => item.allocation === 0)).toBe(true);
    expect(isCurrentValuationComplete(results)).toBe(false);
  });

  it('identifies only unavailable positions, deduplicating symbols across accounts', () => {
    const positions = buildCurrentHoldingValuations(
      [
        holding(),
        holding({ symbol: 'MSFT', venue: 'first-broker' }),
        holding({ symbol: 'MSFT', venue: 'second-broker' }),
      ],
      { AAPL: { price: 150, currency: 'eur', change24h: null } },
    );
    expect(getUnavailableValuationSymbols(positions)).toEqual(['MSFT']);
    expect(getUnavailableValuationSymbols(positions.filter((position) => position.symbol === 'AAPL'))).toEqual([]);
  });

  it('rejects a current quote explicitly denominated in USD against an EUR cost basis', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding()],
      {
        AAPL: {
          price: 150,
          change24h: 1,
          currency: 'usd',
        },
      },
    );

    expect(result.valuationAvailable).toBe(false);
    expect(result.value).toBe(0);
    expect(result.pnl).toBe(0);
  });

  it('rejects a quote whose FX-derived price is visibly stale', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding()],
      {
        AAPL: {
          price: 150,
          change24h: 1,
          currency: 'eur',
          fields: {
            price: {
              status: 'available',
              value: { amount: 150, currency: 'EUR' },
              quality: 'calculated',
              freshness: 'stale',
              observedAt: null,
              asOf: '2026-07-24',
              provenance: {
                providerId: 'investatlas_calculation',
                providerName: 'InvestAtlas',
                retrievedAt: '2026-07-31T12:00:00.000Z',
              },
            },
          },
        },
      },
    );

    expect(result.valuationAvailable).toBe(false);
  });

  it('fails closed when a finite quote would overflow the holding valuation', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding({ amount: Number.MAX_VALUE })],
      { AAPL: { price: 2, change24h: null } },
    );

    expect(result.valuationAvailable).toBe(false);
    expect(result.value).toBe(0);
    expect(result.pnl).toBe(0);
  });

  it('rejects a sourced quote whose freshness cannot be established', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding()],
      {
        AAPL: {
          price: 150,
          change24h: 1,
          currency: 'eur',
          fields: {
            price: {
              status: 'available',
              value: { amount: 150, currency: 'EUR' },
              quality: 'observed',
              freshness: 'unknown',
              observedAt: null,
              asOf: null,
              provenance: {
                providerId: 'unknown_provider',
                providerName: 'Unknown provider',
                retrievedAt: null,
              },
            },
          },
        },
      },
    );

    expect(result.valuationAvailable).toBe(false);
  });

  it('accepts an explicitly synthetic demo quote only as demo valuation data', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding({ symbol: 'DEMO-STOCK', name: 'Atlas Mobility' })],
      {
        'DEMO-STOCK': {
          price: 150,
          change24h: 1,
          currency: 'eur',
          fields: {
            price: {
              status: 'available',
              value: { amount: 150, currency: 'EUR' },
              quality: 'demo',
              freshness: 'unknown',
              observedAt: '2026-08-01T00:00:00.000Z',
              asOf: '2026-08-01T00:00:00.000Z',
              provenance: {
                providerId: 'investatlas_demo_snapshot',
                providerName: 'InvestAtlas synthetic showcase data',
                retrievedAt: '2026-08-01T00:00:00.000Z',
              },
              limitations: ['synthetic'],
            },
          },
        },
      },
    );

    expect(result).toMatchObject({
      currentPrice: 150,
      value: 300,
      valuationAvailable: true,
      isVerified: false,
    });
  });

  it('preserves the provider change period instead of relabelling a session move as 24h', () => {
    const [result] = buildCurrentHoldingValuations(
      [holding()],
      {
        AAPL: {
          price: 150,
          change24h: 1.25,
          changePeriod: 'session',
          currency: 'eur',
        },
      },
    );

    expect(result.change24h).toBe(1.25);
    expect(result.changePeriod).toBe('session');
  });

  it('values known EUR cash without requiring a market provider', () => {
    const [result] = buildCurrentHoldingValuations([
      holding({
        symbol: 'EUR',
        name: 'Cash (EUR)',
        assetClass: 'cash',
        amount: 250,
        avgCost: 1,
      }),
    ]);

    expect(result).toMatchObject({
      currentPrice: 1,
      value: 250,
      change24h: 0,
      valuationAvailable: true,
    });
  });

  it('keeps cash in an unknown currency unavailable', () => {
    const [result] = buildCurrentHoldingValuations([
      holding({
        symbol: 'USD',
        name: 'Cash (USD)',
        assetClass: 'cash',
        amount: 250,
        avgCost: 0,
        costBasisAvailable: false,
      }),
    ]);

    expect(result.valuationAvailable).toBe(false);
    expect(result.value).toBe(0);
  });

  it('values USD cash only with a fresh sourced current rate to EUR', () => {
    const usdCash = holding({
      symbol: 'USD',
      name: 'Cash (USD)',
      assetClass: 'cash',
      amount: 250,
      avgCost: 0.85,
      costBasisAvailable: true,
    });

    const [current] = buildCurrentHoldingValuations(
      [usdCash],
      {},
      {
        USD: {
          rate: 0.8,
          freshness: 'fresh',
          asOf: '2026-07-31',
          providerId: 'ecb_reference_rates',
        },
      },
    );
    const [stale] = buildCurrentHoldingValuations(
      [usdCash],
      {},
      {
        USD: {
          rate: 0.8,
          freshness: 'stale',
          asOf: '2026-07-24',
          providerId: 'ecb_reference_rates',
        },
      },
    );

    expect(current).toMatchObject({
      currentPrice: 0.8,
      value: 200,
      valuationAvailable: true,
    });
    expect(stale.valuationAvailable).toBe(false);
    expect(stale.value).toBe(0);
  });

  it('converts a sourced metal quote per troy ounce to a per-gram value', () => {
    const [result] = buildCurrentHoldingValuations(
      [
        holding({
          symbol: 'GOLD',
          name: 'Gold',
          assetClass: 'metal',
          amount: 31.1035,
          fineMetalAmount: 31.1035,
          metalFineness: 1000,
          metalFinenessAvailable: true,
          avgCost: 50,
        }),
      ],
      {
        GOLD: {
          price: 3_110.35,
          change24h: 1,
          verified: true,
        },
      },
    );

    expect(result.currentPrice).toBeCloseTo(100);
    expect(result.value).toBeCloseTo(3_110.35);
    expect(result.valuationAvailable).toBe(true);
  });

  it('shows only sourced priced positions in a partial EUR value and partial P&L', () => {
    const valuations = buildCurrentHoldingValuations(
      [holding(), holding({ symbol: 'ISWD', name: 'Islamic World ETF', assetClass: 'etf' })],
      { AAPL: { price: 150, currency: 'eur', change24h: null } },
    );
    const coverage = summarizeCurrentValuationCoverage(valuations);
    expect(isCurrentValuationComplete(valuations)).toBe(false);
    expect(coverage).toEqual({
      valuedValue: 300,
      valuedUnrealizedPnl: 100,
      valuedCount: 1,
      missingCount: 1,
      totalCount: 2,
    });
    expect(getUnavailableValuationSymbols(valuations)).toEqual(['ISWD']);
    expect(valuations.every((value) => value.allocation === 0)).toBe(true);
  });

  it('does not present partial P&L when a priced holding has unknown acquisition cost', () => {
    const valuations = buildCurrentHoldingValuations(
      [
        holding(),
        holding({ symbol: 'MSFT', costBasisAvailable: false }),
        holding({ symbol: 'ISWD' }),
      ],
      {
        AAPL: { price: 150, currency: 'eur', change24h: null },
        MSFT: { price: 160, currency: 'eur', change24h: null },
      },
    );
    const coverage = summarizeCurrentValuationCoverage(valuations);
    expect(coverage.valuedValue).toBe(620);
    expect(coverage.valuedCount).toBe(2);
    expect(coverage.valuedUnrealizedPnl).toBeNull();
    expect(coverage.missingCount).toBe(1);
  });

  it('excludes unqualified metal valuations from both partial market value and P&L', () => {
    const valuations = buildCurrentHoldingValuations(
      [
        holding(),
        holding({
          symbol: 'GOLD', assetClass: 'metal', amount: 31.1035,
          metalFinenessAvailable: false, fineMetalAmount: undefined,
        }),
      ],
      {
        AAPL: { price: 150, currency: 'eur', change24h: null },
        GOLD: { price: 3100, currency: 'eur', change24h: null },
      },
    );
    expect(summarizeCurrentValuationCoverage(valuations)).toMatchObject({
      valuedValue: 300,
      valuedUnrealizedPnl: 100,
      valuedCount: 1,
      missingCount: 1,
    });
  });

  it('fails closed for empty coverage and non-finite summed value/P&L', () => {
    expect(summarizeCurrentValuationCoverage([])).toMatchObject({
      valuedValue: 0, valuedUnrealizedPnl: null, valuedCount: 0, missingCount: 0,
    });
    const coverage = summarizeCurrentValuationCoverage([
      { amount: 1, avgCost: 100, value: 1e308, pnl: 1e308, costBasisAvailable: true, valuationAvailable: true },
      { amount: 1, avgCost: 100, value: 1e308, pnl: 1e308, costBasisAvailable: true, valuationAvailable: true },
    ]);
    expect(coverage).toEqual({
      valuedValue: 0, valuedUnrealizedPnl: null,
      valuedCount: 0, missingCount: 2, totalCount: 2,
    });
  });

  it('never converts an overflowing cost basis into a fabricated zero partial P&L', () => {
    const coverage = summarizeCurrentValuationCoverage([
      {
        amount: Number.MAX_VALUE, avgCost: 2, value: 100,
        pnl: 0, costBasisAvailable: true, valuationAvailable: true,
      },
    ]);
    expect(coverage).toMatchObject({
      valuedValue: 100,
      valuedUnrealizedPnl: null,
      valuedCount: 1,
      missingCount: 0,
    });
  });

  it('labels partial P&L only as a subset inside the portfolio UI', () => {
    const portfolio = readFileSync(join(process.cwd(), 'src/app/portfolio/page.tsx'), 'utf8');
    expect(portfolio).toContain("t('Partial unrealized P&L (valued positions only)')");
    expect(portfolio).toContain('!portfolioValuationAvailable && valuationCoverage.valuedUnrealizedPnl !== null');
    expect(portfolio).toContain("t('Valued positions only (incomplete total)')");
  });

  it('keeps all current portfolio and account surfaces on the fail-closed valuation builder', () => {
    for (const path of [
      'src/app/page.tsx',
      'src/app/portfolio/page.tsx',
      'src/app/analytics/page.tsx',
      'src/app/accounts/page.tsx',
      'src/app/accounts/[venue]/page.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');

      expect(source).toContain('buildCurrentHoldingValuations');
      expect(source).not.toContain('fallbackPrice');
      expect(source).not.toContain(
        'demoPriceBySymbol.get(holding.symbol) ?? holding.avgCost',
      );
    }
  });
});
