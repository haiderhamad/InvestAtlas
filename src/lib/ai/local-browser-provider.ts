'use client';

import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { validateLocalAIConfig, type LocalAIConfig } from './local-provider-config';

let active: LocalAIConfig | null = null;
export const LOCAL_AI_CHANGE_EVENT = 'investatlas:local-ai-provider-change';

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_AI_CHANGE_EVENT));
}

/** Tab memory only: no localStorage, sessionStorage, cookie or Firestore. */
export function setLocalAIConfig(input: LocalAIConfig): void {
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal') {
    throw new Error('Local AI is unavailable in this deployment.');
  }
  const parsed = validateLocalAIConfig(input);
  if (!parsed) throw new Error('Invalid local AI provider configuration.');
  active = parsed;
  notify();
}

export function getLocalAIConfig(): LocalAIConfig | null {
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal' || !active) return null;
  return { ...active };
}

export function clearLocalAIConfig(): void {
  active = null;
  notify();
}
