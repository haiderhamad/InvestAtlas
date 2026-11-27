import { readTradeReference } from '@/lib/financial-data/history/selection';

it('skips a newer close with conflicting provider provenance', () => {
  const earlier = { ref: 'earlier', kind: 'market', providerId: 'verified_provider', providerName: 'Verified provider' };
  const disputed = { ref: 'disputed', kind: 'market', providerId: 'provider_a', providerName: 'Provider A' };

  expect(readTradeReference({
    status: 'partial',
    symbol: 'META',
    currency: 'eur',
    sources: [earlier, disputed, { ...disputed, providerId: 'provider_b', providerName: 'Provider B' }],
    prices: [
      { date: '2024-11-18', close: 22, sourceRef: 'earlier' },
      { date: '2024-11-19', close: 25, sourceRef: 'disputed' },
    ],
  }, {
    symbol: 'META', currency: 'eur', tradeDay: '2024-11-20', executionCutoff: Date.parse('2024-11-20T18:33Z'),
  })).toEqual({ date: '2024-11-18', price: 22, source: 'Verified provider' });
});
