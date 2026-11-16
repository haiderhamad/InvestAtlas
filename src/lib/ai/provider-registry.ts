/**
 * AI Provider Registry
 * Generic, extensible system for managing multiple AI providers
 * Supports fixed official Gemini, Groq, OpenRouter, and OpenAI endpoints.
 * Arbitrary OpenAI-compatible endpoints remain deliberately disabled.
 */

import {
  providerRequestSignal,
  readBoundedResponseJson,
} from '@/lib/api/bounded-response';

// ─── Types ───

export type ProviderType = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'openai-compatible';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  orgId?: string;
  enabled: boolean;
  priority: number; // lower = higher priority
  notes?: string;
  lastTestAt?: string;
  lastTestStatus?: 'ok' | 'error' | 'rate_limit' | 'unreachable';
  lastTestMessage?: string;
  detectedModels?: string[];
}

export interface ProviderTestResult {
  status: 'ok' | 'error' | 'rate_limit' | 'unreachable' | 'invalid_key';
  provider: string;
  type: ProviderType;
  models: string[];
  defaultModel?: string;
  latencyMs: number;
  message: string;
  baseUrl?: string;
}

// ─── Default Provider Configs ───

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-Compatible',
};

export const AI_PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_JSON_BYTES = 256 * 1024;
const MAX_PROVIDER_MODEL_LIST_BYTES = 512 * 1024;

export function getProviderLabel(type: ProviderType): string {
  return PROVIDER_LABELS[type] || type;
}

export function getDefaultEndpoint(type: ProviderType): string {
  return DEFAULT_ENDPOINTS[type] || '';
}

export function getSafeProviderEndpoint(config: Pick<ProviderConfig, 'type'>): string {
  if (config.type === 'openai-compatible') {
    throw new Error('Custom AI endpoints are disabled in the public Demo.');
  }

  const endpoint = getDefaultEndpoint(config.type);
  if (!endpoint) {
    throw new Error('Unsupported AI provider endpoint.');
  }
  return endpoint;
}

// ─── Test Adapters ───

async function testGemini(config: ProviderConfig): Promise<ProviderTestResult> {
  const start = Date.now();
  try {
    // List models to validate key
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      {
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
      }
    );

    if (res.status === 400 || res.status === 403) {
      return { status: 'invalid_key', provider: 'Google Gemini', type: 'gemini', models: [], latencyMs: Date.now() - start, message: 'Invalid API key' };
    }
    if (res.status === 429) {
      return { status: 'rate_limit', provider: 'Google Gemini', type: 'gemini', models: [], latencyMs: Date.now() - start, message: 'Rate limit reached' };
    }
    if (!res.ok) {
      return { status: 'error', provider: 'Google Gemini', type: 'gemini', models: [], latencyMs: Date.now() - start, message: `HTTP ${res.status}` };
    }

    const data = await readBoundedResponseJson(
      res,
      MAX_PROVIDER_MODEL_LIST_BYTES,
    ) as { models?: Array<{ name?: string }> };
    const models = (data.models || [])
      .map((m: { name?: string }) => m.name?.replace('models/', '') || '')
      .filter((n: string) => n.includes('gemini'))
      .slice(0, 10);

    return {
      status: 'ok',
      provider: 'Google Gemini',
      type: 'gemini',
      models,
      defaultModel: models.find((m: string) => m.includes('gemini-pro')) || models[0],
      latencyMs: Date.now() - start,
      message: `Connected — ${models.length} models available`,
    };
  } catch {
    return { status: 'unreachable', provider: 'Google Gemini', type: 'gemini', models: [], latencyMs: Date.now() - start, message: 'Could not reach Gemini API' };
  }
}

