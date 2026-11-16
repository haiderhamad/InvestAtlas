import {
  addProvider,
  getProvider,
  requireFirebaseUser,
  updateProvider,
} from '@/lib/ai/provider-store';
import { testProvider } from '@/lib/ai/provider-registry';
import {
  POST as createProvider,
  PUT as updateProviderRoute,
} from '@/app/api/ai/providers/route';
import { POST as testProviderRoute } from '@/app/api/ai/test/route';

jest.mock('@/lib/ai/provider-store', () => ({
  ...jest.requireActual('@/lib/ai/provider-store'),
  addProvider: jest.fn(),
  getProvider: jest.fn(),
  requireFirebaseUser: jest.fn(),
  updateProvider: jest.fn(),
}));

jest.mock('@/lib/ai/provider-registry', () => ({
  ...jest.requireActual('@/lib/ai/provider-registry'),
  testProvider: jest.fn(),
}));

const mockedAddProvider = jest.mocked(addProvider);
const mockedGetProvider = jest.mocked(getProvider);
const mockedRequireUser = jest.mocked(requireFirebaseUser);
const mockedTestProvider = jest.mocked(testProvider);
const mockedUpdateProvider = jest.mocked(updateProvider);

function request(path: string, method: 'POST' | 'PUT', body: unknown, ip: string) {
  return new Request(`https://investatlas.example${path}`, {
    method,
    headers: {
      Authorization: 'Bearer valid-length-test-firebase-token',
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('AI provider route boundary', () => {
  beforeEach(() => {
    mockedAddProvider.mockReset();
    mockedGetProvider.mockReset();
    mockedRequireUser.mockReset().mockResolvedValue({
      uid: 'owner-user',
      token: 'verified-token',
    });
    mockedTestProvider.mockReset();
    mockedUpdateProvider.mockReset();
  });

  it('never returns a legacy endpoint or full key after updating a provider', async () => {
    mockedUpdateProvider.mockResolvedValueOnce({
      id: 'provider-1',
      name: 'Personal OpenAI',
      type: 'openai',
      apiKey: 'secret-key-that-must-not-leak',
      baseUrl: 'http://127.0.0.1:8080/v1?token=must-not-leak',
      enabled: true,
      priority: 0,
    });

    const response = await updateProviderRoute(request(
      '/api/ai/providers',
      'PUT',
      { id: 'provider-1', name: 'Personal OpenAI' },
      '203.0.113.221',
    ));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).not.toContain('secret-key-that-must-not-leak');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('baseUrl');
  });

  it.each([
    { type: 'openai-compatible', apiKey: 'secret-key' },
    { type: 'openai', apiKey: 'secret-key', baseUrl: 'http://127.0.0.1:8080/v1' },
  ])('rejects custom endpoint input before storage', async (body) => {
    const response = await createProvider(request(
      '/api/ai/providers',
      'POST',
      { name: 'Custom', ...body },
      body.type === 'openai' ? '203.0.113.222' : '203.0.113.223',
    ));

    expect(response.status).toBe(400);
    expect(mockedAddProvider).not.toHaveBeenCalled();
  });

  it('rejects an ad-hoc custom endpoint before provider network code runs', async () => {
    const response = await testProviderRoute(request(
      '/api/ai/test',
      'POST',
      {
        type: 'openai',
        apiKey: 'secret-key',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
      },
      '203.0.113.224',
    ));

    expect(response.status).toBe(400);
    expect(mockedGetProvider).not.toHaveBeenCalled();
    expect(mockedTestProvider).not.toHaveBeenCalled();
  });
});
