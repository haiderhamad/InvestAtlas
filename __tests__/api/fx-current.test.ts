import { GET } from '@/app/api/financial-data/fx/route';
import { fetchEcbCurrentFx } from '@/lib/financial-data/fx/ecb';

jest.mock('@/lib/financial-data/fx/ecb', () => ({
  fetchEcbCurrentFx: jest.fn(),
}));

const mockedFetchEcbCurrentFx = jest.mocked(fetchEcbCurrentFx);
let requestSequence = 0;

function request(query: string): Request {
  requestSequence += 1;
  return new Request(`https://investatlas.example/api/financial-data/fx?${query}`, {
    headers: { 'x-vercel-forwarded-for': `198.51.100.${requestSequence}` },
  });
}

describe('current FX API', () => {
  beforeEach(() => {
    mockedFetchEcbCurrentFx.mockReset();
  });

  it('returns a sourced fresh reference rate with cache metadata', async () => {
    mockedFetchEcbCurrentFx.mockResolvedValue({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: {
        status: 'available',
        value: 1.15,
        quality: 'reported',
        freshness: 'fresh',
        observedAt: null,
        asOf: '2026-07-31',
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: '2026-07-31T16:00:00.000Z',
        },
      },
    });

    const response = await GET(request('from=eur&to=usd'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=300, must-revalidate',
    );
    expect(body).toEqual(expect.objectContaining({
      status: 'complete',
      data: expect.objectContaining({
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: expect.objectContaining({ value: 1.15 }),
      }),
      generatedAt: expect.any(String),
      sourceAttribution: 'Source: ECB statistics.',
    }));
    expect(mockedFetchEcbCurrentFx).toHaveBeenCalledWith('EUR', 'USD');
  });

  it('reports a usable but stale reference rate as partial', async () => {
    mockedFetchEcbCurrentFx.mockResolvedValue({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: {
        status: 'available',
        value: 1.14,
        quality: 'reported',
        freshness: 'stale',
        observedAt: null,
        asOf: '2026-07-25',
        provenance: {
          providerId: 'ecb_reference_rates',
          providerName: 'European Central Bank',
          retrievedAt: '2026-07-31T16:00:00.000Z',
        },
      },
    });

    const response = await GET(request('from=EUR&to=USD'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: 'partial',
    }));
  });

  it('fails closed when no current reference rate is available', async () => {
    mockedFetchEcbCurrentFx.mockResolvedValue({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: { status: 'unavailable', reason: 'provider_unavailable' },
    });

    const response = await GET(request('from=EUR&to=USD'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: 'unavailable',
      error: 'Current FX reference data is temporarily unavailable',
      reason: 'provider_unavailable',
    });
  });

  it.each([
    'from=USDT&to=EUR',
    'from=EUR&to=GBP',
    'from=&to=USD',
  ])('rejects unsupported currencies before calling a provider: %s', async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(mockedFetchEcbCurrentFx).not.toHaveBeenCalled();
  });
});
