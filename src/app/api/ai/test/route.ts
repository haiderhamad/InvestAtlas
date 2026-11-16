import { testProvider, type ProviderConfig, type ProviderType } from '@/lib/ai/provider-registry';
import { ProviderStoreAuthError, getProvider, requireFirebaseUser, updateProvider } from '@/lib/ai/provider-store';
import {
  ApiPayloadError,
  isBoundedString,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';

const MAX_TEST_BODY_BYTES = 64 * 1024;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SUPPORTED_PROVIDER_TYPES = new Set<ProviderType>([
  'gemini',
  'groq',
  'openrouter',
  'openai',
]);

function handleProviderError(error: unknown) {
  if (error instanceof ApiPayloadError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof ProviderStoreAuthError) {
    return privateJson({ error: error.message }, { status: error.status });
  }
  return privateJson(
    { error: 'AI provider test failed' },
    { status: 500 },
  );
}

/**
 * POST /api/ai/test — Test an AI provider
 * Body: { id?: string, type, apiKey, baseUrl?, model?, name? }
 * 
 * If `id` is provided, loads config from store and tests it.
 * Otherwise uses the provided fields directly (for testing before saving).
 */
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_COMPUTE_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const body = await readBoundedJson(request, MAX_TEST_BODY_BYTES);
    if (!isPlainObject(body)) {
      return privateJson({ error: 'Invalid request body' }, { status: 400 });
    }

    let config: ProviderConfig;
    let storedProviderId: string | null = null;

    if (body.id) {
      // Test existing stored provider
      if (typeof body.id !== 'string' || !PROVIDER_ID_PATTERN.test(body.id)) {
        return privateJson({ error: 'Invalid provider id' }, { status: 400 });
      }
      const stored = await getProvider(user, body.id);
      if (!stored) return privateJson({ error: 'Provider not found' }, { status: 404 });
      config = stored;
      storedProviderId = body.id;
    } else {
      // Test ad-hoc config
      if (
        !isBoundedString(body.type, 32)
        || !SUPPORTED_PROVIDER_TYPES.has(body.type as ProviderType)
        || !isBoundedString(body.apiKey, 4096)
        || body.baseUrl !== undefined
        || (
          body.model !== undefined
          && !isBoundedString(body.model, 160, { allowEmpty: true })
        )
        || (
          body.name !== undefined
          && !isBoundedString(body.name, 80, { allowEmpty: true })
        )
      ) {
        return privateJson({ error: 'Missing type or apiKey' }, { status: 400 });
      }
      config = {
        id: 'test',
        name: typeof body.name === 'string' && body.name.trim()
          ? body.name
          : body.type,
        type: body.type as ProviderType,
        apiKey: body.apiKey,
        model: typeof body.model === 'string' && body.model
          ? body.model
          : undefined,
        enabled: true,
        priority: 0,
      };
    }

    const result = await testProvider(config);

    // Update stored provider with test results
    if (storedProviderId) {
      await updateProvider(user, storedProviderId, {
        lastTestAt: new Date().toISOString(),
        lastTestStatus: result.status === 'ok' ? 'ok' : result.status === 'rate_limit' ? 'rate_limit' : 'error',
        lastTestMessage: result.message,
        detectedModels: result.models.length > 0 ? result.models : undefined,
        ...(result.defaultModel && !config.model ? { model: result.defaultModel } : {}),
      });
    }

    return privateJson({ result });
  } catch (error) {
    return handleProviderError(error);
  }
}
