import { POST as runBacktest } from '@/app/api/backtest/route';
import { POST as syncPrices } from '@/app/api/prices/sync/route';

describe('public compute and mutation guards', () => {
  it('rejects oversized backtest payloads before parsing', async () => {
    const response = await runBacktest(
      new Request('http://localhost/api/backtest', {
        method: 'POST',
        headers: { 'content-length': String(512 * 1024 + 1) },
        body: '{}',
      }),
    );

    expect(response.status).toBe(413);
  });

  it('rejects mismatched or untrusted backtest data', async () => {
    const response = await runBacktest(
      new Request('http://localhost/api/backtest', {
        method: 'POST',
        body: JSON.stringify({
          asset: '../BTC',
          parameters: {},
          prices: Array.from({ length: 10 }, () => 100),
          dates: Array.from({ length: 10 }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`),
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects duplicate or non-chronological backtest dates', async () => {
    const dates = Array.from(
      { length: 10 },
      (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`,
    );
    dates[6] = dates[5];

    const response = await runBacktest(
      new Request('http://localhost/api/backtest', {
        method: 'POST',
        body: JSON.stringify({
          asset: 'BTC',
          parameters: {
            strategyType: 'single_sma',
            smaPeriod: 3,
            feePercent: 0.25,
            slippagePercent: 0.1,
            initialCapital: 100,
            interval: '1d',
          },
          prices: Array.from({ length: 10 }, () => 100),
          dates,
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('disables public global price-cache synchronization', async () => {
    const response = await syncPrices();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
