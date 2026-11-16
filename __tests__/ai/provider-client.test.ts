import {
  buildProviderMutationPayload,
  requireSuccessfulProviderResponse,
} from '@/lib/ai/provider-client';

describe('AI provider client boundary', () => {
  it('only sends supported fixed-host fields and omits injected endpoints', () => {
    const payload = buildProviderMutationPayload({
      name: 'Primary',
      type: 'openai',
      apiKey: 'secret',
      model: 'gpt-test',
      enabled: true,
      baseUrl: 'http://127.0.0.1:8080',
      detectedModels: ['unexpected'],
    } as never);

    expect(payload).toEqual({
      name: 'Primary',
      type: 'openai',
      apiKey: 'secret',
      model: 'gpt-test',
      enabled: true,
    });
    expect(payload).not.toHaveProperty('baseUrl');
    expect(payload).not.toHaveProperty('detectedModels');
  });

  it('omits a blank key when updating an existing provider', () => {
    expect(
      buildProviderMutationPayload(
        { name: 'Primary', apiKey: '' },
        { id: 'provider-1', omitEmptyApiKey: true },
      ),
    ).toEqual({
      id: 'provider-1',
      name: 'Primary',
    });
  });

  it('rejects non-success responses using the server error when available', async () => {
    const response = new Response(
      JSON.stringify({ error: 'Vault temporarily unavailable' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    await expect(
      requireSuccessfulProviderResponse(response, 'Mutation failed'),
    ).rejects.toThrow('Vault temporarily unavailable');
  });

  it('accepts successful responses without consuming the body', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });

    await expect(
      requireSuccessfulProviderResponse(response, 'Mutation failed'),
    ).resolves.toBeUndefined();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
