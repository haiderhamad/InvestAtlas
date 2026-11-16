'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  clearMarketData, connectMarketData, hasMarketData,
} from '@/lib/financial-data/providers/marketdata-personal';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { publicMarketCopy } from './public-market-consent-copy';

export function MarketDataProviderConnection({ owner }: { owner: string }) {
  const { language } = useAppTranslation();
  const copy = (key: Parameters<typeof publicMarketCopy>[1]) => publicMarketCopy(language, key);
  const input = useRef<HTMLInputElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [connected, setConnected] = useState(() => hasMarketData(owner));
  const [consent, setConsent] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sync = () => setConnected(hasMarketData(owner));
    sync();
    window.addEventListener(SOURCE_CHANGE, sync);
    return () => {
      activeRequest.current?.abort();
      window.removeEventListener(SOURCE_CHANGE, sync);
    };
  }, [owner]);

  async function connect() {
    if (!consent || !hasInput || busy || !input.current) return;
    const token = input.current.value;
    input.current.value = '';
    setHasInput(false);
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      await connectMarketData(owner, token, controller.signal);
      if (!controller.signal.aborted) setConnected(hasMarketData(owner));
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <fieldset className="financial-provider-form" style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <legend><strong>{copy('marketdataTitle')}</strong></legend>
      <p>{copy('marketdataInfo')}</p>
      <a href="https://www.marketdata.app/docs/api/cors/" target="_blank" rel="noreferrer">
        {copy('marketdataTerms')}
      </a>
      {connected ? (
        <>
          <p role="status">{copy('marketdataConnected')}</p>
          <button className="btn btn-secondary" type="button" onClick={() => { clearMarketData(); setConsent(false); }}>
            {copy('marketdataDisconnect')}
          </button>
        </>
      ) : (
        <>
          <label>{copy('marketdataKey')}
            <input className="input" ref={input} type="password" dir="ltr"
              autoComplete="off" autoCapitalize="none" spellCheck={false}
              maxLength={2048} disabled={busy}
              onInput={(event) => setHasInput(Boolean(event.currentTarget.value.trim()))} />
          </label>
          <label className="financial-provider-consent">
            <input type="checkbox" disabled={busy} checked={consent}
              onChange={(event) => setConsent(event.target.checked)} />
            <span>{copy('marketdataConsent')}</span>
          </label>
          <p>{copy('marketdataSecurity')}</p>
          <button className="btn btn-primary" type="button"
            disabled={!consent || !hasInput || busy} onClick={() => void connect()}>
            {copy('marketdataConnect')}
          </button>
          {failed && <p role="alert">{copy('marketdataFailed')}</p>}
        </>
      )}
    </fieldset>
  );
}
