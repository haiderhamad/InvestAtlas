import { handleYahooPersonalRequest } from '@/lib/financial-data/providers/yahoo-personal-route';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
const originalFetch = global.fetch;
const oldVercel = process.env.VERCEL;
const request = () => new Request('http://localhost:3000/api/local/yahoo/series', {
  method: 'POST', headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
  body: JSON.stringify({ symbol: 'AAPL' }),
});
beforeEach(() => { delete process.env.VERCEL; });
afterAll(() => {
  global.fetch = originalFetch;
  if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
});

test('a Yahoo 429 retains the upstream Retry-After and makes only one upstream attempt', async () => {
  global.fetch = jest.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  const response = await handleYahooPersonalRequest(request(), 'local');
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('120');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([401, 403])('a blocked Yahoo upstream (%s) remains distinguishable from owner authentication', async status => {
  global.fetch = jest.fn(async () => Response.json({}, { status }));
  const response = await handleYahooPersonalRequest(request(), 'local');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'provider_access_denied' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
