import { buildPortfolioMonitorSeries } from '@/lib/portfolio/ux-insights';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

jest.mock('@/lib/transactions/holdings-engine', () => {
  const actual = jest.requireActual('@/lib/transactions/holdings-engine');
  return {
    ...actual,
    deriveHoldingsFromTransactions: jest.fn(actual.deriveHoldingsFromTransactions),
  };
});

const mockedDeriveHoldings = jest.mocked(deriveHoldingsFromTransactions);

function buy(
  id: string,
  date: string,
  asset: string,
): InvestmentTransaction {
  return {
    id,
    date,
    venue: 'performance-broker',
    settlementVenue: 'performance-cash',
    type: 'buy',
    asset,
    assetClass: 'stock',
    quote: 'EUR',
    amount: 1,
    price: 100,
    total: 100,
    fee: 0,
    taxType: 'acquisition',
    source: 'manual',
  };
}

describe('portfolio monitor performance shape', () => {
  beforeEach(() => {
    mockedDeriveHoldings.mockClear();
  });

  test('rebuilds the ledger only on transaction days, not on every chart day', () => {
    const transactions = [
      buy('first', '2026-01-01T09:00:00.000Z', 'AAPL'),
      buy('second', '2026-07-01T09:00:00.000Z', 'MSFT'),
    ];
    const history = Object.fromEntries(
      ['AAPL', 'MSFT'].map((symbol) => [
        symbol,
        Array.from({ length: 365 }, (_, index) => ({
          date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
          close: 100 + index,
        })),
      ]),
    );

    const series = buildPortfolioMonitorSeries(
      transactions,
      [],
      {
        asOfDay: '2026-12-31',
        invested: 200,
        marketValue: 500,
      },
      history,
      { excludedCashVenues: ['performance-cash'] },
    );

    expect(series).toHaveLength(365);
    expect(mockedDeriveHoldings).toHaveBeenCalledTimes(2);
  });
});
