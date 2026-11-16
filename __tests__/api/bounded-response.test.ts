import {
  ProviderResponseTooLargeError,
  providerRequestSignal,
  readBoundedResponseJson,
  readBoundedResponseText,
} from '@/lib/api/bounded-response';

function chunkedResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

describe('bounded provider responses', () => {
  it('accepts a response exactly at the byte boundary', async () => {
    await expect(
      readBoundedResponseText(chunkedResponse('€'), 3),
    ).resolves.toBe('€');
  });

  it('rejects an oversized declared content length before parsing', async () => {
    const response = new Response('{}', {
      headers: { 'content-length': '4097' },
    });

    await expect(
      readBoundedResponseText(response, 4096),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it('rejects chunked content that exceeds the limit without a content-length header', async () => {
    await expect(
      readBoundedResponseText(chunkedResponse('abc', 'def'), 5),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it('parses bounded JSON and rejects malformed JSON', async () => {
    await expect(
      readBoundedResponseJson(chunkedResponse('{"ok":true}'), 32),
    ).resolves.toEqual({ ok: true });
    await expect(
      readBoundedResponseJson(chunkedResponse('{bad json'), 32),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'fails closed for an invalid byte limit (%s)',
    async (maximumBytes) => {
      await expect(
        readBoundedResponseText(chunkedResponse('x'), maximumBytes),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  it('combines a caller abort signal with the provider timeout', () => {
    const controller = new AbortController();
    const combined = providerRequestSignal(controller.signal, 10_000);
    const reason = new Error('request cancelled');

    controller.abort(reason);

    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
  });

  it('aborts when the provider timeout expires', async () => {
    const signal = providerRequestSignal(undefined, 10);

    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toEqual(
      expect.objectContaining({ name: 'TimeoutError' }),
    );
  });
});
