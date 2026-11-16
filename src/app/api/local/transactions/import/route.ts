import { privateJson } from '@/lib/api/private-response';
import { ApiPayloadError, readBoundedBody } from '@/lib/api/json-body';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { validateLocalAIConfig } from '@/lib/ai/local-provider-config';
import { isSupportedAttachmentMime, callProviderWithFile } from '@/lib/ai/file-analyzer';
import { sanitizeImportedTransaction, type RawImportedTransaction } from '@/lib/ai/transaction-import-schema';
import type { ProviderConfig } from '@/lib/ai/provider-registry';
import { isAuthorizedLocalProviderRequest } from '@/lib/runtime/local-provider-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_DOCUMENT = 10 * 1024 * 1024;
const MAX_REQUEST = MAX_DOCUMENT + 16 * 1024;
const MAX_TRANSACTIONS = 500;
const LIMIT = { bucket: 'local-ai-document-import', limit: 12, windowMs: 60 * 60_000 } as const;
const SYSTEM = 'Extract investment transactions from the provided document. Return strict JSON only. Never fabricate missing fields.';
const PROMPT = `Read each real transaction in the supplied broker statement. Return one JSON object:
{"transactions":[{"date":"ISO8601","venue":"broker name","type":"buy|sell|dividend|fee|transfer|deposit|withdrawal|adjustment","asset":"SYMBOL","assetClass":"crypto|stock|etf|metal|cash","quote":"EUR|USD|OTHER","amount":1,"price":100,"total":100,"fee":0}],"warnings":[]}.
Use exact source amounts, currencies and dates. Each swap has sell and buy legs. Do not invent missing values. If it is not a transaction statement, return an empty transactions array. The user reviews every extracted row before saving.`;

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedLocalProviderRequest(request)) {
    return privateJson({ error: 'Local document import denied.' }, { status: 403 });
  }
  const limited = enforceRateLimit(new Request(request.url), LIMIT, 'local-ai-import');
  if (limited) return privateJson({ error: 'Local AI import limit reached.' }, { status: limited.status });

  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      return privateJson({ error: 'Multipart file required.' }, { status: 400 });
    }
    const bytes = await readBoundedBody(request, MAX_REQUEST);
    const input = new Request(request.url, {
      method: 'POST', headers: request.headers, body: new Uint8Array(bytes),
    });
    const form = await input.formData();
    const file = form.get('file');
    const configRaw = form.get('provider');
    if (form.has('file') && form.has('provider') && [...form.keys()].length === 2
      && typeof configRaw === 'string' && configRaw.length <= 6 * 1024
      && file instanceof File && file.size > 0 && file.size <= MAX_DOCUMENT
      && isSupportedAttachmentMime(file.type)) {
      let providerInput: unknown;
      try {
        providerInput = JSON.parse(configRaw);
      } catch {
        return privateJson({ error: 'Invalid provider settings.' }, { status: 400 });
      }
      const config = validateLocalAIConfig(providerInput);
      if (!config || !providerInput || typeof providerInput !== 'object'
        || Object.keys(providerInput).some((key) => !['type', 'apiKey', 'model'].includes(key))) {
        return privateJson({ error: 'Invalid provider settings.' }, { status: 400 });
      }
      const provider: ProviderConfig = {
        id: 'local-personal-import', name: config.type, type: config.type,
        apiKey: config.apiKey, model: config.model, enabled: true, priority: 0,
      };
      const attachment = {
        mimeType: file.type, data: Buffer.from(await file.arrayBuffer()).toString('base64'),
      };
      try {
        const result = await callProviderWithFile(
          provider, PROMPT, SYSTEM, attachment, { signal: AbortSignal.timeout(25_000) },
        );
        const matched = result.response.match(/\{[\s\S]*\}/);
        if (!matched) throw new Error('Invalid provider result');
        const parsed: unknown = JSON.parse(matched[0]);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid provider result');
        }
        const payload = parsed as Record<string, unknown>;
        if (!Array.isArray(payload.transactions)) throw new Error('Invalid provider result');
        const incoming = payload.transactions.slice(0, MAX_TRANSACTIONS) as RawImportedTransaction[];
        const transactions = incoming.map(sanitizeImportedTransaction)
          .filter((row) => row !== null);
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.filter((v): v is string => typeof v === 'string')
            .slice(0, 20).map((v) => v.slice(0, 300))
          : [];
        if (transactions.length !== incoming.length) warnings.push('Some invalid rows were omitted and require review.');
        return privateJson({
          transactions, warnings, provider: provider.name,
          model: result.model, latencyMs: result.latencyMs,
        });
      } catch {
        return privateJson({ error: 'AI provider failed. Review the model and plan.' }, { status: 502 });
      }
    }
    return privateJson({ error: 'Invalid file or provider configuration.' }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: 'Invalid or oversized request.' }, { status: error.status });
    }
    return privateJson({ error: 'Local document import failed.' }, { status: 500 });
  }
}
