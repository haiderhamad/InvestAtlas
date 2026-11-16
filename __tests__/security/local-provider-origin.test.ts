import { isAuthorizedLocalProviderRequest } from '@/lib/runtime/local-provider-request';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'local_personal',
}));

function req(url: string, host: string, origin: string, site?: string) {
  return new Request(url, {
    headers: {
      Host: host,
      Origin: origin,
      ...(site ? { 'Sec-Fetch-Site': site } : {}),
    },
  });
}

describe('Loopback provider origin normalization', () => {
  const oldVercel = process.env.VERCEL;
  beforeEach(() => { delete process.env.VERCEL; });
  afterAll(() => {
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
  });

  it('accepts exact-loopback Origin and Host in a browser request', () => {
    expect(isAuthorizedLocalProviderRequest(req(
      'http://127.0.0.1:3000/api/local/ai/test',
      '127.0.0.1:3000', 'http://127.0.0.1:3000', 'same-origin',
    ))).toBe(true);
  });
  it('accepts documented Next.js localhost internal normalization of loopback', () => {
    expect(isAuthorizedLocalProviderRequest(req(
      'http://localhost:3000/api/local/tiingo/series',
      '127.0.0.1:3000', 'http://127.0.0.1:3000', 'same-origin',
    ))).toBe(true);
  });
  it.each([
    ['http://localhost:3000/a', 'attacker.example:3000', 'http://attacker.example:3000', undefined],
    ['http://localhost:3000/a', '127.0.0.1:3000', 'https://attacker.example', undefined],
    ['http://localhost:3000/a', 'localhost:3001', 'http://localhost:3001', undefined],
    ['http://localhost:3000/a', 'localhost:3000', 'http://localhost:3000', 'cross-site'],
    ['http://0.0.0.0:3000/a', '127.0.0.1:3000', 'http://127.0.0.1:3000', undefined],
    ['https://localhost:3000/a', 'localhost:3000', 'https://localhost:3000', undefined],
    ['http://localhost:3000/a', 'localhost:3000', 'http://localhost:3000/', undefined],
  ])('denies remote, port, protocol, or cross-site ambiguity', (url, host, origin, site) => {
    expect(isAuthorizedLocalProviderRequest(req(url!, host!, origin!, site))).toBe(false);
  });
  it('denies even loopback requests in the Vercel runtime', () => {
    process.env.VERCEL = '1';
    expect(isAuthorizedLocalProviderRequest(req(
      'http://localhost:3000/a', 'localhost:3000', 'http://localhost:3000',
    ))).toBe(false);
  });
});
