import { GET } from '@/app/api/financial-data/fx/history/route';
import { fetchEcbFxHistory } from '@/lib/financial-data/fx/ecb';

jest.mock('@/lib/financial-data/fx/ecb', () => ({
  fetchEcbFxHistory: jest.fn(),
}));

const mockedFetchEcbFxHistory = jest.mocked(fetchEcbFxHistory);
let sequence = 0;

function request(query: string): Request {
  sequence += 1;
  return new Request(`https://investatlas.example/api/financial-data/fx/history?${query}`, {
    headers: { 'x-vercel-forwarded-for': `203.0.113.${sequence}` },
  });
}

describe('bounded historical FX API for personal-provider conversion', () => {
  beforeEach(() => mockedFetchEcbFxHistory.mockReset());

  it('returns only sourced available ECB observations', async () => {
    mockedFetchEcbFxHistory.mockResolvedValue([
      {
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        rate: {
          status: 'available',
          value: 0.91,
          quality: 'reported',
          freshness: 'fresh',
          observedAt: null,
          asOf: '2026-08-27',
          provenance: {
            providerId: 'ecb_reference_rates',
            providerName: 'European Central Bank',
            retrievedAt: '2026-08-29T12:00:00.000Z',
          },
        },
      },
      {
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        rate: { status: 'unavailable', reason: 'provider_unavailable' },
      },
    ]);

    const response = await GET(request(
      'from=USD&to=EUR&startDate=2026-08-27&endDate=2026-08-28',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=86400, must-revalidate',
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'complete',
      data: [{ date: '2026-08-27', rate: 0.91, asOf: '2026-08-27' }],
      sourceAttribution: 'Source: ECB statistics.',
    });
    expect(mockedFetchEcbFxHistory).toHaveBeenCalledWith(
      'USD',
      'EUR',
      '2026-08-27',
      '2026-08-28',
      expect.any(Date),
      expect.any(AbortSignal),
    );
  });

  it.each([
    'from=USDT&to=EUR&startDate=2026-08-01&endDate=2026-08-02',
    'from=USD&to=EUR&startDate=2026-08-03&endDate=2026-08-02',
    'from=USD&to=EUR&startDate=2025-01-01&endDate=2026-08-02',
    'from=USD&to=EUR&startDate=bad&endDate=2026-08-02',
  ])('rejects unsafe or unsupported ranges before provider access: %s', async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockedFetchEcbFxHistory).not.toHaveBeenCalled();
  });

  it('fails closed when no historical reference rate is available', async () => {
    mockedFetchEcbFxHistory.mockResolvedValue([]);

    const response = await GET(request(
      'from=USD&to=EUR&startDate=2026-08-27&endDate=2026-08-28',
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('offers exact bounded windows for the native cache while preserving legacy carry rows by default', async () => {
    const make=(asOf:string)=>({baseCurrency:'USD',quoteCurrency:'EUR',rate:{status:'available',value:0.9,quality:'reported',freshness:'fresh',observedAt:null,asOf,provenance:{providerId:'ecb_reference_rates',providerName:'ECB',retrievedAt:null}}}) as const;
    mockedFetchEcbFxHistory.mockResolvedValue([make('2026-08-21'),make('2026-08-27')]);
    const query='from=USD&to=EUR&startDate=2026-08-27&endDate=2026-08-28';
    expect((await (await GET(request(query))).json()).data).toHaveLength(2);
    expect((await (await GET(request(query+'&exactWindow=true'))).json()).data).toEqual([{date:'2026-08-27',rate:0.9,asOf:'2026-08-27'}]);
  });
});
