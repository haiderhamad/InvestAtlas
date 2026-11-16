import {
  callProviderWithFile,
  isSupportedAttachmentMime,
} from '@/lib/ai/file-analyzer';
import {
  getActiveProviders,
  requireFirebaseUser,
} from '@/lib/ai/provider-store';
import type { ProviderConfig } from '@/lib/ai/provider-registry';
import { POST } from '@/app/api/transactions/import/route';

jest.mock('@/lib/ai/file-analyzer', () => ({
  callProviderWithFile: jest.fn(),
  isSupportedAttachmentMime: jest.fn(),
}));

jest.mock('@/lib/ai/provider-store', () => {
  class ProviderStoreAuthError extends Error {
    status = 401;
  }

  return {
    ProviderStoreAuthError,
    getActiveProviders: jest.fn(),
    requireFirebaseUser: jest.fn(),
  };
});

const mockedCallProviderWithFile = jest.mocked(callProviderWithFile);
const mockedIsSupportedAttachmentMime = jest.mocked(isSupportedAttachmentMime);
const mockedGetActiveProviders = jest.mocked(getActiveProviders);
const mockedRequireFirebaseUser = jest.mocked(requireFirebaseUser);

function provider(id: string, priority: number): ProviderConfig {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai',
    apiKey: `test-key-${id}`,
    model: 'test-model',
    enabled: true,
    priority,
  };
}

function importRequest(sequence: number): Request {
  const form = new FormData();
  form.append(
    'file',
    new Blob(['bounded statement fixture'], { type: 'application/pdf' }),
    'statement.pdf',
  );

  return new Request('https://investatlas.example/api/transactions/import', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'x-vercel-forwarded-for': `203.0.113.${sequence}`,
    },
    body: form,
  });
}

describe('transaction import provider privacy boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireFirebaseUser.mockResolvedValue({
      uid: `transaction-import-user-${Date.now()}`,
      token: 'verified-token',
    });
    mockedIsSupportedAttachmentMime.mockReturnValue(true);
  });

  it('never forwards one uploaded statement to a fallback provider', async () => {
    const first = provider('first', 0);
    const second = provider('second', 1);
    mockedGetActiveProviders.mockResolvedValue([first, second]);
    mockedCallProviderWithFile.mockRejectedValueOnce(
      new Error('first provider failed'),
    );

    const response = await POST(importRequest(71));
    const responseBody = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(mockedCallProviderWithFile).toHaveBeenCalledTimes(1);
    expect(mockedCallProviderWithFile).toHaveBeenCalledWith(
      first,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ mimeType: 'application/pdf' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(responseBody).toBe('{"error":"AI provider failed","attempts":1}');
    expect(responseBody).not.toContain(first.name);
    expect(responseBody).not.toContain(second.name);
  });
});
