/** @jest-environment jsdom */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { proxy, config } from '@/proxy';
import {
  readAnonymousWorkspaceMode,
  writeAnonymousWorkspaceMode,
  ANONYMOUS_WORKSPACE_MODE_KEY,
} from '@/lib/demo/workspace-mode';

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
  INVESTATLAS_DEPLOYMENT_MODE: 'public_demo',
  isValidPrivateOwnerUid: () => false,
}));

function request(pathname: string, bearer = false) {
  return {
    nextUrl: { pathname },
    headers: {
      has: (name: string) => name.toLowerCase() === 'authorization' && bearer,
      get: (name: string) => name.toLowerCase() === 'authorization' && bearer ? 'Bearer fake-token' : null,
    },
  } as Parameters<typeof proxy>[0];
}

function discoverApiRoutes(directory: string, segments: string[] = []): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return discoverApiRoutes(join(directory, entry.name), [...segments, entry.name]);
    }
    if (entry.isFile() && /^route\.(ts|tsx)$/.test(entry.name)) {
      return ['/api/' + segments.map((segment) =>
        segment.startsWith('[') ? 'synthetic-id' : segment).join('/')];
    }
    return [];
  });
}

describe('Operator-hosted public_demo isolation (Option A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('forces the read-only snapshot even when an old visitor profile selected local workspace', () => {
    window.localStorage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace');
    window.localStorage.setItem('investatlas.manual-transactions', '[{"id":"pre-existing"}]');

    expect(readAnonymousWorkspaceMode()).toBe('demo_snapshot');
    writeAnonymousWorkspaceMode('local_workspace');

    expect(readAnonymousWorkspaceMode()).toBe('demo_snapshot');
    expect(window.localStorage.getItem(ANONYMOUS_WORKSPACE_MODE_KEY)).toBe('local_workspace');
    expect(window.localStorage.getItem('investatlas.manual-transactions')).toBe('[{"id":"pre-existing"}]');
  });

  it.each([
    '/api/ai',
    '/api/ai/providers',
    '/api/account/delete',
    '/api/transactions/import',
    '/api/financial-data/providers',
    '/api/financial-data/tiingo/local-series',
    '/api/local/ai/test',
    '/api/local/tiingo/series',
    '/api/prices/current',
    '/api/prices/history',
    '/api/financial-data/fx',
    '/api/data-providers',
  ])('does not expose server API %s on the operator demo', async pathname => {
    const blocked = await proxy(request(pathname));
    expect(blocked).toMatchObject({
      status: 403,
      body: { error: 'Unavailable for this installation' },
    });
    expect(nextMock).not.toHaveBeenCalled();
  });

  it('has a blanket API matcher rather than a fragile endpoint allowlist', () => {
    expect(config.matcher).toBe('/api/:path*');
  });

  it('denies every current file-system API route, including any new feature endpoints', async () => {
    const routes = discoverApiRoutes(join(process.cwd(), 'src', 'app', 'api'));
    expect(routes.length).toBeGreaterThan(20);
    for (const pathname of routes) {
      const response = await proxy(request(pathname));
      expect(response).toMatchObject({ status: 403 });
    }
    expect(nextMock).not.toHaveBeenCalled();
  });

  it('denies personal bearer requests before any Firebase verification', async () => {
    const oldFetch = global.fetch;
    global.fetch = jest.fn() as typeof fetch;
    try {
      expect(await proxy(request('/api/prices/current', true))).toMatchObject({ status: 403 });
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = oldFetch;
    }
  });
});
