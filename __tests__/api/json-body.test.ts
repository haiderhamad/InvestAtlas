import {
  isBoundedString,
  isPlainObject,
  readBoundedBody,
  readBoundedJson,
} from '@/lib/api/json-body';

describe('bounded JSON request bodies', () => {
  it('rejects a declared or actual oversized body', async () => {
    await expect(
      readBoundedJson(
        new Request('http://localhost/api/test', {
          method: 'POST',
          headers: { 'content-length': '11' },
          body: '{}',
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });

    await expect(
      readBoundedJson(
        new Request('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ value: 'too large' }),
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('rejects malformed JSON and accepts a bounded object', async () => {
    await expect(
      readBoundedJson(
        new Request('http://localhost/api/test', {
          method: 'POST',
          body: '{',
        }),
        100,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      readBoundedJson(
        new Request('http://localhost/api/test', {
          method: 'POST',
          body: '{"ok":true}',
        }),
        100,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('bounds streamed request bodies even without a content-length header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.enqueue(new TextEncoder().encode('67890'));
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readBoundedBody(request, 9)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('recognizes plain objects and bounded non-empty strings', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isBoundedString('key', 3)).toBe(true);
    expect(isBoundedString('   ', 3)).toBe(false);
  });
});
