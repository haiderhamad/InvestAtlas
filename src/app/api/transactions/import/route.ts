import { callProviderWithFile, isSupportedAttachmentMime } from '@/lib/ai/file-analyzer';
import type { ProviderConfig } from '@/lib/ai/provider-registry';
import { ProviderStoreAuthError, getActiveProviders, requireFirebaseUser } from '@/lib/ai/provider-store';
import {
  ApiPayloadError,
  readBoundedBody,
} from '@/lib/api/json-body';
import {
  sanitizeImportedTransaction,
  type RawImportedTransaction,
} from '@/lib/ai/transaction-import-schema';
import { privateJson } from '@/lib/api/private-response';
import {
  AUTHENTICATED_IMPORT_RATE_LIMIT,
  enforceRateLimit,
} from '@/lib/api/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 512 * 1024;
const MAX_IMPORTED_TRANSACTIONS = 500;
const MAX_WARNING_LENGTH = 300;

const SYSTEM_PROMPT = `You extract investment transactions from broker statements, exchange exports, dividend notices, and trade confirmations. Respond with ONLY valid JSON — no prose, no markdown fences.`;

const EXTRACTION_PROMPT = `Extract every individual trade, dividend, fee, or transfer from the attached document.

Return JSON with this exact shape:

{
  "transactions": [
    {
      "date": "YYYY-MM-DDTHH:mm:ssZ",
      "venue": "bitvavo | gateio | ibkr | trade-republic | bullion-vault | <free-text broker name>",
      "type": "buy | sell | dividend | fee | transfer | deposit | withdrawal | adjustment",
      "asset": "TICKER (e.g. BTC, ETH, AAPL, ISWD, GOLD)",
      "assetName": "Human-readable name, optional",
      "assetClass": "crypto | stock | etf | metal | cash",
      "quote": "Original ISO currency or quote symbol, for example EUR | USD | GBP | USDT",
      "amount": 0.5,
      "price": 42000.0,
      "total": 21000.0,
      "fee": 12.5,
      "notes": "free-text comment, optional"
    }
  ],
  "warnings": ["short note about ambiguous fields, if any"]
}

Rules:
- total = amount * price (use the document's total when shown, else compute).
- fee defaults to 0 when not visible.
- For crypto-to-crypto swaps, emit the sell leg AND the buy leg as two separate entries.
- Use ISO 8601 for date. If only a calendar date is visible, append "T00:00:00Z".
- Use the asset's ticker symbol in "asset" (uppercase). If unsure, use the ticker/ISIN shown on the document.
- Preserve the quote currency exactly as shown. Never convert, approximate, or replace an unknown currency.
- If a field genuinely isn't in the document, OMIT it — do not invent values.
- Return {"transactions": []} if the file is not a financial statement.`;

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const rateLimit = enforceRateLimit(
      request,
      AUTHENTICATED_IMPORT_RATE_LIMIT,
      user.uid,
    );
    if (rateLimit) return rateLimit;
    const requestDeadline = AbortSignal.timeout(25_000);
    const boundedBody = await readBoundedBody(request, MAX_MULTIPART_BYTES);
    const boundedRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: new Uint8Array(boundedBody),
    });
    const form = await boundedRequest.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return privateJson({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return privateJson({ error: 'File exceeds 10 MB limit' }, { status: 413 });
    }

    if (!isSupportedAttachmentMime(file.type)) {
      return privateJson(
        { error: 'Unsupported file type. Upload a PDF or supported image.' },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString('base64');

    const active = await getActiveProviders(user);
    const provider: ProviderConfig | undefined = active[0];

    if (!provider) {
      return privateJson(
        { error: 'No AI provider configured. Add one under Settings → AI Providers.' },
        { status: 503 },
      );
    }

    try {
      const { response, latencyMs, model } = await callProviderWithFile(
        provider,
        EXTRACTION_PROMPT,
        SYSTEM_PROMPT,
        { mimeType: file.type, data: base64 },
        { signal: requestDeadline },
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Provider response did not contain JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const rawList: RawImportedTransaction[] = Array.isArray(parsed.transactions)
        ? parsed.transactions.slice(0, MAX_IMPORTED_TRANSACTIONS)
        : [];
      const transactions = rawList
        .map((raw, index) => sanitizeImportedTransaction(raw, index))
        .filter((transaction) => transaction !== null);
      const warnings = Array.isArray(parsed.warnings)
        ? parsed.warnings
            .filter((warning: unknown): warning is string => typeof warning === 'string')
            .slice(0, 20)
            .map((warning: string) => warning.slice(0, MAX_WARNING_LENGTH))
        : [];
      if (transactions.length < rawList.length) {
        warnings.push('Some incomplete or invalid rows were omitted and require manual review.');
      }

      return privateJson({
        transactions,
        warnings,
        provider: provider.name,
        model,
        latencyMs,
      });
    } catch {
      return privateJson(
        {
          error: 'AI provider failed',
          attempts: 1,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    if (error instanceof ApiPayloadError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    if (error instanceof ProviderStoreAuthError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    return privateJson({ error: 'Transaction import failed' }, { status: 500 });
  }
}
