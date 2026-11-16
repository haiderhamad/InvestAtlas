import {
  HistoryRequestValidationError,
  normalizeHistoryRequest,
} from '@/lib/data/history-request';

describe('normalizeHistoryRequest', () => {
  test('normalizes a supported asset, currency, and interval', () => {
    expect(normalizeHistoryRequest(' btc ', 'USD', '15M')).toEqual(
      expect.objectContaining({
        symbol: 'BTC',
        currency: 'usd',
        interval: '15m',
      }),
    );
  });

  test.each([
    ['../../outside', 'eur', '1d'],
    ['BTC', '../outside', '1d'],
    ['BTC', 'eur', '../outside'],
  ])('rejects path-like input before provider or cache use', (symbol, currency, interval) => {
    expect(() => normalizeHistoryRequest(symbol, currency, interval)).toThrow(
      HistoryRequestValidationError,
    );
  });

  test('maps a supported exchange alias to its canonical asset', () => {
    expect(normalizeHistoryRequest('ISWD.SW')).toEqual(
      expect.objectContaining({
        symbol: 'ISWD',
        currency: 'eur',
        interval: '1d',
      }),
    );
  });
});
