'use client';

import { useEffect, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  PUBLIC_SOURCE_CONSENT_EVENT,
  readPublicSourceConsent,
  setPublicSourceConsent,
  type PublicSourceId,
} from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { publicMarketCopy } from './public-market-consent-copy';

const OPTIONS: readonly PublicSourceId[] = ['yahoo', 'spot', 'coinpaprika', 'coingecko', 'binance', 'kraken', 'bullion'];
const RECOMMENDED: PublicSourceId[] = ['yahoo', 'spot', 'coinpaprika', 'coingecko', 'binance'];
const TERMS: Record<PublicSourceId, string> = {
  yahoo: 'https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html',
  spot: 'https://gold-api.com/',
  coinpaprika: 'https://coinpaprika.com/api-terms-of-use/',
  coingecko: 'https://www.coingecko.com/en/api_terms',
  binance: 'https://developers.binance.com/en/docs/products/spot/rest-api',
  kraken: 'https://www.kraken.com/legal',
  bullion: 'https://standardbullion.com/market-data',
};

export function PublicMarketSessionConsent({ owner }: { owner: string }) {
  const { language } = useAppTranslation();
  const text = (key: Parameters<typeof publicMarketCopy>[1]) => publicMarketCopy(language, key);
  const [active, setActive] = useState<PublicSourceId[]>(() => readPublicSourceConsent(owner));
  const [selected, setSelected] = useState<PublicSourceId[]>(() => {
    const stored = readPublicSourceConsent(owner);
    return stored.length ? stored : RECOMMENDED;
  });
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const sync = () => setActive(readPublicSourceConsent(owner));
    sync();
    window.addEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
  }, [owner]);

  function apply() {
    if (selected.length > 0 && !agreed) return;
    const preferences = readSourceSelection(owner);
    saveSourceSelection(owner, {
      ...preferences,
      yahoo: selected.includes('yahoo'),
      spot: selected.includes('spot'),
      coinpaprika: selected.includes('coinpaprika'),
      coingecko: selected.includes('coingecko'),
      binance: selected.includes('binance'),
      kraken: selected.includes('kraken'),
      bullion: selected.includes('bullion'),
    });
    setPublicSourceConsent(owner, selected);
    setActive(readPublicSourceConsent(owner));
    setAgreed(false);
  }

  return (
    <section className="card" aria-label={text('sectionTitle')} style={{ display: 'grid', gap: 12 }}>
      <h3 className="section-title">{text('sectionTitle')}</h3>
      <p className="panel-subtitle">{text('intro')}</p>
      <p role="status" className="panel-subtitle">
        {active.length ? `${text('active')} ${active.join(', ')}` : text('inactive')}
      </p>
      {OPTIONS.map((source) => (
        <label className="financial-provider-consent" key={source}>
          <input
            type="checkbox"
            checked={selected.includes(source)}
            onChange={(event) => setSelected((previous) =>
              event.target.checked ? [...previous, source] : previous.filter((id) => id !== source))}
          />
          <span>{text(source)}{' '}<a href={TERMS[source]} target="_blank" rel="noreferrer">({source})</a></span>
        </label>
      ))}
      <p className="panel-subtitle">{text('yahooNotice')}</p>
      <label className="financial-provider-consent">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>{text('terms')}</span>
      </label>
      <button type="button" className="btn btn-primary" disabled={selected.length > 0 ? !agreed : active.length === 0} onClick={apply}>
        {text(active.length ? 'update' : 'activate')}
      </button>
      <p className="panel-subtitle">{text('sessionNote')}</p>
      <p className="panel-subtitle">{text('providerNote')}</p>
    </section>
  );
}
