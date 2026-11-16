import { ProviderResponseTooLargeError } from '@/lib/api/bounded-response';
import { callProvider, type ProviderConfig } from '@/lib/ai/provider-registry';

describe('AI provider registry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes trust instructions to Gemini as a system instruction', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      }), { status: 200 }),
    );
    const config: ProviderConfig = {
      id: 'test',
      name: 'Gemini',
      type: 'gemini',
      apiKey: 'test-key',
      enabled: true,
      priority: 1,
      model: 'gemini-test',
    };

    await callProvider(config, 'User prompt', 'Do not invent financial data.');

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(request?.body));
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'Do not invent financial data.' }],
    });
    expect(body.contents).toEqual([
      { parts: [{ text: 'User prompt' }] },
    ]);
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an oversized provider response before parsing it', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(300 * 1024) },
      }),
    );
    const config: ProviderConfig = {
      id: 'test-openai',
      name: 'OpenAI',
      type: 'openai',
      apiKey: 'test-key',
      enabled: true,
      priority: 1,
      model: 'test-model',
    };

    await expect(
      callProvider(config, 'User prompt', 'System prompt'),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });
});
