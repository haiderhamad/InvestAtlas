import {
  ProviderStoreAuthError,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import {
  deleteFinancialCredential,
  listFinancialCredentials,
  upsertFinancialCredential,
} from '@/lib/financial-data/providers/credential-store';
import { testTiingoCredential } from '@/lib/financial-data/providers/tiingo';
import {
  DELETE,
  GET,
  POST,
} from '@/app/api/financial-data/providers/route';
import { POST as TEST_PROVIDER } from '@/app/api/financial-data/providers/test/route';

jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'),
  requireFirebaseUser: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/credential-store', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/credential-store'),
  deleteFinancialCredential: jest.fn(),
  listFinancialCredentials: jest.fn(),
  upsertFinancialCredential: jest.fn(),
}));
jest.mock('@/lib/financial-data/providers/tiingo', () => ({
  ...jest.requireActual('@/lib/financial-data/providers/tiingo'),
  testTiingoCredential: jest.fn(),
}));

const mockedRequireUser = jest.mocked(requireFirebaseUser);
const mockedDelete = jest.mocked(deleteFinancialCredential);
const mockedList = jest.mocked(listFinancialCredentials);
const mockedUpsert = jest.mocked(upsertFinancialCredential);
const mockedTestTiingo = jest.mocked(testTiingoCredential);
const user = { uid: 'owner-user', token: 'verified-token' };
const originalVercelEnvironment = process.env.VERCEL_ENV;

function request(
  method: string,
  body?: unknown,
  ip = '203.0.113.201',
) {
  return new Request('https://investatlas.example/api/financial-data/providers', {
    method,
    headers: {
      Authorization: 'Bearer valid-length-test-firebase-token',
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': ip,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('financial provider endpoint security', () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    mockedRequireUser.mockReset().mockResolvedValue(user);
    mockedDelete.mockReset().mockResolvedValue(true);
    mockedList.mockReset().mockResolvedValue([]);
    mockedUpsert.mockReset();
    mockedTestTiingo.mockReset();
  });

  afterAll(() => {
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnvironment;
    }
  });

  it('authenticates before reading any provider metadata', async () => {
    mockedRequireUser.mockRejectedValueOnce(new ProviderStoreAuthError());

    const response = await GET(request('GET', undefined, '203.0.113.202'));

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('returns only masked metadata after testing and storing a new key', async () => {
    const apiKey = 'valid_tiingo_key_123456789';
    mockedTestTiingo.mockResolvedValueOnce({
      status: 'connected',
      capabilities: ['quote', 'history'],
      checkedAt: '2026-08-09T10:00:00.000Z',
    });
    mockedUpsert.mockResolvedValueOnce({
      id: 'tiingo',
      enabled: true,
      priority: 0,
      status: 'connected',
      detectedCapabilities: ['quote', 'history'],
      lastValidatedAt: '2026-08-09T10:00:00.000Z',
      maskedKey: '••••6789',
      credentialRevision: 1,
    });

    const response = await POST(request('POST', {
      providerId: 'tiingo',
      apiKey,
      confirmedPersonalUse: true,
    }, '203.0.113.203'));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(serialized).not.toContain(apiKey);
    expect(mockedTestTiingo).toHaveBeenCalledWith(
      apiKey,
      'owner-user:tiingo:pending',
      expect.any(AbortSignal),
    );
    expect(mockedUpsert).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ apiKey, id: 'tiingo' }),
    );
  });

  it('rejects invalid provider IDs without mutating storage', async () => {
    const response = await DELETE(new Request(
      'https://investatlas.example/api/financial-data/providers?id=../tiingo',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer valid-length-test-firebase-token',
          'x-vercel-forwarded-for': '203.0.113.204',
        },
      },
    ));

    expect(response.status).toBe(400);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it.each(['preview', 'production'])('keeps Tiingo connect and test disabled on Vercel %s', async (environment) => {
    process.env.VERCEL_ENV = environment;
    const connect = await POST(request('POST', {
      providerId: 'tiingo',
      apiKey: 'valid_tiingo_key_123456789',
      confirmedPersonalUse: true,
    }, environment === 'preview' ? '203.0.113.206' : '203.0.113.207'));
    const test = await TEST_PROVIDER(request(
      'POST',
      undefined,
      environment === 'preview' ? '203.0.113.208' : '203.0.113.209',
    ));

    expect(connect.status).toBe(403);
    expect(test.status).toBe(403);
    expect(connect.headers.get('Cache-Control')).toContain('private');
    expect(test.headers.get('Cache-Control')).toContain('private');
    expect(mockedTestTiingo).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('bounds unauthenticated token-verification attempts before identity lookup', async () => {
    mockedRequireUser.mockRejectedValue(new ProviderStoreAuthError());
    const responses = [];
    for (let index = 0; index < 61; index += 1) {
      responses.push(await GET(request('GET', undefined, '203.0.113.205')));
    }

    expect(responses.slice(0, 60).every((response) => response.status === 401))
      .toBe(true);
    expect(responses[60].status).toBe(429);
    expect(mockedRequireUser).toHaveBeenCalledTimes(60);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
