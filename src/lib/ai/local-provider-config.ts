import type { ProviderType } from './provider-registry';

export type LocalAIType = Exclude<ProviderType, 'openai-compatible'>;

export interface LocalAIConfig {
  type: LocalAIType;
  apiKey: string;
  model?: string;
}

/** Strict fixed-provider schema: never accept arbitrary endpoints from browsers. */
export function validateLocalAIConfig(value: unknown): LocalAIConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!['openai', 'gemini', 'openrouter', 'groq'].includes(String(candidate.type))
    || typeof candidate.apiKey !== 'string'
    || candidate.apiKey.length < 8 || candidate.apiKey.length > 4096
    || !/^[\x21-\x7e]+$/.test(candidate.apiKey)
    || (candidate.model !== undefined
      && (typeof candidate.model !== 'string' || candidate.model.length > 160
        || (candidate.model !== '' && !/^[A-Za-z0-9._:/-]+$/.test(candidate.model))))) {
    return null;
  }
  return {
    type: candidate.type as LocalAIType,
    apiKey: candidate.apiKey,
    ...(typeof candidate.model === 'string' && candidate.model.length > 0
      ? { model: candidate.model } : {}),
  };
}
