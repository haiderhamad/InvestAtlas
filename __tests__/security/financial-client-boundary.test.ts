const getFirebaseApiIdentity = jest.fn<Promise<{ userId: string; token: string } | null>, []>();
const readAnonymousWorkspaceMode = jest.fn();
const getActiveBrowserWorkspaceUserId = jest.fn();
const handlePersonalBrowserMarketRequest = jest.fn();

jest.mock('@/lib/auth/firebase-api-auth', () => ({
  getFirebaseApiIdentity,
}));
jest.mock('@/lib/demo/workspace-mode', () => ({
  readAnonymousWorkspaceMode,
}));
jest.mock('@/lib/storage/workspace-storage', () => ({
  getActiveBrowserWorkspaceUserId,
}));
jest.mock('@/lib/financial-data/providers/tiingo-browser-market-data', () => ({
  handlePersonalBrowserMarketRequest,
}));

import { fetchFinancialData } from '@/lib/financial-data/client';

describe('financial-data client security boundary', () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    jest.clearAllMocks();
    handlePersonalBrowserMarketRequest.mockResolvedValue(null);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: new URL('https://investatlas.example/dashboard') },
    });
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterAll(() => {
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it.each([
    '/api/prices/../private',
    '/api/prices/%2e%2e/private',
    '/api/assets/../../admin',
  ])('rejects normalized out-of-scope route %s before looking up auth', async (path) => {
    await expect(fetchFinancialData(path)).rejects.toThrow('Untrusted financial-data request');
    expect(getFirebaseApiIdentity).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts ordinary same-origin relative financial routes after normalization', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('local_workspace');
    await fetchFinancialData('/api/prices/current?symbols=AAPL');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves Request headers while stripping anonymous authorization', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('local_workspace');
    const request = new Request('https://investatlas.example/api/prices/current?symbols=AAPL', {
      headers: { 'X-Client-Tag': 'preserve-me', Authorization: 'Bearer old-account' },
    });

    await fetchFinancialData(request);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get('X-Client-Tag')).toBe('preserve-me');
    expect(sentHeaders.has('Authorization')).toBe(false);
  });

  it('rejects a personal Request response aborted through its own signal', async () => {
    getFirebaseApiIdentity.mockResolvedValue({ userId: 'user-a', token: 'synthetic-token' });
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-a');
    let finish!: (response: Response) => void;
    handlePersonalBrowserMarketRequest.mockImplementationOnce(
      () => new Promise<Response>((resolve) => { finish = resolve; }),
    );
    const controller = new AbortController();
    const request = new Request('https://investatlas.example/api/prices/current?symbols=AAPL', {
      signal: controller.signal,
    });
    const pending = fetchFinancialData(request);
    await Promise.resolve();
    expect(handlePersonalBrowserMarketRequest).toHaveBeenCalledTimes(1);
    controller.abort();
    finish(new Response('{}'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a pre-aborted Demo Snapshot request instead of delivering data', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('demo_snapshot');
    const controller = new AbortController();
    controller.abort();
    await expect(fetchFinancialData(
      '/api/prices/benchmark-history?benchmark=msci-world',
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin URL object before obtaining a Firebase token', async () => {
    await expect(fetchFinancialData(
      new URL('https://attacker.example/api/prices/current?symbols=DEMO'),
    )).rejects.toThrow('Untrusted financial-data request');

    expect(getFirebaseApiIdentity).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('attaches a token only when the authenticated workspace agrees', async () => {
    getFirebaseApiIdentity.mockResolvedValue({
      userId: 'firebase-user',
      token: 'firebase-token',
    });
    getActiveBrowserWorkspaceUserId.mockReturnValue('firebase-user');

    await fetchFinancialData('/api/financial-data/providers');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer firebase-token');
  });

  it('fails closed when authentication and workspace identity disagree', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue('firebase-user');

    await expect(fetchFinancialData('/api/financial-data/providers'))
      .rejects.toThrow('authentication state is inconsistent');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed while the browser workspace is unresolved', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(undefined);

    await expect(fetchFinancialData('/api/prices/current?symbols=DEMO'))
      .rejects.toThrow('workspace is not ready');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not let an isolated demo request fall through to a live API', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('demo_snapshot');

    const response = await fetchFinancialData(
      '/api/prices/benchmark-history?benchmark=msci-world',
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'unavailable',
      dataMode: 'demo_snapshot',
      synthetic: true,
      realtime: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps anonymous Local Workspace access to public financial APIs', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('local_workspace');

    await fetchFinancialData('/api/prices/current?symbols=AAPL');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('drops caller-provided legacy Authorization in anonymous Local Workspace', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('local_workspace');

    await fetchFinancialData('/api/prices/current?symbols=AAPL', {
      headers: { Authorization: 'Bearer stale-previous-user', 'X-Request-ID': 'fixture' },
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.get('X-Request-ID')).toBe('fixture');
  });

  it('rejects a late public-data response after anonymous Local Workspace switches to Demo', async () => {
    getFirebaseApiIdentity.mockResolvedValue(null);
    getActiveBrowserWorkspaceUserId.mockReturnValue(null);
    readAnonymousWorkspaceMode.mockReturnValue('local_workspace');
    let finish!: (response: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));

    const pending = fetchFinancialData('/api/prices/current?symbols=AAPL');
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    readAnonymousWorkspaceMode.mockReturnValue('demo_snapshot');
    finish(new Response(JSON.stringify({ prices: { AAPL: { price: 101 } } })));

    await expect(pending).rejects.toThrow('workspace changed during request');
  });

  it('fails closed when Firebase UID and active workspace UID disagree', async () => {
    getFirebaseApiIdentity.mockResolvedValue({
      userId: 'firebase-user-a',
      token: 'firebase-token',
    });
    getActiveBrowserWorkspaceUserId.mockReturnValue('firebase-user-b');

    await expect(fetchFinancialData('/api/prices/current?symbols=AAPL'))
      .rejects.toThrow('authentication state is inconsistent');
    expect(handlePersonalBrowserMarketRequest).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects old personal data that completes after a Firebase workspace switch', async () => {
    getFirebaseApiIdentity.mockResolvedValue({ userId: 'user-a', token: 'synthetic-token' });
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-a');
    let finishPersonal!: (value: Response | null) => void;
    handlePersonalBrowserMarketRequest.mockImplementationOnce(
      () => new Promise<Response | null>((resolve) => { finishPersonal = resolve; }),
    );

    const pending = fetchFinancialData('/api/prices/current?symbols=AAPL');
    await Promise.resolve();
    expect(handlePersonalBrowserMarketRequest).toHaveBeenCalledTimes(1);
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-b');
    finishPersonal(new Response(JSON.stringify({ prices: { AAPL: { price: 123 } } })));

    await expect(pending).rejects.toThrow('workspace changed during request');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('must not fall back to the server with the old token after personal fallback changes owner', async () => {
    getFirebaseApiIdentity.mockResolvedValue({ userId: 'user-a', token: 'synthetic-token' });
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-a');
    let finishPersonal!: (value: Response | null) => void;
    handlePersonalBrowserMarketRequest.mockImplementationOnce(
      () => new Promise<Response | null>((resolve) => { finishPersonal = resolve; }),
    );

    const pending = fetchFinancialData('/api/prices/current?symbols=AAPL');
    await Promise.resolve();
    expect(handlePersonalBrowserMarketRequest).toHaveBeenCalledTimes(1);
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-b');
    finishPersonal(null);

    await expect(pending).rejects.toThrow('workspace changed during request');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects late server responses when the authenticated workspace has changed', async () => {
    getFirebaseApiIdentity.mockResolvedValue({ userId: 'user-a', token: 'synthetic-token' });
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-a');
    let finishServer!: (value: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { finishServer = resolve; }));

    const pending = fetchFinancialData('/api/financial-data/providers');
    // Personal-adapter miss and Firebase identity each cross an async boundary.
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-b');
    finishServer(new Response(JSON.stringify({ providers: ['user-a'] })));

    await expect(pending).rejects.toThrow('workspace changed during request');
  });

  it('does not deliver a personal response after its caller aborts', async () => {
    getFirebaseApiIdentity.mockResolvedValue({ userId: 'user-a', token: 'synthetic-token' });
    getActiveBrowserWorkspaceUserId.mockReturnValue('user-a');
    let finishPersonal!: (value: Response | null) => void;
    handlePersonalBrowserMarketRequest.mockImplementationOnce(
      () => new Promise<Response | null>((resolve) => { finishPersonal = resolve; }),
    );
    const controller = new AbortController();
    const pending = fetchFinancialData('/api/prices/current?symbols=AAPL', { signal: controller.signal });
    await Promise.resolve();
    expect(handlePersonalBrowserMarketRequest).toHaveBeenCalledTimes(1);
    controller.abort();
    finishPersonal(new Response('{}'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps Firebase authorization away from direct personal-provider requests', async () => {
    getFirebaseApiIdentity.mockResolvedValue({
      userId: 'firebase-user',
      token: 'firebase-token',
    });
    getActiveBrowserWorkspaceUserId.mockReturnValue('firebase-user');
    const personalResponse = new Response('{}', { status: 200 });
    handlePersonalBrowserMarketRequest.mockResolvedValue(personalResponse);

    const response = await fetchFinancialData('/api/prices/current?symbols=AAPL');

    expect(response).toBe(personalResponse);
    expect(handlePersonalBrowserMarketRequest).toHaveBeenCalledWith(
      '/api/prices/current?symbols=AAPL',
      {},
      'firebase-user',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
