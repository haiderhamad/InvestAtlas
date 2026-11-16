import type { ProviderConfig } from '@/lib/ai/provider-registry';

export type ProviderMutationForm = Pick<
  Partial<ProviderConfig>,
  'name' | 'type' | 'apiKey' | 'model' | 'orgId' | 'enabled' | 'priority' | 'notes'
>;

const MUTABLE_PROVIDER_FIELDS = [
  'name',
  'type',
  'apiKey',
  'model',
  'orgId',
  'enabled',
  'priority',
  'notes',
] as const;

/**
 * Only fixed-host provider fields cross the client/server boundary. In
 * particular, a stale or injected baseUrl must never reach the API.
 */
export function buildProviderMutationPayload(
  form: ProviderMutationForm,
  options: { id?: string; omitEmptyApiKey?: boolean } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (options.id) {
    payload.id = options.id;
  }

  for (const field of MUTABLE_PROVIDER_FIELDS) {
    const value = form[field];
    if (value === undefined) continue;
    if (field === 'apiKey' && options.omitEmptyApiKey && value === '') continue;
    payload[field] = value;
  }

  return payload;
}

export async function requireSuccessfulProviderResponse(
  response: Response,
  fallbackMessage: string,
): Promise<void> {
  if (response.ok) return;

  let message = fallbackMessage;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      message = body.error;
    }
  } catch {
    // Keep the localized fallback for non-JSON and empty error responses.
  }

  throw new Error(message);
}
