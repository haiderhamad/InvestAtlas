import { getAssetConfig } from '@/lib/config/supported-assets';
import {
  TROY_OUNCE_GRAMS,
  spotPricePerGram,
} from '@/lib/metals/metal-purity';

describe('precious-metal unit integrity', () => {
  it.each(['GOLD', 'SILVER'])(
    'declares %s holdings in grams',
    (symbol) => {
      expect(getAssetConfig(symbol)?.unitLabel).toBe('g');
    },
  );

  it('converts a troy-ounce quote into the matching pure-gram quote', () => {
    expect(spotPricePerGram(TROY_OUNCE_GRAMS * 100, 1000)).toBeCloseTo(100);
  });
});
