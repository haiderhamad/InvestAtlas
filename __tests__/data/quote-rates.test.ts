import {
  canNormalizeToEur,
  normalizeToEur,
} from '@/lib/fx/quote-rates';

describe('quote-rate trust boundary', () => {
  it('keeps known EUR values unchanged', () => {
    expect(normalizeToEur(100, 'EUR')).toBe(100);
    expect(canNormalizeToEur('eur')).toBe(true);
  });

  it.each(['USD', 'USDT', 'GBP', 'UNKNOWN'])(
    'does not guess an EUR value for %s',
    (quote) => {
      expect(normalizeToEur(100, quote)).toBeNull();
      expect(canNormalizeToEur(quote)).toBe(false);
    },
  );
});
