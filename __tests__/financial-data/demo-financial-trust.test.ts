import { handleDemoFinancialRequest } from '@/lib/demo/financial-api';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { buildCurrentHoldingValuations } from '@/lib/portfolio/current-valuation';
import { buildPortfolioMonitorSeries } from '@/lib/portfolio/ux-insights';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import { getDemoTransactions } from '@/lib/transactions/manual-store';

// The fixture-to-ledger integration does not need a Firebase application.
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));

describe('Demo Snapshot financial trust contract', () => {
  const originalWindow = globalThis.window;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: new URL('https://investatlas.example/dashboard') },
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('delivers a dated synthetic fine-gold quote, Islamic ETF and stock in EUR without external providers', async () => {
    const result = handleDemoFinancialRequest(
      '/api/prices/current?symbols=DEMO-GOLD,DEMO-STOCK,DEMO-ETF&currency=eur',
    );
    const payload = await result!.json();
    expect(payload).toMatchObject({
      dataMode: 'demo_snapshot', synthetic: true, realtime: false,
      datasetVersion: '2026-11-03-v2',
    });
    expect(payload.prices['DEMO-GOLD']).toMatchObject({
      source: 'InvestAtlas synthetic showcase data',
      instrumentType: 'metal', currency: 'eur', priceUnit: 'troy_ounce',
    });
    expect(payload.prices['DEMO-GOLD'].price).toBeCloseTo(3509.09687, 8);
    expect(payload.prices['DEMO-GOLD'].price / 31.1035).toBeCloseTo(112.82, 8);
    expect(payload.prices['DEMO-GOLD'].fields.price).toMatchObject({
      quality: 'demo', freshness: 'unknown',
      value: { amount: 3509.09687, currency: 'EUR' },
    });
    expect(payload.prices['DEMO-STOCK'].price).toBe(297);
    expect(payload.prices['DEMO-ETF'].price).toBe(60.4);
  });

  it('values the real demo gold ledger in fine grams and reconciles its snapshot history', async () => {
    const transactions = getDemoTransactions();
    const holdings = deriveHoldingsFromTransactions(transactions);
    const response = handleDemoFinancialRequest(
      '/api/prices/current?symbols=DEMO-GOLD,DEMO-STOCK,DEMO-CIVIC,DEMO-ETF,DEMO-CRYPTO&currency=eur',
    );
    const payload = await response!.json();
    const valuations = buildCurrentHoldingValuations(holdings, payload.prices);
    const gold = valuations.find((holding) => holding.symbol === 'DEMO-GOLD');

    expect(gold).toMatchObject({
      amount: 10,
      metalFineness: 999.9,
      metalFinenessAvailable: true,
      valuationAvailable: true,
      costBasisAvailable: true,
    });
    expect(gold!.fineMetalAmount).toBeCloseTo(9.999, 8);
    expect(gold!.currentPrice).toBeCloseTo(112.82, 8);
    expect(gold!.value).toBeCloseTo(1128.08718, 8);
    expect(gold!.pnl).toBeCloseTo(127.08718, 8);

    const snapshot = INVESTATLAS_SHOWCASE_SNAPSHOT;
    const snapshotGold = snapshot.holdings.find((holding) => holding.symbol === 'DEMO-GOLD');
    expect(snapshotGold!.value).toBe(1128.09);
    expect(snapshotGold!.pnl).toBe(127.09);
    expect(snapshot.portfolioHistory.at(-1)!.metals).toBe(1128.09);
    expect(snapshot.portfolioHistory.at(-1)!.total).toBeCloseTo(
      valuations.reduce((total, holding) => total + holding.value, 0), 2,
    );

    const histories = Object.fromEntries(await Promise.all(
      snapshot.assets.filter((asset) => asset.assetClass !== 'cash').map(async (asset) => {
        const historyResponse = handleDemoFinancialRequest(
          `/api/prices/history?symbol=${asset.symbol}&currency=eur&interval=1d`,
        );
        return [asset.symbol, (await historyResponse!.json()).prices];
      }),
    ));
    const monitor = buildPortfolioMonitorSeries(
      transactions, [], { asOfDay: '2026-11-03' }, histories,
    );
    // The ledger starts in January, but the authored history begins August 6.
    // Do not connect a cash-only January point across the unobserved gap.
    expect(monitor[0].date).toBe('2026-08-06');
    expect(monitor).toHaveLength(90);
    expect(monitor.at(-1)).toMatchObject({ date: '2026-11-03', metals: 1128.09 });
    expect(monitor.at(-1)!.marketValue).toBe(snapshot.portfolioHistory.at(-1)!.total);
    expect(buildPortfolioMonitorSeries(transactions, [], undefined, histories))
      .toEqual(monitor);
  });

  it('keeps every gold OHLC price and the ATH response on the metal per-troy-ounce API contract', async () => {
    const response = handleDemoFinancialRequest(
      '/api/prices/history?symbol=DEMO-GOLD&currency=eur&interval=1d',
    );
    const payload = await response!.json();
    expect(payload.priceUnit).toBe('troy_ounce');
    expect(payload.sources[0].method).toMatch(/per troy ounce/i);
    const gramPoints = INVESTATLAS_SHOWCASE_SNAPSHOT.history['DEMO-GOLD'].points;
    expect(payload.prices).toHaveLength(90);
    for (const [index, point] of payload.prices.entries()) {
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        expect(point[field]).toBeCloseTo(gramPoints[index][field] * 31.1035, 8);
      }
      expect(point.volume).toBeNull();
      expect(point.dataQuality).toBe('demo');
    }

    const athResponse = handleDemoFinancialRequest('/api/prices/ath?symbols=DEMO-GOLD');
    const athPayload = await athResponse!.json();
    expect(athPayload.prices['DEMO-GOLD']).toMatchObject({
      priceUnit: 'troy_ounce', ath: null, quality: 'demo', synthetic: true,
    });
    expect(athPayload.prices['DEMO-GOLD'].price).toBeCloseTo(3509.09687, 8);
    expect(payload.latestObservationAt).toBe('2026-11-03T18:00:00.000Z');
  });

  it('does not describe a 90-day synthetic history as complete market history', async () => {
    const response = handleDemoFinancialRequest(
      '/api/prices/history?symbol=DEMO-STOCK&currency=eur&interval=1d',
    );
    expect(response).not.toBeNull();
    const payload = await response!.json();

    expect(payload).toMatchObject({
      status: 'partial',
      isComplete: false,
      freshness: 'unknown',
      dataMode: 'demo_snapshot',
      synthetic: true,
      realtime: false,
    });
    expect(payload.provenance[0].status).toBe('partial');
  });

  it('does not relabel a 90-day range as annual or all-time highs', async () => {
    const quoteResponse = handleDemoFinancialRequest(
      '/api/prices/current?symbols=DEMO-STOCK&currency=eur',
    );
    const quotePayload = await quoteResponse!.json();
    expect(quotePayload.status).toBe('partial');
    expect(quotePayload.prices['DEMO-STOCK']).toMatchObject({
      yearHigh: null,
      yearLow: null,
      dataStatus: 'partial',
    });
    expect(quotePayload.prices['DEMO-STOCK'].fields.yearHigh.status).toBe('unavailable');
    expect(quotePayload.prices['DEMO-STOCK'].fields.yearLow.status).toBe('unavailable');

    const athResponse = handleDemoFinancialRequest(
      '/api/prices/ath?symbols=DEMO-STOCK',
    );
    const athPayload = await athResponse!.json();
    expect(athPayload.status).toBe('partial');
    expect(athPayload.prices['DEMO-STOCK']).toMatchObject({
      ath: null,
      athDate: null,
      athValDropPct: null,
      freshness: 'unknown',
      synthetic: true,
      limitation: 'all_time_high_unavailable',
    });
  });
});
