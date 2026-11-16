import {
  normalizePersonalListingIdentity,
} from '@/lib/config/personal-instrument';

const listing = {
  version: 1, symbol: 'ADBE', providerSymbol: 'ADBE', name: 'Adobe Inc.',
  assetClass: 'stock', nativeCurrency: 'usd', exchange: 'NMS',
  source: 'yahoo_chart', resolvedAt: '2026-11-07T10:00:00.000Z',
} as const;

describe('personal listing identity boundary', () => {
  it('normalizes a bounded exact stock listing without adding trust claims', () => {
    expect(normalizePersonalListingIdentity({
      ...listing, symbol: ' adbe ', providerSymbol: 'adbe', name: ' Adobe Inc. ', exchange: 'nms',
      resolvedAt: '2026-11-07T10:00:00Z',
    })).toEqual(listing);
  });

  it('accepts only the exact catalog provider mapping and native classification', () => {
    expect(normalizePersonalListingIdentity({
      ...listing, symbol: 'ISWD', providerSymbol: 'IUSD.DE', name: 'Islamic world ETF',
      assetClass: 'etf', nativeCurrency: 'eur', exchange: 'GER',
    })).toMatchObject({ symbol: 'ISWD', providerSymbol: 'IUSD.DE', nativeCurrency: 'eur' });
    for (const mutation of [
      { providerSymbol: 'ISWD.L' }, { providerSymbol: 'ISWD' },
      { nativeCurrency: 'usd' }, { assetClass: 'stock' },
    ]) {
      expect(normalizePersonalListingIdentity({
        ...listing, symbol: 'ISWD', providerSymbol: 'IUSD.DE', assetClass: 'etf',
        nativeCurrency: 'eur', exchange: 'GER', ...mutation,
      })).toBeNull();
    }
  });

  it('does not let custom aliases borrow another provider identity', () => {
    expect(normalizePersonalListingIdentity({ ...listing, symbol: 'PERSONAL-ADOBE' })).toBeNull();
    expect(normalizePersonalListingIdentity({
      ...listing, symbol: 'SAP', providerSymbol: 'SAP',
    })).toBeNull();
    expect(normalizePersonalListingIdentity({
      ...listing, symbol: 'BTC', providerSymbol: 'BTC',
    })).toBeNull();
  });

  it.each([
    null, [], 'ADBE', {},
    { ...listing, version: 2 },
    { ...listing, providerSymbol: 'https://attacker.invalid/ADBE' },
    { ...listing, symbol: '../ADBE' },
    { ...listing, symbol: 'ıbm', providerSymbol: 'ıbm' },
    { ...listing, symbol: 'ß', providerSymbol: 'ß' },
    { ...listing, symbol: 'A'.repeat(33), providerSymbol: 'A'.repeat(33) },
    { ...listing, name: ' ' },
    { ...listing, name: 'A'.repeat(257) },
    { ...listing, name: 'Adobe\nInc.' },
    { ...listing, exchange: '' },
    { ...listing, exchange: 'N'.repeat(65) },
    { ...listing, exchange: 'https://attacker.invalid' },
    { ...listing, nativeCurrency: 'gbp' },
    { ...listing, assetClass: 'crypto' },
    { ...listing, source: 'user' },
    { ...listing, resolvedAt: 'not-a-date' },
    { ...listing, resolvedAt: '2026-02-30T10:00:00.000Z' },
    { ...listing, resolvedAt: '2026-11-07T24:00:00.000Z' },
    { ...listing, resolvedAt: '2026-11-07' },
    { ...listing, url: 'https://attacker.invalid' },
    { ...listing, isHalal: true },
    { ...listing, compliance: { status: 'Compliant' } },
  ])('rejects malformed or untrusted identity %#', (value) => {
    expect(normalizePersonalListingIdentity(value)).toBeNull();
  });

  it('returns independent values so callers cannot mutate a stored identity', () => {
    const first = normalizePersonalListingIdentity(listing)!;
    first.name = 'Changed by a caller';
    expect(normalizePersonalListingIdentity(listing)?.name).toBe('Adobe Inc.');
  });
});
