'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, DatabaseZap, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import { useAuth } from '@/lib/auth/auth-context';
import { readAnonymousWorkspaceMode, writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import {
  clearTiingoBrowserCredential,
  getTiingoBrowserBudget,
  hasTiingoBrowserCredential,
  setTiingoBrowserCredential,
  testTiingoBrowserCredential,
  TiingoBrowserError,
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT,
  type TiingoBrowserStatus,
} from '@/lib/financial-data/providers/tiingo-browser';
import {
  clearAlphaVantageNormalizedCache,
  getAlphaVantageCachedSymbols,
} from '@/lib/financial-data/providers/alpha-vantage-browser';
import { tiingoManagerText } from './tiingo-manager-copy';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';

type LegacyTiingoProvider = { id: 'tiingo'; status: string; maskedKey: string };

const STATUS_KEYS: Record<TiingoBrowserStatus, Parameters<typeof tiingoManagerText>[1]> = {
  connected: 'connected',
  invalid_key: 'invalidKey',
  rate_limited: 'rateLimited',
  quota_exhausted: 'hourlyLimitReached',
  provider_unavailable: 'providerUnavailable',
  unexpected_response: 'unexpectedResponse',
  capability_unavailable: 'capabilityUnavailable',
};

function responseMessage(payload: unknown, fallback: string): string {
  return payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : fallback;
}

export function FinancialProviderManagerV124() {
  const { t, language } = useAppTranslation();
  const tc = (key: Parameters<typeof tiingoManagerText>[1]) => tiingoManagerText(language, key);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasKeyInput, setHasKeyInput] = useState(false);
  const [confirmedPersonalUse, setConfirmedPersonalUse] = useState(false);
  const [action, setAction] = useState<'connect' | 'local-test' | 'clear' | 'demo' | 'legacy-delete' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [localTestResult, setLocalTestResult] = useState<{ date: string; close: number } | null>(null);
  const [budgetVersion, setBudgetVersion] = useState(0);
  const [scopedLegacyProvider, setScopedLegacyProvider] = useState<{ userId: string; provider: LegacyTiingoProvider } | null>(null);
  const isLocalPersonal = !user && INVESTATLAS_DEPLOYMENT_MODE === 'local_personal';
  const providerUser = user ?? (isLocalPersonal ? { id: LOCAL_PERSONAL_PROVIDER_OWNER_ID } : null);
  const userId = providerUser?.id ?? null;
  const activeUserIdRef = useRef(userId);
  // Clear unsubmitted key material before paint when React reuses this form
  // across account changes. Never carry consent or pending action state over.
  useLayoutEffect(() => {
    if (activeUserIdRef.current === userId) return;
    activeUserIdRef.current = userId;
    if (keyInputRef.current) keyInputRef.current.value = '';
    setHasKeyInput(false);
    setConfirmedPersonalUse(false);
    setMessage(null);
    setLocalTestResult(null);
    setAction(null);
  }, [userId]);
  // An async response from another account must never be displayed for this user.
  const legacyProvider = scopedLegacyProvider?.userId === userId ? scopedLegacyProvider.provider : null;

  const syncSessionState = useCallback(() => {
    setConnected(Boolean(userId && hasTiingoBrowserCredential(userId)));
    setBudgetVersion((value) => value + 1);
  }, [userId]);

  useEffect(() => {
    syncSessionState();
    window.addEventListener(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT, syncSessionState);
    return () => window.removeEventListener(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT, syncSessionState);
  }, [syncSessionState]);

  useEffect(() => {
    if (!userId || isLocalPersonal) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = await getFirebaseApiIdentity();
        if (controller.signal.aborted || !identity || identity.userId !== userId) return;
        const response = await fetch('/api/financial-data/providers', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${identity.token}` },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { providers?: LegacyTiingoProvider[] };
        if (controller.signal.aborted) return;
        const provider = payload.providers?.find((candidate) => candidate.id === 'tiingo');
        setScopedLegacyProvider(provider ? { userId, provider } : null);
      } catch {
        // Legacy cleanup metadata is optional.
      }
    })();
    return () => controller.abort();
  }, [userId, isLocalPersonal]);

  if (!providerUser) return null;
  const budget = getTiingoBrowserBudget(providerUser.id);
  const cachedSymbols = getAlphaVantageCachedSymbols(providerUser.id);
  void budgetVersion;

  const connect = async () => {
    const requestedUserId = providerUser.id;
    const apiKey = keyInputRef.current?.value ?? '';
    if (!apiKey.trim() || !confirmedPersonalUse) return;
    try {
      setAction('connect');
      setMessage(null);
      await testTiingoBrowserCredential(requestedUserId, apiKey);
      // Reject late callbacks after a Cloud identity or Local/Demo switch.
      if (activeUserIdRef.current !== requestedUserId
        || (isLocalPersonal && readAnonymousWorkspaceMode() !== 'local_workspace')) return;
      setTiingoBrowserCredential(requestedUserId, apiKey);
      if (keyInputRef.current) keyInputRef.current.value = '';
      setHasKeyInput(false);
      setConfirmedPersonalUse(false);
      setMessage({ tone: 'success', text: tc('connected') });
    } catch (error) {
      if (activeUserIdRef.current !== requestedUserId) return;
      const status = error instanceof TiingoBrowserError ? error.status : 'provider_unavailable';
      // Safe failure diagnostics: disclose only HTTP status or NETWORK,
      // never personal API keys, Firebase tokens, payloads or response headers.
      const diagnostic = error instanceof TiingoBrowserError ? error.diagnostic : null;
      setMessage({ tone: 'error', text: `${tc(STATUS_KEYS[status])}${diagnostic ? ` [${diagnostic}]` : ''}` });
    } finally {
      if (activeUserIdRef.current === requestedUserId) setAction(null);
    }
  };

  const testLocalServer = async () => {
    const requestedUserId = providerUser.id;
    const apiKey = keyInputRef.current?.value ?? '';
    if (!apiKey.trim() || !confirmedPersonalUse) {
      setMessage({ tone: 'error', text: tc('invalidInput') });
      return;
    }
    try {
      setAction('local-test');
      setMessage(null);
      setLocalTestResult(null);
      const identity = await getFirebaseApiIdentity();
      if (!identity || identity.userId !== requestedUserId) throw new Error('Authentication required.');
      const response = await fetch('/api/financial-data/tiingo/local-test', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${identity.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey }),
      });
      const payload = await response.json().catch(() => null) as {
        code?: string;
        data?: Array<{ date?: unknown; close?: unknown }>;
      } | null;
      if (activeUserIdRef.current !== requestedUserId) return;
      if (!response.ok) {
        const errorText = payload?.code && payload.code in STATUS_KEYS
          ? tc(STATUS_KEYS[payload.code as TiingoBrowserStatus])
          : response.status === 404 ? tc('localOnly')
            : response.status === 400 ? tc('invalidInput')
              : response.status === 401 ? tc('authRequired')
                : tc('providerUnavailable');
        setMessage({ tone: 'error', text: errorText });
        return;
      }
      const latest = payload?.data?.at(-1);
      if (payload?.data === undefined || !latest || typeof latest.date !== 'string' || typeof latest.close !== 'number' || !Number.isFinite(latest.close)) {
        setMessage({ tone: 'error', text: tc('unexpectedResponse') });
        return;
      }
      setLocalTestResult({ date: latest.date.slice(0, 10), close: latest.close });
      setMessage({ tone: 'success', text: tc('localTestSuccess') });
    } catch {
      if (activeUserIdRef.current === requestedUserId) {
        setMessage({ tone: 'error', text: tc('providerUnavailable') });
      }
    } finally {
      // The local test is intentionally one-shot: erase the input regardless
      // of provider outcome and never copy it into session/provider storage.
      if (activeUserIdRef.current === requestedUserId) {
        if (keyInputRef.current) keyInputRef.current.value = '';
        setHasKeyInput(false);
        setAction(null);
      }
    }
  };

  const disconnect = () => {
    clearTiingoBrowserCredential();
    if (keyInputRef.current) keyInputRef.current.value = '';
    setHasKeyInput(false);
    setMessage({ tone: 'success', text: tc('cleared') });
  };

  const clearCache = () => {
    if (!window.confirm(tc('oldCachePrompt'))) return;
    setAction('clear');
    clearAlphaVantageNormalizedCache(providerUser.id);
    setMessage({ tone: 'success', text: tc('oldCacheCleared') });
    setAction(null);
  };

  const removeLegacyConnection = async () => {
    const requestedUserId = providerUser.id;
    if (!window.confirm(t('Remove the previously stored Tiingo key?'))) return;
    try {
      setAction('legacy-delete');
      // A token acquired after a user switch must never delete the new
      // account's key for a confirmation given in the previous workspace.
      const identity = await getFirebaseApiIdentity();
      if (activeUserIdRef.current !== requestedUserId) return;
      if (!identity || identity.userId !== requestedUserId) {
        throw new Error('Authentication changed during the request.');
      }
      const response = await fetch('/api/financial-data/providers?id=tiingo', {
        method: 'DELETE',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${identity.token}` },
      });
      const payload = await response.json().catch(() => null);
      if (activeUserIdRef.current !== requestedUserId) return;
      if (!response.ok) throw new Error(responseMessage(payload, 'Could not remove the previously stored Tiingo key.'));
      setScopedLegacyProvider(null);
      setMessage({ tone: 'success', text: 'The previously stored Tiingo key was removed.' });
    } catch (error) {
      if (activeUserIdRef.current !== requestedUserId) return;
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not remove the previously stored Tiingo key.' });
    } finally {
      if (activeUserIdRef.current === requestedUserId) setAction(null);
    }
  };

  const openDemoSnapshot = async () => {
    try {
      setAction('demo');
      await signOut();
      writeAnonymousWorkspaceMode('demo_snapshot');
      router.replace('/');
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not open the Demo Snapshot. Your Cloud Workspace was not changed.' });
      setAction(null);
    }
  };

  return (
    <section className="card financial-provider-manager" aria-labelledby="financial-provider-title">
      <div className="panel-header financial-provider-header">
        <div>
          <div className="section-title" id="financial-provider-title">{t('Financial Data Providers')}</div>
          <div className="panel-subtitle">{tc('intro')}</div>
        </div>
        <span className={`badge ${connected ? 'badge-green' : 'badge-neutral'} financial-provider-status`}>
          {connected ? <CheckCircle2 size={13} aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
          {t(connected ? 'Connected for this tab' : 'Session key required')}
        </span>
      </div>

      <div className="financial-provider-card">
        <div className="financial-provider-icon" aria-hidden="true"><DatabaseZap size={19} /></div>
        <div className="financial-provider-copy">
          <div className="financial-provider-name">
            <bdi dir="ltr">{tc('brand')}</bdi>{' '}
            <span className="badge badge-neutral">{t('Session-only API key')}</span>{' '}
            <span className="badge badge-blue">{t('Raw daily close')}</span>
          </div>
          <p>{tc('source')}</p>
          {INVESTATLAS_DEPLOYMENT_MODE === 'legacy' && <p>{tc('goldSource')}</p>}
          <div className="financial-provider-links">
              <a href="https://www.tiingo.com" target="_blank" rel="noreferrer">{tc('attribution')} <ExternalLink size={12} aria-hidden="true" /></a>
            <a href="https://api.tiingo.com/account/api/token" target="_blank" rel="noreferrer">{t('Get an API key')} <ExternalLink size={12} aria-hidden="true" /></a>
            <a href="https://www.tiingo.com/documentation/end-of-day" target="_blank" rel="noreferrer">{t('API documentation')} <ExternalLink size={12} aria-hidden="true" /></a>
            <a href="https://www.tiingo.com/documentation/appendix/developers" target="_blank" rel="noreferrer">{t('Plan and limits')} <ExternalLink size={12} aria-hidden="true" /></a>
            <a href="https://app.tiingo.com/tos/" target="_blank" rel="noreferrer">{t('Terms of Service')} <ExternalLink size={12} aria-hidden="true" /></a>
            <a href="https://www.tiingo.com/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')} <ExternalLink size={12} aria-hidden="true" /></a>
          </div>
        </div>
      </div>

      {message ? (
        <div className={`financial-provider-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          {message.tone === 'error' ? <TriangleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{t(message.text)}</span>
        </div>
      ) : null}

      <div className="financial-provider-connected">
        <div>
          <div className="financial-provider-key">{tc('quota')}: <bdi dir="ltr">{budget.used}/{budget.limit}</bdi></div>
          <div className="financial-provider-meta">{tc('quotaDetail')}</div>
          {cachedSymbols.length > 0 ? (
            <div className="financial-provider-capabilities" aria-label={t('Cached personal symbols')}>
              <span className="badge badge-neutral">{tc('oldCache')}</span>
              {cachedSymbols.map((symbol) => <bdi className="badge badge-blue" dir="ltr" key={symbol}>{symbol}</bdi>)}
            </div>
          ) : null}
        </div>
        <div className="financial-provider-actions">
          {connected ? <button type="button" className="btn btn-secondary btn-sm" onClick={disconnect} disabled={action !== null}><Trash2 size={14} aria-hidden="true" /> {t('Remove session key')}</button> : null}
          {cachedSymbols.length > 0 ? (
            <button type="button" className="btn btn-secondary btn-sm financial-provider-delete" onClick={clearCache} disabled={action !== null}>
              {action === 'clear' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {tc('oldCache')}
            </button>
          ) : null}
        </div>
      </div>

      {!connected ? (
        <form className="financial-provider-form" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <label className="label" htmlFor="tiingo-api-token">{tc('keyLabel')}</label>
          <input
            id="tiingo-api-token"
            ref={keyInputRef}
            className="input financial-provider-key-input"
            type="password"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={512}
            placeholder={tc('keyPlaceholder')}
            onInput={(event) => setHasKeyInput(Boolean(event.currentTarget.value.trim()))}
          />
          <label className="financial-provider-consent">
            <input type="checkbox" checked={confirmedPersonalUse} onChange={(event) => setConfirmedPersonalUse(event.target.checked)} />
            <span>{tc('consent')}</span>
          </label>
          <div className="financial-provider-security">
            <ShieldCheck size={15} aria-hidden="true" />
            {tc('security')}
          </div>
          {process.env.NODE_ENV === 'development' && !isLocalPersonal ? (
            <div className="financial-provider-meta">
              <b>{tc('localTestLabel')}</b>
              <div>{tc('localTestHelp')}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void testLocalServer()} disabled={action !== null || !hasKeyInput || !confirmedPersonalUse}>
                {action === 'local-test' ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} aria-hidden="true" />}
                {tc('localTestButton')}
              </button>
            </div>
          ) : null}
          {localTestResult ? (
            <div className="financial-provider-meta" role="status">
              {tc('localTestResult')}: <bdi dir="ltr">{tc('symbolAapl')}{' · '}{localTestResult.date}{' · '}{tc('currencyUsd')}{' '}{localTestResult.close}</bdi>
            </div>
          ) : null}
          <div className="financial-provider-meta">{tc('rights')}</div>
          <div className="financial-provider-meta">{t('Reloading, closing the tab, signing out, switching accounts, or restarting the PWA removes the key. You must reconnect it to refresh data.')}</div>
          <div className="financial-provider-actions">
            <button type="submit" className="btn btn-primary" disabled={action !== null || !confirmedPersonalUse || !hasKeyInput}>
              {action === 'connect' ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              {t(action === 'connect' ? 'Testing and connecting…' : 'Connect and test for this tab')}
            </button>
          </div>
        </form>
      ) : (
        <div className="financial-provider-message notice" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{tc('notice')}</span>
        </div>
      )}

      {legacyProvider ? (
        <div className="financial-provider-connected">
          <div>
            <div className="financial-provider-key">{t('Legacy Tiingo vault key')}: <bdi dir="ltr">{legacyProvider.maskedKey}</bdi></div>
            <div className="financial-provider-meta">{t('This hosted deployment cannot use the old Tiingo connector. The encrypted legacy key can only be removed.')}</div>
          </div>
          <div className="financial-provider-actions">
            <button type="button" className="btn btn-secondary btn-sm financial-provider-delete" onClick={() => void removeLegacyConnection()} disabled={action !== null}>
              {action === 'legacy-delete' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {t('Remove stored key')}
            </button>
          </div>
        </div>
      ) : null}

      {!isLocalPersonal && <div className="financial-provider-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDemoSnapshot()} disabled={action !== null}>
          {action === 'demo' ? <LoaderCircle className="spin" size={14} /> : null} {t(action === 'demo' ? 'Opening Demo Snapshot…' : 'Sign out and explore Demo Snapshot')}
        </button>
      </div>}
    </section>
  );
}

