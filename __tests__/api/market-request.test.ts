import {
  MarketRequestValidationError,
  parseAssetSearchQuery,
  parseHistoryDays,
  parseIsoDate,
  parseMarketSymbols,
  parseQuoteCurrency,
  requireAllowlistedValue,
} from '@/lib/api/market-request';

describe('market API request validation', () => {
  it('accepts only supported quote currencies', () => {
    expect(parseQuoteCurrency('EUR')).toBe('eur');
    expect(parseQuoteCurrency('usd')).toBe('usd');
    expect(() => parseQuoteCurrency('gbp')).toThrow(
      MarketRequestValidationError,
    );
  });

  it('normalizes, deduplicates, and bounds symbols', () => {
    expect(parseMarketSymbols('btc, BTC, sap.de', 'BTC')).toEqual([
      'BTC',
      'SAP.DE',
    ]);
    expect(() =>
      parseMarketSymbols(Array.from({ length: 26 }, (_, index) => `A${index}`).join(','), 'BTC'),
    ).toThrow('Too many symbols');
    expect(() => parseMarketSymbols('../BTC', 'BTC')).toThrow(
      'Invalid symbol list',
    );
  });

  it('bounds external search input', () => {
    expect(parseAssetSearchQuery('  NVIDIA ')).toBe('NVIDIA');
    expect(() => parseAssetSearchQuery('x'.repeat(65))).toThrow(
      'Invalid search query',
    );
    expect(() => parseAssetSearchQuery('BTC\u0000')).toThrow(
      'Invalid search query',
    );
  });

  it('accepts only supported ranges and real ISO dates', () => {
    expect(parseHistoryDays('365')).toBe(365);
    expect(() => parseHistoryDays('999999')).toThrow(
      'Unsupported history range',
    );
    expect(parseIsoDate('2026-07-25')).toBe('2026-07-25');
    expect(() => parseIsoDate('2026-02-31')).toThrow('Invalid date');
  });

  it('enforces exact allowlists for upstream identifiers', () => {
    const allowlist = new Set(['^GSPC']);
    expect(requireAllowlistedValue('^GSPC', allowlist, 'benchmark')).toBe(
      '^GSPC',
    );
    expect(() =>
      requireAllowlistedValue('UNTRUSTED', allowlist, 'benchmark'),
    ).toThrow('Unsupported benchmark');
  });
});
