import { parseTwelve, supportsTwelve } from '@/lib/financial-data/providers/twelve-personal';

describe('Twelve Data supported US listing coverage', () => {
  const now = Date.parse('2026-11-02T20:00:00Z');
  const response = {
    meta: { symbol: 'HLAL', exchange: 'NYSE ARCA', mic_code: 'ARCX', currency: 'USD', interval: '1day' },
    values: [{
      datetime: '2026-10-30', open: '48.12', high: '49.50',
      low: '47.88', close: '49.10', volume: '123456',
    }],
  };

  it('accepts supported USD-denominated US stocks and ETFs, not European listings', () => {
    expect(supportsTwelve('AAPL')).toBe(true);
    expect(supportsTwelve('HLAL')).toBe(true);
    expect(supportsTwelve('SPUS')).toBe(true);
    expect(supportsTwelve('ISWD')).toBe(false);
    expect(supportsTwelve('SAP')).toBe(false);
    expect(supportsTwelve('GOLD')).toBe(false);
  });

  it('accepts authentic NYSE Arca metadata for a US ETF', () => {
    const series = parseTwelve(response, 'HLAL', now);
    expect(series).toMatchObject({
      providerId: 'twelve_personal_daily',
      assetSymbol: 'HLAL', listingCurrency: 'USD',
      bars: [{ date: '2026-10-30', close: 49.10 }],
    });
  });

  it('rejects exchange, currency, and asset identity mismatches', () => {
    expect(() => parseTwelve({ ...response, meta: { ...response.meta, mic_code: 'XNYS' } }, 'HLAL', now)).toThrow();
    expect(() => parseTwelve({ ...response, meta: { ...response.meta, exchange: 'LSE' } }, 'HLAL', now)).toThrow();
    expect(() => parseTwelve({ ...response, meta: { ...response.meta, currency: 'EUR' } }, 'HLAL', now)).toThrow();
    expect(() => parseTwelve({ ...response, meta: { ...response.meta, symbol: 'SPUS' } }, 'HLAL', now)).toThrow();
  });
});
