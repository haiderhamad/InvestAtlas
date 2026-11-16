import {
  buildAccountGroups,
  buildAccountSummaries,
  type AccountHoldingSnapshot,
} from '@/lib/portfolio/account-overview';

function holding(
  overrides: Partial<AccountHoldingSnapshot> = {},
): AccountHoldingSnapshot {
  return {
    symbol: 'AAPL',
    assetClass: 'stock',
    amount: 1,
    avgCost: 100,
    value: 150,
    valuationAvailable: true,
    change24h: 1,
    changePeriod: '24h',
    totalFeesEur: 0,
    primaryVenue: 'trade-republic',
    costBasisAvailable: true,
    financialMetricsAvailable: true,
    ...overrides,
  };
}

describe('account valuation aggregation', () => {
  it('suppresses portfolio allocations when one required quote is missing', () => {
    const summaries = buildAccountSummaries(
      [
        holding(),
        holding({
          symbol: 'BTC',
          assetClass: 'crypto',
          value: 0,
          valuationAvailable: false,
          change24h: null,
          primaryVenue: 'binance',
          financialMetricsAvailable: false,
        }),
      ],
      0,
      [],
    );

    expect(summaries.find((account) => account.venue === 'trade-republic')).toEqual(
      expect.objectContaining({
        value: 150,
        valuationAvailable: true,
        allocation: 0,
      }),
    );
    expect(summaries.find((account) => account.venue === 'binance')).toEqual(
      expect.objectContaining({
        value: 0,
        valuationAvailable: false,
        allocation: 0,
      }),
    );
    expect(buildAccountGroups(summaries).every((group) => group.allocation === 0)).toBe(true);
  });

  it('suppresses a complete-looking account total when any holding is unvalued', () => {
    const [summary] = buildAccountSummaries(
      [
        holding(),
        holding({
          symbol: 'MSFT',
          value: 0,
          valuationAvailable: false,
          financialMetricsAvailable: false,
        }),
      ],
      0,
      [],
    );

    expect(summary).toEqual(
      expect.objectContaining({
        value: 0,
        valuationAvailable: false,
        financialMetricsAvailable: false,
      }),
    );
  });

  it('does not aggregate a market-session move as a 24h account move', () => {
    const [summary] = buildAccountSummaries(
      [holding({ changePeriod: 'session' })],
      150,
      [],
    );

    expect(summary.dayMove).toBeNull();
  });
});
