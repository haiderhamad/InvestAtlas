import { GET as getCurrent } from '@/app/api/prices/current/route';
import { GET as getHistory } from '@/app/api/prices/history/route';
import {
  getFirebaseUserFromToken,
  getOptionalFirebaseAuthToken,
  ProviderStoreAuthError,
} from '@/lib/ai/provider-store';
import { buildConsolidatedHistory } from '@/lib/data/historical-engine';
import { getCurrentQuotes } from '@/lib/financial-data/quotes/current-quote-service';
import {
  getPersonalCurrentQuotes,
  getPersonalHistory,
} from '@/lib/financial-data/providers/personal-market-data';

jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'),
  getFirebaseUserFromToken: jest.fn(),
  getOptionalFirebaseAuthToken: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/personal-market-data', () => ({
  getPersonalCurrentQuotes: jest.fn(),
  getPersonalHistory: jest.fn(),
}));
jest.mock('@/lib/financial-data/quotes/current-quote-service', () => ({
  getCurrentQuotes: jest.fn(),
}));
jest.mock('@/lib/data/historical-engine', () => ({
  buildConsolidatedHistory: jest.fn(),
}));

const mockedToken = jest.mocked(getOptionalFirebaseAuthToken);
const mockedUser = jest.mocked(getFirebaseUserFromToken);
const mockedPersonalCurrent = jest.mocked(getPersonalCurrentQuotes);
const mockedPublicCurrent = jest.mocked(getCurrentQuotes);
const mockedPersonalHistory = jest.mocked(getPersonalHistory);
const mockedPublicHistory = jest.mocked(buildConsolidatedHistory);
const user = { uid: 'owner-user', token: 'verified-token' };
const originalVercelEnvironment = process.env.VERCEL_ENV;

describe('authenticated personal market-data route boundary', () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    mockedToken.mockReset().mockReturnValue('valid-length-firebase-token');
    mockedUser.mockReset().mockResolvedValue(user);
    mockedPersonalCurrent.mockReset();
    mockedPublicCurrent.mockReset();
    mockedPersonalHistory.mockReset();
    mockedPublicHistory.mockReset();
  });

  afterAll(() => {
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnvironment;
    }
  });

  it('uses only the owner-scoped quote path and marks its response private', async () => {
    mockedPersonalCurrent.mockResolvedValueOnce({
      status: 'unavailable',
      prices: {},
      issues: [{ symbol: 'AAPL', code: 'provider_unavailable' }],
      verificationLogs: [],
    });

    const response = await getCurrent(new Request(
      'https://investatlas.example/api/prices/current?symbols=AAPL&currency=usd',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.211' } },
    ));
    const body = await response.json();

    expect(mockedPersonalCurrent).toHaveBeenCalledWith(
      user,
      ['AAPL'],
      'usd',
      expect.any(AbortSignal),
    );
    expect(mockedPublicCurrent).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(body.dataMode).toBe('personal_provider');
    expect(body.synthetic).toBe(false);
  });

  it('uses only the owner-scoped history path and marks its response private', async () => {
    mockedPersonalHistory.mockResolvedValueOnce(null);

    const response = await getHistory(new Request(
      'https://investatlas.example/api/prices/history?symbol=AAPL&currency=usd&interval=1d',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.212' } },
    ));
    const body = await response.json();

    expect(mockedPersonalHistory).toHaveBeenCalledWith(
      user,
      'AAPL',
      'usd',
      expect.any(AbortSignal),
    );
    expect(mockedPublicHistory).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(body.dataMode).toBe('personal_provider');
    expect(body.status).toBe('unavailable');
  });

  it('never falls back to public data when Firebase authentication fails', async () => {
    mockedUser.mockRejectedValue(new ProviderStoreAuthError());

    const current = await getCurrent(new Request(
      'https://investatlas.example/api/prices/current?symbols=AAPL',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.213' } },
    ));
    const history = await getHistory(new Request(
      'https://investatlas.example/api/prices/history?symbol=AAPL',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.214' } },
    ));

    expect(current.status).toBe(401);
    expect(history.status).toBe(401);
    expect(current.headers.get('Cache-Control')).toBe('no-store');
    expect(history.headers.get('Cache-Control')).toBe('no-store');
    expect(mockedPersonalCurrent).not.toHaveBeenCalled();
    expect(mockedPublicCurrent).not.toHaveBeenCalled();
    expect(mockedPersonalHistory).not.toHaveBeenCalled();
    expect(mockedPublicHistory).not.toHaveBeenCalled();
  });

  it.each(['preview', 'production'])('fails personal market routes closed on Vercel %s', async (environment) => {
    process.env.VERCEL_ENV = environment;

    const current = await getCurrent(new Request(
      'https://investatlas.example/api/prices/current?symbols=AAPL&currency=usd',
      { headers: { 'x-vercel-forwarded-for': environment === 'preview' ? '203.0.113.215' : '203.0.113.216' } },
    ));
    const history = await getHistory(new Request(
      'https://investatlas.example/api/prices/history?symbol=AAPL&currency=usd&interval=1d',
      { headers: { 'x-vercel-forwarded-for': environment === 'preview' ? '203.0.113.217' : '203.0.113.218' } },
    ));
    const currentBody = await current.json();
    const historyBody = await history.json();

    expect(current.status).toBe(200);
    expect(currentBody).toEqual(expect.objectContaining({
      status: 'unavailable',
      dataMode: 'personal_provider',
      synthetic: false,
    }));
    expect(history.status).toBe(200);
    expect(historyBody).toEqual(expect.objectContaining({
      contractVersion: 'history.v2',
      status: 'unavailable',
      dataMode: 'personal_provider',
      synthetic: false,
    }));
    expect(current.headers.get('Cache-Control')).toContain('private');
    expect(history.headers.get('Cache-Control')).toContain('private');
    expect(mockedPersonalCurrent).not.toHaveBeenCalled();
    expect(mockedPersonalHistory).not.toHaveBeenCalled();
    expect(mockedPublicCurrent).not.toHaveBeenCalled();
    expect(mockedPublicHistory).not.toHaveBeenCalled();
  });

  it('rejects a mixed supported and unsupported personal quote request', async () => {
    const response = await getCurrent(new Request(
      'https://investatlas.example/api/prices/current?symbols=AAPL,UNSUPPORTED&currency=usd',
      { headers: { 'x-vercel-forwarded-for': '203.0.113.219' } },
    ));

    expect(response.status).toBe(400);
    expect(mockedPersonalCurrent).not.toHaveBeenCalled();
    expect(mockedPublicCurrent).not.toHaveBeenCalled();
  });
});
