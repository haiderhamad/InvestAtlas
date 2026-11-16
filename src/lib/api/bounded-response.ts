export class ProviderResponseTooLargeError extends Error {
  constructor() {
    super('External provider response exceeded the allowed size');
    this.name = 'ProviderResponseTooLargeError';
  }
}

export async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError('maximumBytes must be a positive safe integer');
  }

  const contentLength = response.headers.get('content-length');
  if (
    contentLength
    && Number.isFinite(Number(contentLength))
    && Number(contentLength) > maximumBytes
  ) {
    await response.body?.cancel();
    throw new ProviderResponseTooLargeError();
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw new ProviderResponseTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function readBoundedResponseJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const text = await readBoundedResponseText(response, maximumBytes);
  return JSON.parse(text) as unknown;
}

export function providerRequestSignal(
  requestSignal?: AbortSignal,
  timeoutMs = 10_000,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;
}
