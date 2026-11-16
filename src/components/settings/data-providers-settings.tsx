'use client';

import {
  Database,
  ExternalLink,
  Globe,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  FinancialCapability,
} from '@/lib/financial-data/contracts';
import type {
  FinancialDataProviderDescriptor,
  PublicDisplayStatus,
} from '@/lib/financial-data/providers/catalog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface DataProvidersSettingsProps {
  providers: FinancialDataProviderDescriptor[];
}

const CAPABILITY_LABELS: Record<FinancialCapability, string> = {
  quote: 'Quotes',
  history: 'History',
  fx: 'FX',
  fundamentals: 'Fundamentals',
  earnings: 'Earnings',
  news: 'News',
  events: 'Events',
};

const RIGHTS_LABELS: Record<PublicDisplayStatus, string> = {
  allowed: 'Approved for public demo',
  review_required: 'Rights review required',
  permission_required: 'Permission required',
};

export default function DataProvidersSettings({
  providers,
}: DataProvidersSettingsProps) {
  const { t, language } = useAppTranslation();
  const locale = language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US';
  const orderedProviders = [...providers].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return left.name.localeCompare(right.name, locale);
  });

  return (
    <div className="animate-in">
      <div className="card" id="data-sources">
        <div
          className="panel-header"
          style={{
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div>
            <div className="section-title">{t('Public financial provider catalog')}</div>
            <div className="panel-subtitle">
              {t('Review hosted data-source capabilities, source limitations, and public-display status.')}
            </div>
          </div>
          <span
            className="badge badge-green"
            style={{
              alignItems: 'center',
              display: 'inline-flex',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            {t('Read-only provider catalog')}
          </span>
        </div>

        <div
          style={{
            background: 'var(--surface-soft)',
            border: '1px solid var(--surface-border-soft)',
            borderRadius: 14,
            color: 'var(--text-secondary)',
            fontSize: 13,
            lineHeight: 1.55,
            marginBottom: 20,
            padding: '12px 14px',
          }}
        >
          {t('Public endpoint access does not automatically grant public-display or redistribution rights.')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orderedProviders.map((provider) => {
            const availabilityLabel = provider.availability === 'active'
              ? 'Active'
              : provider.availability === 'local_only'
                ? 'Local engineering only'
                : 'Disabled';
            const reviewedAt = new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeZone: 'UTC',
            }).format(new Date(`${provider.reviewedAt}T00:00:00Z`));
            const rightsClass = provider.publicDisplayStatus === 'allowed'
              ? 'badge-green'
              : provider.publicDisplayStatus === 'permission_required'
                ? 'badge-red'
                : 'badge-neutral';
            const RightsIcon = provider.publicDisplayStatus === 'allowed'
              ? ShieldCheck
              : ShieldAlert;

            return (
              <div
                className="card"
                key={provider.id}
                style={{
                  alignItems: 'flex-start',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--surface-border-strong)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 14,
                  opacity: provider.isActive ? 1 : 0.78,
                  padding: '14px 16px',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    alignItems: 'center',
                    background: 'var(--surface-soft)',
                    border: '1px solid var(--surface-border-soft)',
                    borderRadius: 10,
                    color: provider.byokOnly
                      ? 'var(--accent-teal)'
                      : 'var(--accent-blue)',
                    display: 'flex',
                    height: 36,
                    justifyContent: 'center',
                    width: 36,
                  }}
                >
                  {provider.byokOnly ? <KeyRound size={18} /> : <Globe size={18} />}
                </div>

                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <span dir="auto" style={{ fontSize: 14, fontWeight: 700 }}>
                      {provider.name}
                    </span>
                    <span className={`badge ${provider.availability === 'active' ? 'badge-blue' : 'badge-neutral'}`}>
                      {t(availabilityLabel)}
                    </span>
                    {provider.byokOnly ? (
                      <span className="badge badge-neutral">{t('BYOK only')}</span>
                    ) : null}
                  </div>

                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      lineHeight: 1.45,
                      marginTop: 5,
                    }}
                  >
                    {t(provider.description)}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 10,
                    }}
                  >
                    {provider.capabilities.map((capability) => (
                      <span className="badge badge-neutral" key={capability}>
                        {t(CAPABILITY_LABELS[capability])}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    alignItems: 'flex-end',
                    display: 'flex',
                    flex: '0 1 auto',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <span
                    className={`badge ${rightsClass}`}
                    style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}
                  >
                    <RightsIcon size={12} aria-hidden="true" />
                    {t(RIGHTS_LABELS[provider.publicDisplayStatus])}
                  </span>
                  <a
                    aria-label={`${provider.name}: ${t('Terms reviewed')} ${reviewedAt}`}
                    href={provider.termsUrl}
                    rel="noreferrer"
                    target="_blank"
                    style={{
                      alignItems: 'center',
                      color: 'var(--text-muted)',
                      display: 'inline-flex',
                      fontSize: 11,
                      gap: 5,
                    }}
                  >
                    {t('Terms reviewed')} {reviewedAt}
                    <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </div>
              </div>
            );
          })}

          {orderedProviders.length === 0 ? (
            <div
              style={{
                alignItems: 'center',
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 8,
                padding: 16,
              }}
            >
              <Database size={16} aria-hidden="true" />
              {t('Provider catalog unavailable')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
