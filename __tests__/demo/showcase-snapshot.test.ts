import {
  createInvestAtlasShowcaseSnapshot,
  INVESTATLAS_SHOWCASE_SNAPSHOT,
} from '@/lib/demo/showcase-snapshot';
import {
  DEMO_HOLDINGS,
  DEMO_PORTFOLIO_GROWTH,
  DEMO_TRANSACTIONS,
} from '@/lib/demo/investment-data';

describe('InvestAtlas synthetic showcase snapshot', () => {
  it('is versioned, read-only, synthetic and disconnected from external providers', () => {
    const { manifest, provenance } = INVESTATLAS_SHOWCASE_SNAPSHOT;

    expect(manifest).toEqual(expect.objectContaining({
      datasetVersion: '2026-11-03-v2',
      mode: 'demo_snapshot',
      realtime: false,
      synthetic: true,
      readOnly: true,
      personalData: false,
    }));
    expect(Date.parse(manifest.dataAsOf)).toBeLessThanOrEqual(
      Date.parse(manifest.publishedAt),
    );
    expect(provenance).toEqual(expect.objectContaining({
      sourceKind: 'investatlas_authored_synthetic',
      quality: 'demo',
      externalProvider: null,
      externalSourceUrl: null,
      personalData: false,
    }));
    expect(provenance.id).toBe(manifest.provenanceId);
    expect(Object.isFrozen(INVESTATLAS_SHOWCASE_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(INVESTATLAS_SHOWCASE_SNAPSHOT.transactions)).toBe(true);
    expect(Object.isFrozen(INVESTATLAS_SHOWCASE_SNAPSHOT.history['DEMO-STOCK'].points)).toBe(true);
  });

  it('includes a dated synthetic gold, recognizable stock and Islamic ETF sample at plausible units', () => {
    const snapshot = INVESTATLAS_SHOWCASE_SNAPSHOT;
    expect(snapshot.manifest.dataAsOf.slice(0, 10)).toBe('2026-11-03');
    expect(snapshot.manifest.synthetic).toBe(true);
    expect(snapshot.provenance.externalProvider).toBeNull();
    const gold = snapshot.holdings.find((asset) => asset.symbol === 'DEMO-GOLD');
    expect(gold).toMatchObject({
      assetClass: 'metal', currency: 'EUR', source: 'demo_snapshot',
      amount: 10, fineMetalAmount: 9.999, currentPrice: 112.82, value: 1128.09,
    });
    expect(gold?.currentPrice).toBeGreaterThan(100);
    expect(gold?.currentPrice).toBeLessThan(130); // EUR per gram, not per troy ounce
    expect(snapshot.assets.find((asset) => asset.symbol === 'DEMO-STOCK')?.name).toMatch(/Apple|AAPL/);
    expect(snapshot.assets.find((asset) => asset.symbol === 'DEMO-ETF')?.name).toMatch(/Islamic|ISWD/);
    expect(snapshot.history['DEMO-GOLD'].points.at(-1)?.close).toBe(gold?.currentPrice);
    expect(snapshot.portfolioHistory.at(-1)?.total).toBeCloseTo(
      snapshot.holdings.reduce((sum, item) => sum + item.value, 0), 2,
    );
  });

  it('is deterministic across independent factory calls', () => {
    const first = createInvestAtlasShowcaseSnapshot();
    const second = createInvestAtlasShowcaseSnapshot();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('contains fictional stock, ETF, crypto and cash examples without personal data', () => {
    const assetClasses = new Set(
      INVESTATLAS_SHOWCASE_SNAPSHOT.assets.map((asset) => asset.assetClass),
    );

    expect(assetClasses).toEqual(new Set(['stock', 'etf', 'crypto', 'metal', 'cash']));
    expect(
      INVESTATLAS_SHOWCASE_SNAPSHOT.assets.every((asset) => asset.fictional),
    ).toBe(true);
    expect(
      INVESTATLAS_SHOWCASE_SNAPSHOT.assets
        .filter((asset) => asset.assetClass !== 'cash')
        .every((asset) => asset.symbol.startsWith('DEMO-')),
    ).toBe(true);

    const serialized = JSON.stringify(INVESTATLAS_SHOWCASE_SNAPSHOT);
    expect(serialized).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(serialized).not.toMatch(/coingecko|yahoo|binance|bitfinex|coinbase|kraken/i);
    expect(serialized).not.toMatch(/https?:\/\//i);
  });

  it('keeps every record connected to the single synthetic provenance entry', () => {
    const snapshot = INVESTATLAS_SHOWCASE_SNAPSHOT;
    const expected = snapshot.provenance.id;

    const refs = [
      ...snapshot.assets.map((item) => item.provenanceRef),
      ...snapshot.transactions.map((item) => item.provenanceRef),
      ...snapshot.holdings.map((item) => item.provenanceRef),
      ...snapshot.watchlists.map((item) => item.provenanceRef),
      ...Object.values(snapshot.history).map((item) => item.provenanceRef),
      ...snapshot.shariahExamples.map((item) => item.provenanceRef),
      ...snapshot.purificationExamples.map((item) => item.provenanceRef),
      snapshot.portfolioHistoryProvenanceRef,
    ];

    expect(new Set(refs)).toEqual(new Set([expected]));
  });

  it('reconciles transaction quantities and cash with the generated holdings', () => {
    const snapshot = INVESTATLAS_SHOWCASE_SNAPSHOT;
    const quantities = new Map<string, number>();
    let cash = 0;

    expect(
      snapshot.transactions.find((transaction) => transaction.type === 'deposit'),
    ).toEqual(expect.objectContaining({
      assetClass: 'cash',
      taxType: 'cash_in',
    }));

    for (const transaction of snapshot.transactions) {
      if (transaction.type === 'deposit' || transaction.type === 'dividend') {
        cash += transaction.total - transaction.fee;
      } else if (transaction.type === 'buy') {
        quantities.set(
          transaction.asset,
          (quantities.get(transaction.asset) ?? 0) + transaction.amount,
        );
        cash -= transaction.total + transaction.fee;
      } else {
        quantities.set(
          transaction.asset,
          (quantities.get(transaction.asset) ?? 0) - transaction.amount,
        );
        cash += transaction.total - transaction.fee;
      }
    }

    for (const holding of snapshot.holdings) {
      if (holding.assetClass === 'cash') {
        expect(holding.amount).toBeCloseTo(cash, 8);
      } else {
        expect(holding.amount).toBeCloseTo(quantities.get(holding.symbol) ?? 0, 8);
        expect(holding.value).toBeCloseTo(
          (holding.assetClass === 'metal' ? 9.999 : holding.amount) * holding.currentPrice,
          2,
        );
        expect(holding.pnl).toBeCloseTo(holding.value - holding.costBasis, 2);
      }
    }

    const allocation = snapshot.holdings.reduce(
      (sum, holding) => sum + holding.allocation,
      0,
    );
    expect(allocation).toBeCloseTo(100, 5);
  });

  it('provides deterministic daily market and portfolio history ending at the manifest date', () => {
    const snapshot = INVESTATLAS_SHOWCASE_SNAPSHOT;
    const endDate = snapshot.manifest.dataAsOf.slice(0, 10);

    for (const holding of snapshot.holdings) {
      const series = snapshot.history[holding.symbol];
      expect(series.points).toHaveLength(90);
      expect(series.realtime).toBe(false);
      expect(series.quality).toBe('demo');
      expect(series.points.at(-1)?.date).toBe(endDate);
      expect(series.points.at(-1)?.close).toBe(holding.currentPrice);

      for (let index = 1; index < series.points.length; index += 1) {
        expect(Date.parse(series.points[index].date)).toBeGreaterThan(
          Date.parse(series.points[index - 1].date),
        );
      }
    }

    expect(snapshot.portfolioHistory).toHaveLength(90);
    expect(snapshot.portfolioHistory.at(-1)?.total).toBeCloseTo(
      snapshot.holdings.reduce((sum, holding) => sum + holding.value, 0),
      2,
    );
  });

  it('covers all four fail-closed Shariah example states', () => {
    const statuses = new Set(
      INVESTATLAS_SHOWCASE_SNAPSHOT.shariahExamples.map((item) => item.status),
    );

    expect(statuses).toEqual(new Set([
      'compliant',
      'non_compliant',
      'review_required',
      'insufficient_data',
    ]));
    expect(
      INVESTATLAS_SHOWCASE_SNAPSHOT.shariahExamples
        .filter((item) => item.status === 'review_required' || item.status === 'insufficient_data')
        .every((item) => item.requiresManualReview),
    ).toBe(true);
    expect(
      INVESTATLAS_SHOWCASE_SNAPSHOT.shariahExamples
        .every((item) => item.religiousAuthorityClaimed === false),
    ).toBe(true);
  });

  it('keeps a known purification zero distinct from missing inputs', () => {
    const examples = INVESTATLAS_SHOWCASE_SNAPSHOT.purificationExamples;
    const knownZero = examples.find((item) => item.reason === 'known_zero');
    const missing = examples.find((item) => item.reason === 'required_input_missing');

    expect(knownZero).toEqual(expect.objectContaining({
      status: 'available',
      inputState: 'known',
      amountEur: 0,
    }));
    expect(missing).toEqual(expect.objectContaining({
      status: 'insufficient_data',
      inputState: 'missing',
      amountEur: null,
    }));
  });

  it('does not activate the inert snapshot through legacy Local/Cloud data exports', () => {
    expect(DEMO_TRANSACTIONS).toEqual([]);
    expect(DEMO_HOLDINGS).toEqual([]);
    expect(DEMO_PORTFOLIO_GROWTH).toEqual([]);
  });
});
