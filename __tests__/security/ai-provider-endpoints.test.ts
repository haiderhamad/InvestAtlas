import {
  getSafeProviderEndpoint,
  testProvider,
  type ProviderConfig,
} from '@/lib/ai/provider-registry';

describe('AI provider endpoint policy', () => {
  it('uses fixed official endpoints instead of stored overrides', () => {
    const config = {
      type: 'openai',
      baseUrl: 'http://127.0.0.1:8080',
    } as Pick<ProviderConfig, 'type' | 'baseUrl'>;

    expect(getSafeProviderEndpoint(config)).toBe('https://api.openai.com/v1');
  });

  it('rejects arbitrary OpenAI-compatible endpoints in the public Demo', () => {
    expect(() =>
      getSafeProviderEndpoint({ type: 'openai-compatible' }),
    ).toThrow('Custom AI endpoints are disabled');
  });

  it('sends Gemini keys in a header instead of placing them in the URL', async () => {
    const apiKey = 'test-gemini-key-that-must-not-enter-a-url';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await testProvider({
        id: 'gemini-test',
        name: 'Gemini',
        type: 'gemini',
        apiKey,
        enabled: true,
        priority: 0,
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).not.toContain(apiKey);
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(apiKey);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
