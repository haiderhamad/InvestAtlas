'use client';

import AppShell from '@/components/layout/app-shell';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { FileText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function ReportsPage() {
  const { t } = useAppTranslation();

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="page-title">
            <FileText size={24} style={{ display: 'inline', marginInlineEnd: 8 }} aria-hidden="true" />
            {t('Reports')}
          </h1>
        </div>
      </div>

      <div className="page-content animate-in">
        <section className="route-state-card" role="status" aria-labelledby="reports-unavailable-title">
          <span className="route-state-icon" aria-hidden="true">
            <ShieldCheck size={26} />
          </span>
          <h2 id="reports-unavailable-title" className="route-state-title">
            {t('Reports are not available in this demo release.')}
          </h2>
          <p className="route-state-description">
            {t('The legacy report generator was retired because it did not use the canonical Firebase data path. InvestAtlas will not present an empty or incomplete report as authoritative.')}
          </p>
          <p className="route-state-description">
            {t('For a portable copy of your workspace, use the bounded account data export in Settings.')}
          </p>
          <div className="route-state-actions">
            <Link href="/settings#account" className="btn btn-primary">
              {t('Open account data')}
            </Link>
            <Link href="/portfolio" className="btn btn-secondary">
              {t('Open Portfolio')}
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