async function testOpenAICompatible(config: ProviderConfig, label: string, type: ProviderType): Promise<ProviderTestResult> {
  const start = Date.now();
  let baseUrl: string;
  try {
    baseUrl = getSafeProviderEndpoint({ type });
  } catch (error) {
    return {
      status: 'error',
      provider: label,
      type,
      models: [],
      latencyMs: 0,
      message: error instanceof Error ? error.message : 'Unsupported provider endpoint',
    };
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      redirect: 'error',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json',
        ...(config.orgId ? { 'OpenAI-Organization': config.orgId } : {}),
      },
      signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
    });

    if (res.status === 401 || res.status === 403) {
      return { status: 'invalid_key', provider: label, type, models: [], latencyMs: Date.now() - start, message: 'Invalid API key or unauthorized', baseUrl };
    }
    if (res.status === 429) {
      return { status: 'rate_limit', provider: label, type, models: [], latencyMs: Date.now() - start, message: 'Rate limit reached', baseUrl };
    }
    if (!res.ok) {
      return { status: 'error', provider: label, type, models: [], latencyMs: Date.now() - start, message: `HTTP ${res.status}`, baseUrl };
    }

    const data = await readBoundedResponseJson(
      res,
      MAX_PROVIDER_MODEL_LIST_BYTES,
    ) as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const models = (data.data || data.models || [])
      .map((m: { id?: string; name?: string }) => m.id || m.name || '')
      .filter((n: string) => n.length > 0)
      .slice(0, 20);

    return {
      status: 'ok',
      provider: label,
      type,
      models,
      defaultModel: config.model || models[0],
      latencyMs: Date.now() - start,
      message: `Connected — ${models.length} models available`,
      baseUrl,
    };
  } catch {
    return { status: 'unreachable', provider: label, type, models: [], latencyMs: Date.now() - start, message: `Could not reach ${baseUrl}`, baseUrl };
  }
}

// ─── Public API ───

/**
 * Test a provider configuration: validate key, discover models, check connectivity
 */
export async function testProvider(config: ProviderConfig): Promise<ProviderTestResult> {
  switch (config.type) {
    case 'gemini':
      return testGemini(config);
    case 'groq':
      return testOpenAICompatible(config, config.name || 'Groq', 'groq');
    case 'openrouter':
      return testOpenAICompatible(config, config.name || 'OpenRouter', 'openrouter');
    case 'openai':
      return testOpenAICompatible(config, config.name || 'OpenAI', 'openai');
    case 'openai-compatible':
      return testOpenAICompatible(config, config.name || 'Custom', 'openai-compatible');
    default:
      return { status: 'error', provider: config.name, type: config.type, models: [], latencyMs: 0, message: `Unknown provider type: ${config.type}` };
  }
}

/**
 * Call a provider with a prompt — generic dispatcher
 */
export async function callProvider(
  config: ProviderConfig,
  prompt: string,
  systemPrompt?: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ response: string; latencyMs: number; model: string }> {
  const start = Date.now();

  if (config.type === 'gemini') {
    const model = config.model || 'gemini-pro';
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
          ...(systemPrompt
            ? {
                systemInstruction: {
                  parts: [{ text: systemPrompt }],
                },
              }
            : {}),
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await readBoundedResponseJson(
      res,
      MAX_PROVIDER_JSON_BYTES,
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

  // All OpenAI-compatible providers (Groq, OpenRouter, OpenAI, custom)
  const baseUrl = getSafeProviderEndpoint(config);
  const model = config.model || 'auto';

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.orgId) headers['OpenAI-Organization'] = config.orgId;
  if (config.type === 'openrouter') {
    headers['HTTP-Referer'] = 'https://investatlas.app';
    headers['X-Title'] = 'InvestAtlas AI Analysis';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers,
    signal: providerRequestSignal(
      options.signal,
      AI_PROVIDER_TIMEOUT_MS,
    ),
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });

  if (!res.ok) throw new Error(`${config.name} ${res.status}`);
  const data = await readBoundedResponseJson(
    res,
    MAX_PROVIDER_JSON_BYTES,
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

/**
 * Generate a unique provider ID
 */
export function generateProviderId(): string {
  return `prov_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Mask an API key for display (show only last 4 chars)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return '●●●●';
  return '●'.repeat(Math.min(key.length - 4, 12)) + key.slice(-4);
}
