import { proxy } from '@/proxy';

const nextMock = jest.fn(() => ({ action: 'next' }));
const jsonMock = jest.fn((body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
  ({ action: 'json', body, status: init?.status, headers: init?.headers }));

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => nextMock(),
    json: (...args: unknown[]) => jsonMock(args[0], args[1] as { status?: number }),
  },
}));
jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud',
  isValidPrivateOwnerUid: (uid: unknown) => typeof uid === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(uid),
}));

function request(pathname: string, token?: string) {
  return {
    nextUrl: { pathname },
    headers: {
      has: (header: string) => header.toLowerCase() === 'authorization' && token !== undefined,
      get: (header: string) => header.toLowerCase() === 'authorization'
        ? token === undefined ? null : `Bearer ${token}`
        : null,
    },
  } as Parameters<typeof proxy>[0];
}

describe('Private Cloud API server perimeter behavior', () => {
  const oldUid = process.env.INVESTATLAS_PRIVATE_OWNER_UID;
  const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const oldFetch = global.fetch;
  const fakeProjectKey = 'AI' + 'za' + 'A'.repeat(32);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INVESTATLAS_PRIVATE_OWNER_UID = 'personal-owner';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = fakeProjectKey;
    global.fetch = jest.fn() as typeof fetch;
  });

  afterAll(() => {
    if (oldUid === undefined) delete process.env.INVESTATLAS_PRIVATE_OWNER_UID;
    else process.env.INVESTATLAS_PRIVATE_OWNER_UID = oldUid;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
    global.fetch = oldFetch;
  });

  it('preserves anonymous public FX and pricing routes but protects personal pricing', async () => {
    for (const path of [
      '/api/financial-data/fx',
      '/api/financial-data/fx/history',
      '/api/prices/current',
      '/api/prices/history',
    ]) {
      expect(await proxy(request(path))).toEqual({ action: 'next' });
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await proxy(request('/api/financial-data/providers'))).toMatchObject({
      status: 401,
    });
    expect(await proxy(request('/api/prices/current', 'too-short'))).toMatchObject({
      status: 401,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('verifies owner identity for personal pricing even on otherwise public paths', async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true, json: async () => ({ users: [{ localId: 'not-the-owner' }] }),
    } as Response);
    expect(await proxy(request('/api/prices/history', 'a'.repeat(40)))).toMatchObject({
      status: 403,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('denies every request when owner binding is missing', async () => {
    delete process.env.INVESTATLAS_PRIVATE_OWNER_UID;
    const result = await proxy(request('/api/ai/providers', 'a'.repeat(32)));
    expect(result).toMatchObject({ status: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('denies missing, malformed and oversized personal credentials before network access', async () => {
    for (const token of [undefined, 'short', 'z'.repeat(20000), 'a'.repeat(21) + '\n']) {
      expect(await proxy(request('/api/financial-data/providers', token))).toMatchObject({
        status: 401,
      });
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('denies a different valid Firebase account even when their token is accepted', async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true, json: async () => ({ users: [{ localId: 'other-person' }] }),
    } as Response);
    const result = await proxy(request('/api/financial-data/tiingo/local-series', 'v'.repeat(30)));
    expect(result).toMatchObject({ status: 403 });
    expect(nextMock).not.toHaveBeenCalled();
  });

  it.each([
    '/api/account/delete',
    '/api/ai/providers',
    '/api/financial-data/providers',
    '/api/transactions/import',
    '/api/prices/current',
  ])('rejects a valid second account before protected handler %s', async (pathname) => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true, json: async () => ({ users: [{ localId: 'other-person' }] }),
    } as Response);
    expect(await proxy(request(pathname, 'v'.repeat(30)))).toMatchObject({ status: 403 });
    expect(nextMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('allows only the verified configured owner UID to reach downstream route handlers', async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true, json: async () => ({ users: [{ localId: 'personal-owner' }] }),
    } as Response);
    const result = await proxy(request('/api/ai/providers', 'v'.repeat(30)));
    expect(result).toMatchObject({ action: 'next' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = jest.mocked(global.fetch).mock.calls[0];
    expect(url).toContain('https://identitytoolkit.googleapis.com/v1/accounts:lookup?');
    expect(options?.cache).toBe('no-store');
    expect(String(options?.body)).not.toContain('personal-owner');
  });

  it('fails closed on lookup/network errors and does not leak provider messages', async () => {
    jest.mocked(global.fetch).mockRejectedValue(new Error('provider private details'));
    const result = await proxy(request('/api/prices/history', 'v'.repeat(30)));
    expect(result).toMatchObject({ status: 503, body: { error: 'Unavailable for this installation' } });
  });
});
