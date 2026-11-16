export class ApiPayloadError extends Error {
  status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = 'ApiPayloadError';
    this.status = status;
  }
}

export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Buffer> {
  const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
    throw new ApiPayloadError('Request payload is too large', 413);
  }

  if (!request.body) {
    return Buffer.alloc(0);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new ApiPayloadError('Request payload is too large', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const rawBody = (await readBoundedBody(request, maximumBytes)).toString('utf8');

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ApiPayloadError('Invalid JSON payload', 400);
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isBoundedString(
  value: unknown,
  maximumLength: number,
  options: { allowEmpty?: boolean } = {},
): value is string {
  return (
    typeof value === 'string'
    && value.length <= maximumLength
    && (options.allowEmpty === true || value.trim().length > 0)
  );
}
