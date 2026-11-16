'use client';

import { useEffect, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import {
  PUBLIC_SOURCE_CONSENT_EVENT, readPublicSourceConsent, type PublicSourceId,
} from '@/lib/financial-data/providers/public-source-consent';

/** Visible credits accompany personal prices on every screen, including mobile. */
export function PersonalPriceAttribution({ owner }: { owner: string | null }) {
  const { t } = useAppTranslation();
  const [sources, setSources] = useState<PublicSourceId[]>([]);
  useEffect(() => {
    const sync = () => setSources(owner ? readPublicSourceConsent(owner) : []);
    sync();
    window.addEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(PUBLIC_SOURCE_CONSENT_EVENT, sync);
  }, [owner]);
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud' && INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal') return null;
  return <div className="financial-data-attribution" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
    {sources.includes('coinpaprika') && <a href="https://coinpaprika.com/" target="_blank" rel="noreferrer">{t('Powered by CoinPaprika')}</a>}
    {sources.includes('coingecko') && <a href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">{t('Powered by CoinGecko')}</a>}
  </div>;
}
