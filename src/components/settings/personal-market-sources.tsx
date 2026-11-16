'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  readSourceSelection, saveSourceSelection, SOURCE_CHANGE, TIINGO_CONNECTABLE,
  type SourceSelection,
} from '@/lib/financial-data/providers/source-selection';
import { clearTwelve, connectTwelve, hasTwelve } from '@/lib/financial-data/providers/twelve-personal';
import { PublicMarketSessionConsent } from './public-market-session-consent';
import { MarketDataProviderConnection } from './marketdata-provider-connection';
import { publicMarketCopy } from './public-market-consent-copy';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { PersonalHistorySettings } from './personal-history-settings';

const brands = { twelve: 'Twelve Data', tiingo: 'Tiingo', marketdata: 'Market Data API', eodhd: 'EODHD' } as const;

export function PersonalMarketSources({ owner }: { owner: string }) {
  const { t, language } = useAppTranslation();
  const [prefs, setPrefs] = useState(() => readSourceSelection(owner));
  const [connected, setConnected] = useState(() => hasTwelve(owner));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const key = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const sync = () => { setPrefs(readSourceSelection(owner)); setConnected(hasTwelve(owner)); };
    sync();
    window.addEventListener(SOURCE_CHANGE, sync);
    window.addEventListener('storage', sync);
    return () => {
      request.current?.abort();
      window.removeEventListener(SOURCE_CHANGE, sync);
      window.removeEventListener('storage', sync);
    };
  }, [owner]);

  function update(value: Partial<SourceSelection>) {
    const next = { ...readSourceSelection(owner), ...value };
    saveSourceSelection(owner, next);
    setPrefs(next);
  }

  async function connect() {
    if (!consent || busy || !key.current?.value.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    const raw = key.current.value;
    key.current.value = '';
    setHasInput(false);
    try {
      await connectTwelve(owner, raw, controller.signal);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="card" id="data-sources" style={{ display: 'grid', gap: 14 }}>
      <h3 className="section-title">{t('My market data')}</h3>
      {(INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' || INVESTATLAS_DEPLOYMENT_MODE === 'local_personal')
        && <PublicMarketSessionConsent owner={owner} />}
      <section aria-label={publicMarketCopy(language, 'coverageTitle')} style={{ display: 'grid', gap: 8 }}>
        <h4 className="section-title">{publicMarketCopy(language, 'coverageTitle')}</h4>
        {(['coverageStocks', 'coverageStockBackup', 'coverageCrypto', 'coverageCryptoBackup',
          'coverageMetals', 'coverageMetalBackup', 'coverageTiming'] as const).map(key => (
          <p className="panel-subtitle" key={key}>{publicMarketCopy(language, key)}</p>
        ))}
      </section>
      <label className="financial-provider-consent"><input type="checkbox" checked={prefs.fx}
        onChange={e => update({ fx: e.target.checked })} />{t('ECB reference rates for converting market prices to EUR')}</label>

      {INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && <label className="financial-provider-consent"><input type="checkbox" checked={prefs.twelveDemo}
        onChange={e => update({ twelveDemo: e.target.checked })} />{t('Twelve Data official AAPL demo history (development only, not for portfolio valuation)')}</label>}
      <p className="panel-subtitle">{t('Your browser contacts each enabled exchange directly, including your IP address and requested symbols. Review its terms before enabling. Exchange data does not provide stock or ETF quotes.')}</p>
      <div className="financial-provider-links">
        <a href="https://developers.binance.com/en/docs/products/spot/rest-api" target="_blank" rel="noreferrer">{t('Binance market data documentation')}</a>
        <a href="https://www.kraken.com/legal" target="_blank" rel="noreferrer">{t('Kraken terms')}</a>
      </div>
      <p className="panel-subtitle">{t('Without a connected key, only enabled public sources are used. A spot quote does not provide chart history.')}</p>
      <label>{t('When several sources can supply a price')}
        <select className="input" value={prefs.publicFirst ? 'public' : 'personal'} onChange={e => update({ publicFirst: e.target.value === 'public' })}>
          <option value="public">{t('Public sources first')}</option><option value="personal">{t('My connections first')}</option>
        </select>
      </label>
      {(TIINGO_CONNECTABLE || INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud') && <label>{t('Preferred personal connection')}
        <select className="input" value={prefs.preferred} onChange={e => update({ preferred: e.target.value === 'eodhd' ? 'eodhd' : e.target.value === 'marketdata' ? 'marketdata' : e.target.value === 'twelve' ? 'twelve' : 'tiingo' })}>
          <option value="tiingo">{brands.tiingo}</option><option value="twelve">{brands.twelve}</option><option value="marketdata">{brands.marketdata}</option><option value="eodhd">{brands.eodhd}</option>
        </select>
      </label>}
      <fieldset className="financial-provider-form" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <legend><bdi dir="ltr">{brands.twelve}</bdi></legend>
        <p>{publicMarketCopy(language, 'twelveCoverage')}</p>
        {connected ? <>
          <span role="status">{t('Connected for this tab')}</span>
          <button className="btn btn-secondary" type="button" onClick={() => { clearTwelve(); setConsent(false); }}>{t('Disconnect Twelve Data')}</button>
        </> : <>
          <label>{t('Personal Twelve Data API key')}
            <input className="input" type="password" ref={key} autoComplete="off" autoCapitalize="none" spellCheck={false}
              maxLength={256} dir="ltr" disabled={busy} onInput={e => setHasInput(!!e.currentTarget.value.trim())} />
          </label>
          <label className="financial-provider-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />
            {t('My plan permits personal display of these data. Test my key directly with Twelve Data and keep it only in this tab.')}
          </label>
          <a href="https://twelvedata.com/terms" target="_blank" rel="noreferrer">{t('Twelve Data terms')}</a>
          <button className="btn btn-primary" type="button" disabled={!hasInput || !consent || busy} onClick={connect}>
            {busy ? t('Testing and connecting…') : t('Test and connect Twelve Data')}
          </button>
          {failed && <p role="alert">{t('Could not verify the connection. Check the key, plan, quota and network.')}</p>}
        </>}
      </fieldset>
      <MarketDataProviderConnection owner={owner} />
      <label className="financial-provider-consent"><input type="checkbox" checked={prefs.historyPreload !== false} onChange={e => update({ historyPreload:e.target.checked })} /><span>{language === 'de' ? 'Nach den sichtbaren Kursen bis zu acht passende Titel im Hintergrund mit EODHD vorladen. Nur mit verbundenem Schlüssel und innerhalb seines Kontingents.' : language === 'ar' ? 'تحميل سجل ما يصل إلى ثمانية أصول مطابقة في الخلفية عبر EODHD بعد عرض الأسعار، فقط عند ربط المفتاح وضمن حصته.' : 'After visible prices, preload history for up to eight matching assets with EODHD in the background, only with a connected key and within its quota.'}</span></label>
      <PersonalHistorySettings key={owner} owner={owner} />
    </section>
  );
}
