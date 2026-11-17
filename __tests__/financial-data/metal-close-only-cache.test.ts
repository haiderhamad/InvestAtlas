import type { HistoryCacheRecord } from '@/lib/financial-data/history/cache';

const now = Date.parse('2026-11-16T12:00:00Z');
const record = () => ({
  key: { installation: 'https://private.example:private_cloud', owner: 'metal-owner', instrument: 'XAU',
    exchange: 'INDICATIVE_DEALER', providerId: 'standard_bullion_daily', currency: 'USD', interval: '1d',
    adjustment: 'raw_unadjusted', version: 1 },
  bars: [{ date: '2026-11-15', close: 4000, open: null, high: null, low: null, volume: null, dataQuality: 'close_only' }],
  coverage: [{ from: '2026-11-14', to: '2026-11-15' }], retrievedAt: now - 1000, lastCheckedAt: now - 1000,
});
beforeEach(() => { jest.resetModules(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
const repository = () => (require('@/lib/financial-data/history/cache') as typeof import('@/lib/financial-data/history/cache')).getHistoryRepository();

test('retains source-isolated close-only observations without inventing OHLC', async () => {
  const repo = repository();
  const incoming = record() as unknown as HistoryCacheRecord;
  expect(await repo.write(incoming)).toBe(true);
  expect(await repo.read(incoming.key)).toEqual(incoming);
  expect((await repo.read({ ...incoming.key, owner: 'other-owner' }))).toBeNull();
  expect((await repo.read({ ...incoming.key, installation: 'https://other.example:private_cloud' }))).toBeNull();
});

test.each([
  { open: 100 }, { high: 100 }, { low: 100 }, { volume: 100 }, { adjustedClose: 100 },
  { close: 0 }, { close: Infinity }, { dataQuality: undefined }, { date: '2026-11-16' },
])('rejects malformed close-only storage: %j', async change => {
  const incoming = record(); Object.assign(incoming.bars[0], change);
  expect(await repository().write(incoming as unknown as HistoryCacheRecord)).toBe(false);
});

test('does not expand retention rights to Yahoo or an unknown provider', async () => {
  for (const providerId of ['yahoo_personal_daily', 'unreviewed_daily']) {
    const incoming = record(); incoming.key.providerId = providerId;
    expect(await repository().write(incoming as unknown as HistoryCacheRecord)).toBe(false);
  }
});

test.each([{ instrument: 'AAPL' }, { currency: 'EUR' }, { exchange: 'UNKNOWN' }, { adjustment: 'adjusted_close' }])
('rejects a Standard Bullion cache identity outside its reviewed physical-metal contract: %j', async change => {
  const incoming = record(); Object.assign(incoming.key, change);
  expect(await repository().write(incoming as unknown as HistoryCacheRecord)).toBe(false);
});

test('the metal source cannot persist manufactured OHLC or grant close-only retention to EODHD', async () => {
  const incoming = record();
  const fabricated = { ...incoming, bars: [{ date: '2026-11-15', open: 3990, high: 4010, low: 3980, close: 4000, volume: null }] };
  expect(await repository().write(fabricated as HistoryCacheRecord)).toBe(false);
  incoming.key.providerId = 'eodhd_personal_daily';
  expect(await repository().write(incoming as unknown as HistoryCacheRecord)).toBe(false);
});
