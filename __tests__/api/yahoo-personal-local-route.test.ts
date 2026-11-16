import { handleYahooPersonalRequest } from '@/lib/financial-data/providers/yahoo-personal-route';
import { fetchYahooPersonalDaily } from '@/lib/financial-data/providers/yahoo-personal-server';
import { SUPPORTED_ETF_ASSETS, SUPPORTED_STOCK_ASSETS } from '@/lib/config/supported-assets';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/financial-data/providers/yahoo-personal-server', () => ({
  supportsYahooPersonalAsset: jest.requireActual('@/lib/financial-data/providers/yahoo-personal-server').supportsYahooPersonalAsset,
  fetchYahooPersonalDaily: jest.fn(),
}));
const yahoo = jest.mocked(fetchYahooPersonalDaily);
const url = 'http://localhost:3000/api/local/yahoo/series';
const request = (host: string, origin: string, symbol = 'AAPL') => new Request(url, {
  method: 'POST', headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ symbol }),
});

beforeEach(() => {
  delete process.env.VERCEL;
  globalThis.__investAtlasRateLimits?.clear();
  yahoo.mockReset().mockResolvedValue({
    providerId: 'yahoo_personal_daily', assetSymbol: 'AAPL',
    providerSymbol: 'AAPL', listingCurrency: 'USD',
    retrievedAt: '2026-11-03T18:00:00Z', latestObservationAt: '2026-11-02', cacheStatus: 'miss',
    bars: [{ date: '2026-11-02', open: 330, high: 340, low: 328, close: 336, volume: 100 }],
  });
});
describe('local personal Yahoo bridge', () => {
  it('accepts a same-origin POST from a loopback browser only', async () => {
    expect((await handleYahooPersonalRequest(request('localhost:3000', 'http://localhost:3000'), 'local')).status).toBe(200);
    expect(yahoo).toHaveBeenCalledTimes(1);
  });
  it('rejects a cross-site request before any quote fetch', async () => {
    expect((await handleYahooPersonalRequest(request('localhost:3000', 'https://evil.example'), 'local')).status).toBe(403);
    expect(yahoo).not.toHaveBeenCalled();
  });

  it('allows all 20 catalog stock and ETF requests in one explicit refresh', async () => {
    const symbols = [...SUPPORTED_STOCK_ASSETS, ...SUPPORTED_ETF_ASSETS].map(asset => asset.symbol);
    expect(symbols).toHaveLength(20);
    const responses = await Promise.all(symbols.map(symbol => handleYahooPersonalRequest(
      request('localhost:3000', 'http://localhost:3000', symbol), 'local',
    )));
    expect(responses.map(response => response.status)).toEqual(Array(20).fill(200));
    expect(yahoo).toHaveBeenCalledTimes(20);
  });

  it('retains a 24-request minute limit and refuses excess upstream work', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 7, 12));
    try {
      for (let i = 0; i < 24; i++) {
        expect((await handleYahooPersonalRequest(request('localhost:3000', 'http://localhost:3000'), 'local')).status).toBe(200);
      }
      const limited = await handleYahooPersonalRequest(request('localhost:3000', 'http://localhost:3000'), 'local');
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('60');
      expect(yahoo).toHaveBeenCalledTimes(24);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('retains the 80-request hour limit across separated manual refreshes', async () => {
    const clock = jest.spyOn(Date, 'now');
    try {
      for (let i = 0; i < 80; i++) {
        clock.mockReturnValue(Date.UTC(2026, 10, 7, 12) + Math.floor(i / 20) * 90_000);
        expect((await handleYahooPersonalRequest(request('localhost:3000', 'http://localhost:3000'), 'local')).status).toBe(200);
      }
      clock.mockReturnValue(Date.UTC(2026, 10, 7, 12) + 360_000);
      const limited = await handleYahooPersonalRequest(request('localhost:3000', 'http://localhost:3000'), 'local');
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('3240');
      expect(yahoo).toHaveBeenCalledTimes(80);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
