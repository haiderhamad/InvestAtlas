import { convertUsdFallbackPrice } from '@/lib/prices/fallback-currency';

describe('exchange fallback currency handling', () => {
  it('keeps a valid USD quote unchanged for USD output', () => {
    expect(convertUsdFallbackPrice(100, 'usd', null)).toBe(100);
  });

  it('converts an explicitly USD-denominated fallback to EUR', () => {
    expect(convertUsdFallbackPrice(100, 'eur', 0.91)).toBe(91);
  });

  it('does not relabel a USD quote as EUR without a rate', () => {
    expect(convertUsdFallbackPrice(100, 'eur', null)).toBeNull();
  });

  it.each([null, 0, -1, Number.NaN])(
    'rejects an invalid fallback quote (%p)',
    (value) => {
      expect(convertUsdFallbackPrice(value, 'usd', 1)).toBeNull();
    },
  );
});
