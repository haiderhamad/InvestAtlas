import { ApiPayloadError, readBoundedJson } from '@/lib/api/json-body';
import { privateJson } from '@/lib/api/private-response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { testProvider, type ProviderConfig } from '@/lib/ai/provider-registry';
import { validateLocalAIConfig } from '@/lib/ai/local-provider-config';
import { isAuthorizedLocalProviderRequest } from '@/lib/runtime/local-provider-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCAL_AI_TEST_LIMIT = { bucket: 'local-ai-test', limit: 10, windowMs: 60 * 60_000 } as const;

/** Test a fixed, official AI endpoint without storing the user's key. */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedLocalProviderRequest(request)) {
    return privateJson({ error: 'Local AI access denied.' }, { status: 403 });
  }
  const limited = enforceRateLimit(new Request(request.url), LOCAL_AI_TEST_LIMIT, 'local-ai');
  if (limited) return privateJson({ error: 'Local AI test limit reached.' }, { status: limited.status });

  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return privateJson({ error: 'JSON body required.' }, { status: 400 });
    }
    const raw = await readBoundedJson(request, 6 * 1024);
    const parsed = validateLocalAIConfig(raw);
    if (!parsed || (raw && typeof raw === 'object' && Object.keys(raw).some(
      (name) => !['type', 'apiKey', 'model'].includes(name),
    ))) {
      return privateJson({ error: 'Invalid AI provider configuration.' }, { status: 400 });
    }
    const provider: ProviderConfig = {
      id: 'local-personal', name: parsed.type, type: parsed.type,
      apiKey: parsed.apiKey, model: parsed.model, enabled: true, priority: 0,
    };
    const result = await testProvider(provider);
    // Only validated provider status/model metadata, never the raw key.
    return privateJson({ result });
  } catch (error) {
    if (error instanceof ApiPayloadError) return privateJson({ error: 'Invalid request.' }, { status: error.status });
    return privateJson({ error: 'Local AI provider test failed.' }, { status: 503 });
  }
}
