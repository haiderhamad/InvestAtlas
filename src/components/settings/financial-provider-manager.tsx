'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, Play, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { getFirebaseAuthHeaders } from '@/lib/auth/firebase-api-auth';
import { useAuth } from '@/lib/auth/auth-context';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import type { FinancialCapability } from '@/lib/financial-data/contracts';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useRouter } from 'next/navigation';

type ConnectionStatus =
  | 'connected'
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'provider_unavailable'
  | 'unexpected_response'
  | 'capability_unavailable'
  | 'misconfigured';

type FinancialProvider = {
  id: 'tiingo';
  enabled: boolean;
  priority: number;
  status: ConnectionStatus;
  detectedCapabilities: FinancialCapability[];
  lastValidatedAt: string;
  maskedKey: string;
  credentialRevision: number;
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  invalid_key: 'Invalid API key',
  rate_limited: 'Rate limit reached',
  quota_exhausted: 'Quota exhausted',
  provider_unavailable: 'Provider temporarily unavailable',
  unexpected_response: 'Provider returned an unexpected response',
  capability_unavailable: 'Required data capability is unavailable',
  misconfigured: 'Provider configuration needs attention',
};

const CAPABILITY_LABELS: Record<FinancialCapability, string> = {
  quote: 'Quotes',
  history: 'History',
  fx: 'FX',
  fundamentals: 'Fundamentals',
  earnings: 'Earnings',
  news: 'News',
  events: 'Events',
};

function messageFromResponse(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function formatValidationTime(value: string, language: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(time));
}

/**
 * Fixed, user-owned Tiingo connection. The browser sends a key only once to
 * the authenticated server route; future reads receive masked metadata only.
 */
