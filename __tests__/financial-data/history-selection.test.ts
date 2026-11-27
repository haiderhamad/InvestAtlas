import {
  findRecentHistoricalClose,
  readTradeReference,
  tradeReferenceHistoryRange,
} from '@/lib/financial-data/history/selection';

describe('historical close selection', () => {
  const points = [
    { date: '2026-07-23', close: 98 },
    { date: '2026-07-30', close: 101 },
    { date: '2026-08-01', close: 103 },
  ];

  it('uses the exact requested observation when available', () => {
    expect(findRecentHistoricalClose(points, '2026-08-01')).toEqual({
      date: '2026-08-01',
      close: 103,
    });
  });

  it('uses only a recent earlier observation and never a future one', () => {
    expect(findRecentHistoricalClose(points, '2026-07-31')).toEqual({
      date: '2026-07-30',
      close: 101,
    });
  });

  it('fails closed when the nearest earlier observation is too old', () => {
    expect(findRecentHistoricalClose(points, '2026-08-09')).toBeNull();
  });

  it('rejects invalid dates and non-positive or non-finite closes', () => {
    expect(findRecentHistoricalClose([
      { date: '2026-08-01', close: 0 },
      { date: '2026-07-31', close: Number.NaN },
    ], '2026-08-01')).toBeNull();
    expect(findRecentHistoricalClose(points, 'not-a-date')).toBeNull();
  });
});

const trade = {
  symbol: 'META',
  currency: 'eur' as const,
  tradeDay: '2024-11-20',
  executionCutoff: Date.parse('2024-11-20T10:00:00Z'),
};
const marketSource = { ref: 'market_1', kind: 'market', providerId: 'yahoo_personal_daily', providerName: 'Yahoo Finance' };
const fxSource = { ref: 'fx_1', kind: 'fx', providerId: 'ecb_reference_rates', providerName: 'European Central Bank' };
const conversion = { sourceCurrency: 'USD', rate: 0.9, asOf: '2024-11-18', sourceRef: 'fx_1' };
const payload = {
  status: 'partial',
  symbol: 'META',
  currency: 'eur',
  synthetic: false,
  sources: [marketSource, fxSource],
  prices: [
    { date: '2024-11-19', close: 72, sourceRef: 'market_1', priceQuality: 'calculated', conversion },
    { date: '2024-11-20', close: 73, sourceRef: 'market_1' },
    { date: '2024-11-18', close: 70, sourceRef: 'market_1' },
  ],
};
describe('trade reference history range', () => {
  it('requests only the seven days before the entered trade day', () => {
    expect(tradeReferenceHistoryRange('2024-11-20', Date.parse('2026-11-20T12:00:00Z')))
      .toEqual({ from: '2024-11-13', to: '2024-11-19' });
  });

  it('respects the browser earliest accepted date and yesterday UTC', () => {
    const now = Date.parse('2026-11-20T00:01:00Z');
    expect(tradeReferenceHistoryRange('2021-11-21', now)).toEqual({ from: '2021-11-19', to: '2021-11-20' });
    expect(tradeReferenceHistoryRange('2026-11-22', now)).toEqual({ from: '2026-11-15', to: '2026-11-19' });
    expect(tradeReferenceHistoryRange('2020-11-20', now)).toBeNull();
    expect(tradeReferenceHistoryRange('2026-02-30', now)).toBeNull();
  });
});

describe('trade reference observation', () => {
  it('chooses the latest completed earlier close and preserves its verified converted value', () => {
    expect(readTradeReference(payload, trade)).toEqual({
      date: '2024-11-19', price: 72, source: 'Yahoo Finance',
    });
  });

  it('uses the execution instant for UTC completion while keeping the original seven-day lower bound', () => {
    expect(readTradeReference(payload, {
      ...trade, executionCutoff: Date.parse('2024-11-19T23:30:00Z'),
    })).toEqual({ date: '2024-11-18', price: 70, source: 'Yahoo Finance' });
    expect(readTradeReference({
      ...payload,
      prices: [{ date: '2024-11-12', close: 65, sourceRef: 'market_1' }],
    }, trade)).toBeNull();
  });

  it.each([
    { symbol: 'AAPL' },
    { currency: 'usd' },
    { synthetic: true },
    { freshness: 'stale' },
    { status: 'unavailable' },
    { sources: [{ ...marketSource, providerId: 'twelve_demo_daily' }] },
    { sources: [{ ...marketSource, providerName: '' }] },
    { sources: [{ ...marketSource, providerName: 'Unknown provider' }] },
    { sources: [{ ...marketSource, ref: 'not_the_row_source' }] },
  ])('rejects untrusted history metadata %j', details => {
    expect(readTradeReference({ ...payload, ...details }, trade)).toBeNull();
  });

  it('skips a newer row whose currency conversion lacks trusted provenance', () => {
    expect(readTradeReference({ ...payload, sources: [marketSource] }, trade)).toEqual({
      date: '2024-11-18', price: 70, source: 'Yahoo Finance',
    });
  });

  it('uses Standard Bullion fine ounce prices per gram at the requested fineness', () => {
    const gold = {
      ...payload,
      symbol: 'GOLD',
      sources: [{ ...marketSource, providerId: 'standard_bullion_daily', providerName: 'Standard Bullion' }, fxSource],
      prices: [{ date: '2024-11-19', close: 3110.35, sourceRef: 'market_1', priceQuality: 'calculated', conversion }],
    };
    expect(readTradeReference(gold, { ...trade, symbol: 'GOLD', fineness: 750 })).toEqual({
      date: '2024-11-19', price: 75, source: 'Standard Bullion',
    });
    expect(readTradeReference(gold, { ...trade, symbol: 'GOLD' })).toBeNull();
    expect(readTradeReference({ ...gold, sources: [marketSource, fxSource] }, {
      ...trade, symbol: 'GOLD', fineness: 750,
    })).toBeNull();
  });

  it('uses native USD fine-ounce quotes for silver and requires evidence for EUR output', () => {
    const silver = {
      ...payload,
      symbol: 'SILVER',
      currency: 'usd',
      sources: [{ ...marketSource, providerId: 'standard_bullion_daily', providerName: 'Standard Bullion' }],
      prices: [{ date: '2024-11-19', close: 31.1035, sourceRef: 'market_1', priceQuality: 'observed' }],
    };
    expect(readTradeReference(silver, { ...trade, symbol: 'SILVER', currency: 'usd', fineness: 925 })).toEqual({
      date: '2024-11-19', price: 0.925, source: 'Standard Bullion',
    });
    expect(readTradeReference({ ...silver, currency: 'eur' }, {
      ...trade, symbol: 'SILVER', fineness: 925,
    })).toBeNull();
  });
});
