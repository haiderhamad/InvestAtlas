import { availableField, createMoney } from '@/lib/financial-data/contracts';
import { chartCurrentQuote } from '@/lib/charts/current-quote';

const source = { providerId: 'test_provider', providerName: 'Test provider', retrievedAt: '2026-11-08T09:00:00Z' };
function quote(symbol = 'GOLD', amount = 3110.35) {
  return { price: amount, currency: 'usd', source: 'Test provider', dataStatus: 'partial',
    fields: { assetId: symbol, outputCurrency: 'USD', price: availableField(createMoney(amount, 'USD'), {
      quality: 'observed', freshness: 'fresh', observedAt: '2026-11-08T08:59:00Z', asOf: '2026-11-08', provenance: source,
    }) } };
}

test('converts only metal troy-ounce quotes to fine grams', () => {
  expect(chartCurrentQuote(quote(), 'GOLD', 'usd', true)?.price).toBeCloseTo(100, 10);
  expect(chartCurrentQuote(quote('SILVER', 31.1035), 'SILVER', 'usd', true)?.price).toBeCloseTo(1, 10);
  expect(chartCurrentQuote(quote('HLAL', 68.14), 'HLAL', 'usd', false)?.price).toBe(68.14);
});

test('retains the provider time and source separately from chart observations', () => {
  expect(chartCurrentQuote(quote(), 'GOLD', 'usd', true)).toMatchObject({ observedAt: '2026-11-08T08:59:00Z', source: 'Test provider', demo: false });
});

test('rejects wrong identity, currency, unavailable, stale, nonfinite or inconsistent observations', () => {
  const valid = quote();
  const invalid = [
    null, { price: 10 }, { ...valid, price: NaN }, { ...valid, price: 0 },
    { ...valid, price: 20 }, { ...valid, currency: 'eur' }, { ...valid, dataStatus: 'unavailable' },
    { ...valid, fields: { ...valid.fields, assetId: 'SILVER' } },
    { ...valid, fields: { ...valid.fields, outputCurrency: 'EUR' } },
    { ...valid, fields: { ...valid.fields, price: { ...valid.fields.price, freshness: 'stale' } } },
    { ...valid, fields: { ...valid.fields, price: { ...valid.fields.price, observedAt: 'not-a-date' } } },
    { ...valid, fields: { ...valid.fields, price: { ...valid.fields.price, value: { amount: valid.price, currency: 'EUR' } } } },
  ];
  for (const value of invalid) expect(chartCurrentQuote(value, 'GOLD', 'usd', true)).toBeNull();
});

test('keeps a legitimate synthetic observation labeled as demo', () => {
  const row = quote();
  expect(chartCurrentQuote({ ...row, fields: { ...row.fields, price: { ...row.fields.price, quality: 'demo', freshness: 'unknown' } } }, 'GOLD', 'usd', true)?.demo).toBe(true);
});
