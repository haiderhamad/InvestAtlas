import { POST as testAI } from '@/app/api/local/ai/test/route';
import { POST as importAI } from '@/app/api/local/transactions/import/route';
import { testProvider } from '@/lib/ai/provider-registry';
import { callProviderWithFile } from '@/lib/ai/file-analyzer';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import {
  clearLocalAIConfig, getLocalAIConfig, setLocalAIConfig,
} from '@/lib/ai/local-browser-provider';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'local_personal',
}));
jest.mock('@/lib/ai/provider-registry', () => ({
  testProvider: jest.fn(),
}));
jest.mock('@/lib/ai/file-analyzer', () => ({
  isSupportedAttachmentMime: (mime: string) => mime === 'image/png' || mime === 'application/pdf',
  callProviderWithFile: jest.fn(),
}));
jest.mock('@/lib/api/rate-limit', () => ({
  enforceRateLimit: jest.fn(() => null),
}));

const providerTest = jest.mocked(testProvider);
const fileCall = jest.mocked(callProviderWithFile);
const limit = jest.mocked(enforceRateLimit);
const base = 'http://127.0.0.1:3187';
const baseHeaders = {
  Host: '127.0.0.1:3187',
  Origin: base,
  'Sec-Fetch-Site': 'same-origin',
};
const config = { type: 'openai' as const, apiKey: 'SYNTHETIC_LOCAL_ONLY', model: 'gpt-test' };

function testRequest(extraHeaders: Record<string, string> = {}, body: unknown = config) {
  return new Request(base + '/api/local/ai/test', {
    method: 'POST', headers: {
      ...baseHeaders, 'Content-Type': 'application/json', ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}
function importRequest(extraHeaders: Record<string, string> = {}, provider: unknown = config, mime = 'image/png') {
  const form = new FormData();
  form.append('file', new File(['fake image binary'], 'test.png', { type: mime }));
  form.append('provider', JSON.stringify(provider));
  return new Request(base + '/api/local/transactions/import', {
    method: 'POST', headers: { ...baseHeaders, ...extraHeaders },
    body: form,
  });
}

describe('Local Personal AI BYOK isolated routes', () => {
  const oldVercel = process.env.VERCEL;
  beforeEach(() => {
    delete process.env.VERCEL;
    providerTest.mockReset().mockResolvedValue({
      status: 'ok', type: 'openai', provider: 'OpenAI',
      models: ['gpt-test'], latencyMs: 5, message: 'Connected',
    });
    fileCall.mockReset().mockResolvedValue({
      response: JSON.stringify({
        transactions: [{
          date: '2026-10-27T12:00:00Z',
          venue: 'manual-broker',
          type: 'buy',
          asset: 'AAPL',
          assetClass: 'stock',
          quote: 'USD',
          amount: 2, price: 100, total: 200, fee: 0,
        }],
        warnings: [],
      }),
      latencyMs: 5, model: 'gpt-test',
    });
    limit.mockReset().mockReturnValue(null);
    clearLocalAIConfig();
  });

  afterAll(() => {
    clearLocalAIConfig();
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
  });

  it('keeps the AI key in tab memory and allows explicit clearance', () => {
    expect(getLocalAIConfig()).toBeNull();
    setLocalAIConfig(config);
    expect(getLocalAIConfig()).toEqual(config);
    clearLocalAIConfig();
    expect(getLocalAIConfig()).toBeNull();
  });

  it('tests fixed, selected provider without persisting a key', async () => {
    const response = await testAI(testRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.status).toBe('ok');
    expect(JSON.stringify(payload)).not.toContain(config.apiKey);
    expect(providerTest).toHaveBeenCalledWith(expect.objectContaining({
      type: 'openai', apiKey: config.apiKey, model: 'gpt-test',
    }));
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it.each([
    [{ Origin: 'https://attacker.example' }, 403],
    [{ Host: 'attacker.example' }, 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
    [{ Origin: '' }, 403],
  ])('rejects untrusted origin or host for key testing', async (headers, status) => {
    const response = await testAI(testRequest(headers));
    expect(response.status).toBe(status);
    expect(providerTest).not.toHaveBeenCalled();
  });

  it('rejects custom URL, unsupported provider and newline-bearing key', async () => {
    for (const invalid of [
      { ...config, baseUrl: 'https://evil.example' },
      { ...config, type: 'openai-compatible' },
      { ...config, apiKey: 'key\nmalformed' },
    ]) {
      const res = await testAI(testRequest({}, invalid));
      expect(res.status).toBe(400);
    }
    expect(providerTest).not.toHaveBeenCalled();
  });

  it('refuses requests even on localhost when process is Vercel-hosted', async () => {
    process.env.VERCEL = '1';
    expect((await testAI(testRequest())).status).toBe(403);
    expect((await importAI(importRequest())).status).toBe(403);
    expect(providerTest).not.toHaveBeenCalled();
    expect(fileCall).not.toHaveBeenCalled();
  });

  it('imports only validated suggestions for explicit human review, never writes transactions', async () => {
    const response = await importAI(importRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.transactions).toEqual([
      expect.objectContaining({
        asset: 'AAPL', type: 'buy', amount: 2, total: 200, quote: 'USD',
      }),
    ]);
    expect(payload.provider).toBe('openai');
    expect(JSON.stringify(payload)).not.toContain(config.apiKey);
    expect(fileCall).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: config.apiKey, type: 'openai' }),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ mimeType: 'image/png' }),
      expect.any(Object),
    );
  });

  it.each([
    [{ Origin: 'https://attacker.example' }, 403],
    [{ Host: 'attacker.example' }, 403],
  ])('rejects local import requests from forged origins', async (headers, status) => {
    expect((await importAI(importRequest(headers))).status).toBe(status);
    expect(fileCall).not.toHaveBeenCalled();
  });

  it('rejects invalid import file type and refuses arbitrary AI endpoints', async () => {
    expect((await importAI(importRequest({}, config, 'text/plain'))).status).toBe(400);
    expect((await importAI(importRequest({}, { ...config, baseUrl: 'https://evil.example' }))).status).toBe(400);
    expect(fileCall).not.toHaveBeenCalled();
  });

  it('fails closed when provider response has no trustworthy transactions', async () => {
    fileCall.mockResolvedValueOnce({ response: 'not JSON', latencyMs: 1, model: 'gpt-test' });
    const response = await importAI(importRequest());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(config.apiKey);
  });
});
