'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import Dialog from '@/components/ui/dialog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import {
  readLegalAcceptance,
  recordLegalAcceptance,
} from '@/lib/legal/legal-acceptance';

export function LegalAcceptanceGate() {
  const { t } = useAppTranslation();
  const [accepted, setAccepted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setAccepted(Boolean(readLegalAcceptance()));
  }, []);

  const acceptAndContinue = () => {
    if (!confirmed) return;
    recordLegalAcceptance();
    setAccepted(true);
  };

  return (
    <Dialog
      open={!accepted}
      onClose={() => undefined}
      closeOnBackdrop={false}
      closeOnEscape={false}
      className="legal-gate-overlay"
      contentClassName="legal-gate-dialog"
      labelledBy="legal-gate-title"
      describedBy="legal-gate-description"
    >
      <div className="legal-gate-icon" aria-hidden="true">
        <ShieldCheck size={22} />
      </div>
      <h2 id="legal-gate-title">{t('Review and accept')}</h2>
      <p id="legal-gate-description">
        {INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
          ? t('You are using the Local Workspace. Portfolio entries stay in this browser, while asset symbols may be sent to market-data providers to retrieve prices.')
          : INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud'
            ? t('This is a private installation. Your hosting, Firebase and API providers are configured separately; review their terms before continuing.')
            : t('InvestAtlas is a public Demo. Review the terms, privacy information, and financial-data limitations before continuing.')}
      </p>
      <label className="legal-gate-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>{t('I have read and agree to the current Terms of Service and Privacy Policy.')}</span>
      </label>
      <nav className="legal-gate-links" aria-label={t('Legal and data information')}>
        <Link href="/terms" target="_blank" rel="noreferrer">{t('Terms of Service')}</Link>
        <Link href="/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')}</Link>
        <Link href="/financial-data-disclaimer" target="_blank" rel="noreferrer">{t('Financial Data Disclaimer')}</Link>
      </nav>
      <button
        type="button"
        className="btn btn-primary legal-gate-accept"
        disabled={!confirmed}
        onClick={acceptAndContinue}
      >
        {t('Accept and continue')}
      </button>
    </Dialog>
  );
}
