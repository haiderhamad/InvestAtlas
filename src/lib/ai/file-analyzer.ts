/**
 * Multimodal AI file analysis.
 *
 * Sends a file (PDF or image) plus a text prompt to the configured provider.
 * Gemini: native PDF + image support via inlineData.
 * OpenAI-compatible: images via image_url with base64 data URIs (GPT-4o, Claude, Llama-vision models).
 * Groq / text-only models: falls back to prompt-only (will usually return an error message we surface).
 */

import type { ProviderConfig } from './provider-registry';
import { AI_PROVIDER_TIMEOUT_MS, getSafeProviderEndpoint } from './provider-registry';
import {
  providerRequestSignal,
  readBoundedResponseJson,
} from '@/lib/api/bounded-response';

export interface FileAttachment {
  mimeType: string;
  data: string;
}

export interface MultimodalCallResult {
  response: string;
  latencyMs: number;
  model: string;
}

const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
const MAX_PROVIDER_FILE_RESPONSE_BYTES = 256 * 1024;

function isPdf(mime: string): boolean {
  return mime === 'application/pdf';
}

function isImage(mime: string): boolean {
  return SUPPORTED_IMAGE_MIME.has(mime);
}

export function isSupportedAttachmentMime(mime: string): boolean {
  return isPdf(mime) || isImage(mime);
}

export async function callProviderWithFile(
  config: ProviderConfig,
  prompt: string,
  systemPrompt: string | undefined,
  attachment: FileAttachment,
  options: { signal?: AbortSignal } = {},
): Promise<MultimodalCallResult> {
  const start = Date.now();

  if (!isSupportedAttachmentMime(attachment.mimeType)) {
    throw new Error(`Unsupported file type: ${attachment.mimeType}`);
  }

  if (config.type === 'gemini') {
    const model = config.model || 'gemini-1.5-flash';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        signal: providerRequestSignal(
          options.signal,
          AI_PROVIDER_TIMEOUT_MS,
        ),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: attachment.mimeType, data: attachment.data } },
                { text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Gemini ${res.status}`);
    }
    const data = await readBoundedResponseJson(
      res,
      MAX_PROVIDER_FILE_RESPONSE_BYTES,
    ) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    return {
      response: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      latencyMs: Date.now() - start,
      model,
    };
  }

  if (isPdf(attachment.mimeType) && config.type !== 'openrouter' && config.type !== 'openai') {
    throw new Error(
      `${config.name}: PDF uploads require Gemini or an OpenAI/OpenRouter vision model that supports documents.`,
    );
  }

  const baseUrl = getSafeProviderEndpoint(config);
  const model = config.model || 'auto';

  const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;

  const userContent: Array<Record<string, unknown>> = [
    { type: 'image_url', image_url: { url: dataUrl } },
    { type: 'text', text: prompt },
  ];

  const messages: Array<{ role: string; content: unknown }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userContent });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.orgId) headers['OpenAI-Organization'] = config.orgId;
  if (config.type === 'openrouter') {
    headers['HTTP-Referer'] = 'https://investatlas.app';
    headers['X-Title'] = 'InvestAtlas Transaction Import';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers,
    signal: providerRequestSignal(
      options.signal,
      AI_PROVIDER_TIMEOUT_MS,
    ),
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 4096 }),
  });

  if (!res.ok) {
    throw new Error(`${config.name} ${res.status}`);
  }
  const data = await readBoundedResponseJson(
    res,
    MAX_PROVIDER_FILE_RESPONSE_BYTES,
  ) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  return {
    response: data.choices?.[0]?.message?.content || '',
    latencyMs: Date.now() - start,
    model: data.model || model,
  };
}