export function FinancialProviderManager({ isAvailable }: { isAvailable: boolean }) {
  const { t, language } = useAppTranslation();
  const { signOut } = useAuth();
  const router = useRouter();
  const [provider, setProvider] = useState<FinancialProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [confirmedPersonalUse, setConfirmedPersonalUse] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'test' | 'delete' | 'demo' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const loadProvider = useCallback(async (options: {
    preserveMessage?: boolean;
    signal?: AbortSignal;
  } = {}) => {
    try {
      setIsLoading(true);
      if (!options.preserveMessage) setMessage(null);
      const response = await fetch('/api/financial-data/providers', {
        cache: 'no-store',
        headers: await getFirebaseAuthHeaders(),
        signal: options.signal,
      });
      const payload = await response.json().catch(() => null) as { providers?: FinancialProvider[] } | null;
      if (!response.ok) {
        throw new Error(response.status === 429
          ? 'Financial provider status was requested too often. Wait a moment and try again.'
          : messageFromResponse(payload, 'Financial provider status could not be loaded.'));
      }
      setProvider(payload?.providers?.find((candidate) => candidate.id === 'tiingo') ?? null);
    } catch (error) {
      if (options.signal?.aborted) return;
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Financial provider status could not be loaded.' });
    } finally {
      if (!options.signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadProvider({ signal: controller.signal });
    return () => controller.abort();
  }, [loadProvider]);

  const connect = async () => {
    if (!apiKey.trim() || !confirmedPersonalUse) return;
    try {
      setAction('connect');
      setMessage(null);
      const response = await fetch('/api/financial-data/providers', {
        method: 'POST',
        cache: 'no-store',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          providerId: 'tiingo',
          apiKey: apiKey.trim(),
          confirmedPersonalUse: true,
        }),
      });
      const payload = await response.json().catch(() => null) as { provider?: FinancialProvider; status?: ConnectionStatus } | null;
      if (!response.ok) {
        const status = payload?.status;
        throw new Error(status ? t(STATUS_LABELS[status]) : messageFromResponse(payload, t('Could not connect financial data provider.')));
      }
      setProvider(payload?.provider ?? null);
      setApiKey('');
      setConfirmedPersonalUse(false);
      setMessage({ tone: 'success', text: t('Tiingo is connected. Your API key is stored encrypted and is only shown in masked form.') });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : t('Could not connect financial data provider.') });
    } finally {
      setAction(null);
    }
  };

  const testConnection = async () => {
    try {
      setAction('test');
      setMessage(null);
      const response = await fetch('/api/financial-data/providers/test', {
        method: 'POST',
        cache: 'no-store',
        headers: await getFirebaseAuthHeaders(),
      });
      const payload = await response.json().catch(() => null) as { status?: ConnectionStatus } | null;
      if (!response.ok || payload?.status !== 'connected') {
        throw new Error(payload?.status ? t(STATUS_LABELS[payload.status]) : messageFromResponse(payload, t('Financial provider test failed.')));
      }
      setMessage({ tone: 'success', text: t('Connection test passed.') });
      await loadProvider({ preserveMessage: true });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : t('Financial provider test failed.') });
    } finally {
      setAction(null);
    }
  };

  const removeConnection = async () => {
    if (!window.confirm(t('Remove Tiingo connection? Your encrypted financial API key will be deleted.'))) return;
    try {
      setAction('delete');
      setMessage(null);
      const response = await fetch('/api/financial-data/providers?id=tiingo', {
        method: 'DELETE',
        cache: 'no-store',
        headers: await getFirebaseAuthHeaders(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFromResponse(payload, t('Could not remove financial data provider.')));
      setProvider(null);
      setMessage({ tone: 'success', text: t('Tiingo connection removed.') });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : t('Could not remove financial data provider.') });
    } finally {
      setAction(null);
    }
  };

  const openDemoSnapshot = async () => {
    try {
      setAction('demo');
      setMessage(null);
      await signOut();
      writeAnonymousWorkspaceMode('demo_snapshot');
      router.replace('/');
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not open the Demo Snapshot. Your Cloud Workspace was not changed.' });
      setAction(null);
    }
  };

  const isConnected = provider?.status === 'connected';
  const lastValidated = provider ? formatValidationTime(provider.lastValidatedAt, language) : null;
  const statusLabel = !isAvailable
    ? 'Hosted connection unavailable'
    : isConnected
      ? 'Connected'
      : 'Not connected';

  return (
    <section className="card financial-provider-manager" aria-labelledby="financial-provider-title">
      <div className="panel-header financial-provider-header">
        <div>
          <div className="section-title" id="financial-provider-title">{t('Financial Data Providers')}</div>
          <div className="panel-subtitle">
            {t(isAvailable
              ? 'Connect a personal provider only when you want sourced market data in your Cloud Workspace.'
              : 'No personal financial data provider is currently connectable on hosted InvestAtlas.')}
          </div>
        </div>
        <span className={`badge ${isAvailable && isConnected ? 'badge-green' : 'badge-neutral'} financial-provider-status`}>
          {isAvailable && isConnected ? <CheckCircle2 size={13} aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
          {t(statusLabel)}
        </span>
      </div>

      {isAvailable ? (
        <div className="financial-provider-card">
          <div className="financial-provider-icon" aria-hidden="true"><KeyRound size={19} /></div>
          <div className="financial-provider-copy">
            <div className="financial-provider-name">{t('Tiingo')} <span className="badge badge-neutral">{t('Personal API key')}</span></div>
            <p>{t('Tiingo is optional. InvestAtlas does not provide or share a market-data key, and personal data requests are never used for the public demo.')}</p>
            <div className="financial-provider-links">
              <a href="https://www.tiingo.com/documentation/appendix/developers" target="_blank" rel="noreferrer">
                {t('Tiingo Developer Program')} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a href="https://www.tiingo.com/documentation/end-of-day" target="_blank" rel="noreferrer">
                {t('API documentation')} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a href="https://www.tiingo.com/about/pricing" target="_blank" rel="noreferrer">
                {t('Plan and limits')} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a href="https://app.tiingo.com/tos/" target="_blank" rel="noreferrer">
                {t('Terms of Service')} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a href="https://www.tiingo.com/privacy" target="_blank" rel="noreferrer">
                {t('Privacy Policy')} <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className={`financial-provider-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          {message.tone === 'error' ? <TriangleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{t(message.text)}</span>
          {message.tone === 'error' && !isLoading ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadProvider()}>
              {t('Retry provider status')}
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="financial-provider-loading" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /> {t('Loading provider status…')}</div>
      ) : !isAvailable ? (
        <div className="financial-provider-connected">
          <div>
            <div className="financial-provider-message notice" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{t('Hosted InvestAtlas currently has no connectable stock or crypto price provider. Your portfolio records remain available; market-dependent values stay unavailable rather than guessed.')}</span>
            </div>
            <div className="financial-provider-meta" style={{ marginTop: 10 }}>
              {t(provider
                ? 'A previously stored Tiingo key cannot be used on this hosted deployment. You can remove it below.'
                : 'You do not need to create or paste an API key for this hosted deployment.')}
            </div>
          </div>
          {provider ? (
            <div className="financial-provider-actions">
              <button type="button" className="btn btn-secondary btn-sm financial-provider-delete" onClick={() => void removeConnection()} disabled={action !== null}>
                {action === 'delete' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {t('Remove stored key')}
              </button>
            </div>
          ) : null}
          <div className="financial-provider-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openDemoSnapshot()} disabled={action !== null}>
              {action === 'demo' ? <LoaderCircle className="spin" size={14} /> : null}
              {t(action === 'demo' ? 'Opening Demo Snapshot…' : 'Sign out and explore Demo Snapshot')}
            </button>
          </div>
        </div>
      ) : isConnected && provider ? (
        <div className="financial-provider-connected">
          <div>
            <div className="financial-provider-key">{t('Key')}: <bdi dir="ltr">{provider.maskedKey}</bdi></div>
            <div className="financial-provider-meta">
              {lastValidated ? `${t('Last tested')}: ${lastValidated}` : t('Connection status is available.')}
            </div>
            {provider.detectedCapabilities.length > 0 ? (
              <div className="financial-provider-capabilities" aria-label={t('Available capabilities')}>
                {provider.detectedCapabilities.map((capability) => <span className="badge badge-blue" key={capability}>{t(CAPABILITY_LABELS[capability])}</span>)}
              </div>
            ) : null}
          </div>
          <div className="financial-provider-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void testConnection()} disabled={action !== null}>
              {action === 'test' ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} {t(action === 'test' ? 'Testing…' : 'Test connection')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm financial-provider-delete" onClick={() => void removeConnection()} disabled={action !== null}>
              {action === 'delete' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {t('Remove')}
            </button>
          </div>
        </div>
      ) : (
        <form className="financial-provider-form" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <label className="label" htmlFor="tiingo-api-key">{t('Tiingo API key')}</label>
          <input
            id="tiingo-api-key"
            className="input financial-provider-key-input"
            type="password"
            value={apiKey}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('Paste your personal Tiingo API key')}
          />
          <label className="financial-provider-consent">
            <input type="checkbox" checked={confirmedPersonalUse} onChange={(event) => setConfirmedPersonalUse(event.target.checked)} />
            <span>{t('I will use my own Tiingo key under my own Tiingo plan and accept its applicable terms and limits.')}</span>
          </label>
          <div className="financial-provider-security"><ShieldCheck size={15} aria-hidden="true" /> {t('The key is sent only to InvestAtlas over an authenticated request, encrypted server-side, and never displayed again in full.')}</div>
          <div className="financial-provider-actions">
            <button type="submit" className="btn btn-primary" disabled={action !== null || !apiKey.trim() || !confirmedPersonalUse}>
              {action === 'connect' ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {t(action === 'connect' ? 'Connecting…' : 'Connect Tiingo')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
