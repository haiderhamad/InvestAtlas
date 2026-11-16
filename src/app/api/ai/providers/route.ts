import {
  ProviderStoreAuthError,
  addProvider,
  deleteProvider,
  getAllProviders,
  reorderProviders,
  requireFirebaseUser,
  updateProvider,
} from '@/lib/ai/provider-store';
import type { ProviderConfig, ProviderType } from '@/lib/ai/provider-registry';
import { maskApiKey } from '@/lib/ai/provider-registry';
import {
  ApiPayloadError,
  isBoundedString,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_AI_MUTATION_RATE_LIMIT,
  AUTHENTICATED_AI_READ_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';

const MAX_PROVIDER_BODY_BYTES = 64 * 1024;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SUPPORTED_PROVIDER_TYPES = new Set([
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
    { error: 'AI provider request failed' },
    { status: 500 },
  );
}

function toProviderResponse(provider: ProviderConfig) {
  const { apiKey, baseUrl: _legacyBaseUrl, ...safeProvider } = provider;
  void _legacyBaseUrl;
  return {
    ...safeProvider,
    maskedKey: maskApiKey(apiKey),
  };
}

/**
 * GET /api/ai/providers — List all providers (keys masked)
 */
export async function GET(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_READ_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const providers = await getAllProviders(user);
    return privateJson({ providers });
  } catch (error) {
    return handleProviderError(error);
  }
}

/**
 * POST /api/ai/providers — Add a new provider
 * Body: { name, type, apiKey, model?, orgId?, enabled?, priority?, notes? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_MUTATION_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const body = await readBoundedJson(request, MAX_PROVIDER_BODY_BYTES);

    if (
      !isPlainObject(body)
      || !isBoundedString(body.name, 80)
      || !isBoundedString(body.type, 32)
      || !SUPPORTED_PROVIDER_TYPES.has(body.type)
      || !isBoundedString(body.apiKey, 4096)
      || body.baseUrl !== undefined
      || (
        body.model !== undefined
        && !isBoundedString(body.model, 160, { allowEmpty: true })
      )
      || (
        body.orgId !== undefined
        && !isBoundedString(body.orgId, 160, { allowEmpty: true })
      )
      || (
        body.notes !== undefined
        && !isBoundedString(body.notes, 1000, { allowEmpty: true })
      )
      || (body.enabled !== undefined && typeof body.enabled !== 'boolean')
      || (
        body.priority !== undefined
        && (
          !Number.isInteger(body.priority)
          || Number(body.priority) < 0
          || Number(body.priority) > 100
        )
      )
    ) {
      return privateJson({ error: 'Invalid provider configuration' }, { status: 400 });
    }

    const config: Omit<ProviderConfig, 'id'> = {
      name: body.name,
      type: body.type as ProviderType,
      apiKey: body.apiKey,
      model: typeof body.model === 'string' && body.model
        ? body.model
        : undefined,
      orgId: typeof body.orgId === 'string' && body.orgId
        ? body.orgId
        : undefined,
      enabled: body.enabled !== false,
      priority: typeof body.priority === 'number' ? body.priority : 999,
      notes: typeof body.notes === 'string' && body.notes
        ? body.notes
        : undefined,
    };

    const provider = await addProvider(user, config);
    return privateJson({ provider: toProviderResponse(provider) }, { status: 201 });
  } catch (error) {
    return handleProviderError(error);
  }
}

/**
 * PUT /api/ai/providers — Update provider or reorder
 * Body: { id, ...updates } or { reorder: [id1, id2, ...] }
 */
export async function PUT(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_MUTATION_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const body = await readBoundedJson(request, MAX_PROVIDER_BODY_BYTES);
    if (!isPlainObject(body)) {
      return privateJson({ error: 'Invalid request body' }, { status: 400 });
    }

    if (body.reorder && Array.isArray(body.reorder)) {
      if (
        body.reorder.length > 10
        || body.reorder.some(
          (id) => typeof id !== 'string' || !PROVIDER_ID_PATTERN.test(id),
        )
        || new Set(body.reorder).size !== body.reorder.length
      ) {
        return privateJson({ error: 'Invalid provider order' }, { status: 400 });
      }
      await reorderProviders(user, body.reorder);
      return privateJson({ ok: true });
    }

    if (
      typeof body.id !== 'string'
      || !PROVIDER_ID_PATTERN.test(body.id)
      || body.baseUrl !== undefined
      || (
        body.type !== undefined
        && (
          !isBoundedString(body.type, 32)
          || !SUPPORTED_PROVIDER_TYPES.has(body.type)
        )
      )
      || (
        body.name !== undefined
        && !isBoundedString(body.name, 80)
      )
      || (
        body.apiKey !== undefined
        && !isBoundedString(body.apiKey, 4096)
      )
      || (
        body.model !== undefined
        && !isBoundedString(body.model, 160, { allowEmpty: true })
      )
      || (
        body.orgId !== undefined
        && !isBoundedString(body.orgId, 160, { allowEmpty: true })
      )
      || (
        body.notes !== undefined
        && !isBoundedString(body.notes, 1000, { allowEmpty: true })
      )
      || (body.enabled !== undefined && typeof body.enabled !== 'boolean')
      || (
        body.priority !== undefined
        && (
          !Number.isInteger(body.priority)
          || Number(body.priority) < 0
          || Number(body.priority) > 100
        )
      )
    ) {
      return privateJson({ error: 'Missing provider id' }, { status: 400 });
    }

    const updates: Partial<ProviderConfig> = {};
    for (const key of [
      'name',
      'type',
      'apiKey',
      'model',
      'orgId',
      'enabled',
      'priority',
      'notes',
    ] as const) {
      if (body[key] !== undefined) {
        Object.assign(updates, { [key]: body[key] });
      }
    }

    const updated = await updateProvider(user, body.id, updates);
    if (!updated) {
      return privateJson({ error: 'Provider not found' }, { status: 404 });
    }

    return privateJson({ provider: toProviderResponse(updated) });
  } catch (error) {
    return handleProviderError(error);
  }
}

/**
 * DELETE /api/ai/providers?id=xxx — Remove a provider
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_AI_MUTATION_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !PROVIDER_ID_PATTERN.test(id)) {
      return privateJson({ error: 'Missing id' }, { status: 400 });
    }

    const deleted = await deleteProvider(user, id);
    if (!deleted) return privateJson({ error: 'Provider not found' }, { status: 404 });

    return privateJson({ ok: true });
  } catch (error) {
    return handleProviderError(error);
  }
}
