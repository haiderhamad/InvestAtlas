import { proxy } from '@/proxy';

const nextMock = jest.fn(() => ({ action: 'next' }));
const jsonMock = jest.fn((body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
  ({ action: 'json', body, status: init?.status, headers: init?.headers }));

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => nextMock(),
    json: (body: unknown, init: { status?: number; headers?: Record<string, string> }) =>
      jsonMock(body, init),
  },
}));
jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'local_personal',
  isValidPrivateOwnerUid: () => false,
}));

function request(pathname: string, authenticated = false) {
  return {
    nextUrl: { pathname },
    headers: {
      has: (name: string) => name.toLowerCase() === 'authorization' && authenticated,
      get: (name: string) => name.toLowerCase() === 'authorization' && authenticated
        ? 'Bearer local-credential' : null,
    },
  } as Parameters<typeof proxy>[0];
}

describe('Local Personal API safety and open-data availability', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    '/api/ai', '/api/ai/providers', '/api/financial-data/providers',
    '/api/financial-data/tiingo/local-series', '/api/account/delete',
    '/api/transactions/import',
  ])('refuses Firebase-bound endpoint %s', async pathname => {
    expect(await proxy(request(pathname))).toMatchObject({ status: 403 });
  });

  it.each(['/api/prices/current', '/api/prices/history'])(
    'allows ordinary anonymous public prices on %s', async pathname => {
      expect(await proxy(request(pathname))).toEqual({ action: 'next' });
      expect(await proxy(request(pathname, true))).toMatchObject({ status: 403 });
    },
  );

  it('allows keyless ECB FX and public provider catalog', async () => {
    expect(await proxy(request('/api/financial-data/fx'))).toEqual({ action: 'next' });
    expect(await proxy(request('/api/data-providers'))).toEqual({ action: 'next' });
  });
});
