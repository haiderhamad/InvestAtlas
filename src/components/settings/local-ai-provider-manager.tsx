'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import {
  clearLocalAIConfig, getLocalAIConfig, LOCAL_AI_CHANGE_EVENT, setLocalAIConfig,
} from '@/lib/ai/local-browser-provider';
import type { LocalAIType } from '@/lib/ai/local-provider-config';

const TYPES: LocalAIType[] = ['openai', 'gemini', 'openrouter', 'groq'];

/** Personal localhost only. No keys in cookies, localStorage or Firestore. */
export function LocalAIProviderManager() {
  const { t } = useAppTranslation();
  const keyRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<LocalAIType>('openai');
  const [model, setModel] = useState('');
  const [consent, setConsent] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setConnected(getLocalAIConfig() !== null);
    sync();
    window.addEventListener(LOCAL_AI_CHANGE_EVENT, sync);
    return () => window.removeEventListener(LOCAL_AI_CHANGE_EVENT, sync);
  }, []);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!consent || !keyRef.current?.value.trim() || busy) return;
    const config = { type, apiKey: keyRef.current.value, model: model.trim() || undefined };
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/local/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(config),
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      const payload = await response.json().catch(() => null) as {
        result?: { status?: unknown; provider?: unknown };
      } | null;
      if (!response.ok || payload?.result?.status !== 'ok') {
        setMessage(t('Local AI provider connection failed. Check your key, model and plan.'));
        return;
      }
      // A pending test must never reintroduce a key after the user switches
      // to the separate synthetic Demo Snapshot.
      if (readAnonymousWorkspaceMode() !== 'local_workspace') return;
      setLocalAIConfig(config);
      setMessage(t('AI key connected for this tab only.'));
    } catch {
      setMessage(t('Local AI provider connection failed. Check your key, model and plan.'));
    } finally {
      if (keyRef.current) keyRef.current.value = '';
      setHasKey(false);
      setConsent(false);
      setBusy(false);
    }
  };

  const disconnect = () => {
    clearLocalAIConfig();
    setMessage(t('Session AI key removed.'));
  };

  return (
    <section className="card" aria-label={t('Local AI provider')}>
      <div className="section-title">{t('Local AI provider')}</div>
      <p className="panel-subtitle">{t('AI keys stay in memory until you reload or close this tab. Documents are sent only to your selected provider when you start an import.')}</p>
      {connected ? (
        <div className="financial-provider-connected" role="status">
          <span>{t('AI key connected for this tab only.')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={disconnect}>
            <Trash2 size={14} aria-hidden="true" /> {t('Remove session key')}
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => { void connect(event); }} className="financial-provider-form">
          <label className="label" htmlFor="local-ai-type">{t('AI provider')}</label>
          <select id="local-ai-type" className="input" value={type} onChange={(e) => setType(e.target.value as LocalAIType)}>
            {TYPES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
          </select>
          <label className="label" htmlFor="local-ai-model">{t('Model ID (optional)')}</label>
          <input id="local-ai-model" type="text" className="input" value={model}
            onChange={(e) => setModel(e.target.value)} maxLength={160} autoComplete="off" spellCheck={false} dir="ltr" />
          <label className="label" htmlFor="local-ai-key">{t('Personal API key')}</label>
          <input id="local-ai-key" type="password" className="input" ref={keyRef}
            onInput={(e) => setHasKey(Boolean(e.currentTarget.value.trim()))}
            maxLength={4096} autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" />
          <label className="financial-provider-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('I understand uploaded documents are sent to the chosen AI provider.')}</span>
          </label>
          <div className="financial-provider-security">
            <ShieldCheck size={15} aria-hidden="true" />
            {t('Local AI keys are not saved to Firebase or browser storage.')}
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !consent || !hasKey}>
            <KeyRound size={15} aria-hidden="true" />
            {t('Test and connect AI key')}
          </button>
        </form>
      )}
      {message && <p role="status" className="financial-provider-meta">{message}</p>}
    </section>
  );
}
