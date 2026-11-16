import {
  findAssetByIdentifier,
  getAssetTickers,
  normalizeAssetIdentifier,
} from '../../src/lib/config/supported-assets';

describe('supported asset identifiers', () => {
  test.each(['ISWD', 'IUSD.DE', 'ISWD.SW', 'ISWD.L', 'IE00B27YCN58', 'A0NA46'])(
    'maps %s to the existing iShares Islamic World ETF',
    (identifier) => {
      const asset = findAssetByIdentifier(identifier);
      expect(asset?.symbol).toBe('ISWD');
      expect(asset?.isin).toBe('IE00B27YCN58');
      expect(asset?.wkn).toBe('A0NA46');
    },
  );

  test('normalizes ISIN and WKN input without case, spaces, or hyphens', () => {
    expect(normalizeAssetIdentifier(' ie00-b27y cn58 ')).toBe('IE00B27YCN58');
    expect(normalizeAssetIdentifier(' a0-na46 ')).toBe('A0NA46');
  });

  test('exposes exchange tickers as aliases, not separate canonical assets', () => {
    const asset = findAssetByIdentifier('ISWD.SW');
    expect(asset?.symbol).toBe('ISWD');
    expect(getAssetTickers(asset!)).toEqual(expect.arrayContaining(['IUSD.DE', 'ISWD.SW']));
  });
});
