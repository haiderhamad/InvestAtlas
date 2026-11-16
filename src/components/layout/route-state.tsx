'use client';

import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { AlertTriangle, Compass, LoaderCircle } from 'lucide-react';
import Link from 'next/link';

type RouteStateKind = 'loading' | 'error' | 'not-found';

type RouteStateProps = {
  kind: RouteStateKind;
  onRetry?: () => void;
};

const CONTENT: Record<RouteStateKind, { title: string; description: string }> = {
  loading: {
    title: 'Loading InvestAtlas',
    description: 'Preparing your workspace.',
  },
  error: {
    title: 'Something went wrong',
    description: 'InvestAtlas could not load this page. Your saved data was not deleted.',
  },
  'not-found': {
    title: 'Page not found',
    description: 'The requested InvestAtlas page does not exist or is no longer available.',
  },
};

export default function RouteState({ kind, onRetry }: RouteStateProps) {
  const { t } = useAppTranslation();
  const content = CONTENT[kind];
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'error' ? AlertTriangle : Compass;
  const isLoading = kind === 'loading';

  return (
    <div className="route-state-page">
      <section
        className="route-state-card"
        role={kind === 'error' ? 'alert' : 'status'}
        aria-live={kind === 'error' ? 'assertive' : 'polite'}
        aria-busy={isLoading || undefined}
      >
        <span className={`route-state-icon ${isLoading ? 'is-loading' : ''}`} aria-hidden="true">
          <Icon size={26} />
        </span>
        <h1 className="route-state-title">{t(content.title)}</h1>
        <p className="route-state-description">{t(content.description)}</p>
        {!isLoading ? (
          <div className="route-state-actions">
            {kind === 'error' && onRetry ? (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                {t('Try again')}
              </button>
            ) : null}
            <Link href="/" className={kind === 'error' ? 'btn btn-secondary' : 'btn btn-primary'}>
              {t('Back to dashboard')}
            </Link>
            {kind === 'not-found' ? (
              <Link href="/portfolio" className="btn btn-secondary">
                {t('Open Portfolio')}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
