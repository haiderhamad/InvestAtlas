import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import {
  clearTiingoBrowserCredential, loadTiingoBrowserDailySeries,
  setTiingoBrowserCredential, testTiingoBrowserCredential,
} from '@/lib/financial-data/providers/tiingo-browser';
import { fetchFinancialData } from '@/lib/financial-data/client';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID as LOCAL_ID } from '@/lib/runtime/local-personal-provider';
import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: jest.fn(async () => null) }));
jest.mock('@/lib/storage/workspace-storage', () => ({ getActiveBrowserWorkspaceUserId: () => null }));
jest.mock('@/lib/demo/workspace-mode', () => ({ readAnonymousWorkspaceMode: jest.fn(() => 'local_workspace') }));
jest.mock('@/lib/financial-data/providers/tiingo-browser-market-data', () => ({
  handlePersonalBrowserMarketRequest: jest.fn(),
}));
jest.mock('@/lib/demo/financial-api', () => ({
  handleDemoFinancialRequest: jest.fn(() => null),
}));

const identity = jest.mocked(getFirebaseApiIdentity);
const personal = jest.mocked(handlePersonalBrowserMarketRequest);
const mode = jest.mocked(readAnonymousWorkspaceMode);
const originalFetch = global.fetch;

function bar(offset: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return {
    date: d.toISOString().slice(0, 10) + 'T00:00:00.000Z',
    open: 100, high: 101, low: 99, close: 100, volume: 1000,
  };
}

describe('Local Personal Tiingo browser integration without Firebase', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'http://127.0.0.1:3187' },
        dispatchEvent: jest.fn(),
      },
    });
  });
  beforeEach(() => {
    identity.mockReset().mockResolvedValue(null);
    mode.mockReset().mockReturnValue('local_workspace');
    personal.mockReset();
    clearTiingoBrowserCredential();
    global.fetch = jest.fn(async () => new Response(
      JSON.stringify({ symbol: 'AAPL', data: [bar(2), bar(1)] }), { status: 200 },
    ));
  });

  afterAll(() => {
    clearTiingoBrowserCredential();
    global.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('tests and retrieves daily data with a tab-only key and no Firebase Bearer', async () => {
    await expect(testTiingoBrowserCredential(LOCAL_ID, 'SYNTHETIC_LOCAL_ONLY'))
      .resolves.toBe('connected');
    setTiingoBrowserCredential(LOCAL_ID, 'SYNTHETIC_LOCAL_ONLY');
    await expect(loadTiingoBrowserDailySeries(LOCAL_ID, 'AAPL'))
      .resolves.toMatchObject({ assetSymbol: 'AAPL', cacheStatus: 'miss' });
    expect(identity).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [path, options] = jest.mocked(global.fetch).mock.calls[1];
    expect(path).toBe('/api/local/tiingo/series');
    expect(new Headers(options?.headers).has('authorization')).toBe(false);
    expect(options).toMatchObject({
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
  });

  it('uses the local personal market-data handler, not the public backend', async () => {
    const privateResponse = new Response('{"status":"available"}', { status: 200 });
    personal.mockResolvedValueOnce(privateResponse);
    const response = await fetchFinancialData('/api/prices/current?symbols=AAPL');
    expect(response).toBe(privateResponse);
    expect(personal).toHaveBeenCalledWith(
      '/api/prices/current?symbols=AAPL',
      expect.objectContaining({}),
      LOCAL_ID,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not route Demo Snapshot requests to the personal BYOK handler', async () => {
    mode.mockReturnValue('demo_snapshot');
    const response = await fetchFinancialData('/api/prices/current?symbols=AAPL');
    expect(response.status).toBe(422);
    expect(personal).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
