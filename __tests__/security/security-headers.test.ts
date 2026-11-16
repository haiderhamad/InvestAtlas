import type nextConfigType from '../../next.config';

type DeploymentMode = 'legacy' | 'public_demo' | 'private_cloud' | 'local_personal';

function loadModeConfig(mode: DeploymentMode = 'legacy'): typeof nextConfigType {
  const previous = process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE;
  try {
    process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE = mode;
    let config: typeof nextConfigType | undefined;
    jest.isolateModules(() => {
      config = require('../../next.config').default as typeof nextConfigType;
    });
    if (!config) throw new Error('Deployment-specific Next.js config was not loaded.');
    return config;
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE;
    else process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE = previous;
  }
}

async function readGlobalHeaders(mode: DeploymentMode = 'legacy'): Promise<Map<string, string>> {
  const rules = await loadModeConfig(mode).headers?.();
  const globalRule = rules?.find((rule) => rule.source === '/:path*');

  if (!globalRule) {
    throw new Error('Global response headers are not configured.');
  }

  return new Map(
    globalRule.headers.map((header) => [header.key, header.value]),
  );
}

describe('Next.js browser security headers', () => {
  it('removes the default framework disclosure header', () => {
    expect(loadModeConfig().poweredByHeader).toBe(false);
  });

  it('ships an enforced CSP baseline', async () => {
    const headers = await readGlobalHeaders();
    const policy = headers.get('Content-Security-Policy');

    expect(policy).toBeDefined();
    expect(headers.has('Content-Security-Policy-Report-Only')).toBe(false);
    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('covers Firebase Auth, Firestore, Google fonts/icons, and the PWA worker', async () => {
    const policy = (await readGlobalHeaders()).get('Content-Security-Policy');

    expect(policy).toContain('https://apis.google.com');
    expect(policy).toContain('https://*.googleapis.com');
    expect(policy).toContain('https://*.firebaseio.com');
    expect(policy).toContain('wss://*.firebaseio.com');
    expect(policy).toContain('https://*.firebaseapp.com');
    expect(policy).toContain('https://accounts.google.com');
    expect(policy).toContain('https://fonts.googleapis.com');
    expect(policy).toContain('https://fonts.gstatic.com');
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("manifest-src 'self'");
    expect(policy).toContain('https://api.tiingo.com');
    expect(policy).not.toContain('https://www.alphavantage.co');
    expect(policy).not.toContain('https://*.tiingo.com');
  });

  it('restricts external connections, scripts and frames in the operator public Demo', async () => {
    const policy = (await readGlobalHeaders('public_demo')).get('Content-Security-Policy');
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("child-src 'self' blob:");
    for (const url of [
      'https://api.tiingo.com',
      'https://api.gold-api.com',
      'https://api.coinpaprika.com',
      'https://api.coingecko.com',
      'https://*.googleapis.com',
      'wss://*.firebaseio.com',
      'https://accounts.google.com',
      'https://apis.google.com',
    ]) expect(policy).not.toContain(url);
  });

  it.each(['local_personal', 'private_cloud'] as const)('allows the exact optional crypto backup origin only in %s', async mode => {
    const policy = (await readGlobalHeaders(mode)).get('Content-Security-Policy');
    expect(policy).toContain('https://api.coingecko.com');
    expect(policy).not.toContain('https://*.coingecko.com');
    expect((await readGlobalHeaders('legacy')).get('Content-Security-Policy')).not.toContain('https://api.coingecko.com');
  });

  it('retains the established defense-in-depth headers', async () => {
    const headers = await readGlobalHeaders();

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe(
      'same-origin-allow-popups',
    );
  });
});
