'use client';

import Link from 'next/link';
import { Gem, ArrowLeft } from 'lucide-react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  getLegalDocument,
  type LegalDocumentKind,
} from '@/lib/legal/product-legal';

const RELATED_DOCUMENTS: Array<{ kind: LegalDocumentKind; href: string }> = [
  { kind: 'terms', href: '/terms' },
  { kind: 'privacy', href: '/privacy' },
  { kind: 'financial-data', href: '/financial-data-disclaimer' },
];

const PRODUCT_NAME = 'InvestAtlas';

export function LegalDocumentPage({ kind }: { kind: LegalDocumentKind }) {
  const { language } = useAppTranslation();
  const document = getLegalDocument(kind, language);
  const isRtl = language === 'ar';

  return (
    <main className="legal-page" lang={language} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="legal-page-ambient" aria-hidden="true" />
      <div className="legal-page-container">
        <header className="legal-page-header">
          <Link href="/" className="legal-brand" aria-label={document.backText}>
            <span className="legal-brand-icon"><Gem size={20} /></span>
            <span>{PRODUCT_NAME}</span>
          </Link>
          <span className="legal-demo-badge">{document.demoLabel}</span>
        </header>

        <article className="legal-document">
          <div className="legal-document-intro">
            <Link href="/" className="legal-back-link">
              <ArrowLeft size={16} aria-hidden="true" />
              <span>{document.backText}</span>
            </Link>
            <h1>{document.documentTitle}</h1>
            <p className="legal-summary">{document.summaryText}</p>
            <p className="legal-updated">{document.lastUpdatedText}</p>
          </div>

          <div className="legal-sections">
            {document.sections.map((section) => (
              <section key={section.sectionName} className="legal-section">
                <h2>{section.sectionName}</h2>
                {section.blocks.map((block) => <p key={block}>{block}</p>)}
                {section.bulletItems && (
                  <ul>
                    {section.bulletItems.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
                {section.links && (
                  <div className="legal-external-links">
                    {section.links.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                        {link.linkText}
                      </a>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </article>

        <footer className="legal-related">
          <strong>{document.relatedText}</strong>
          <nav aria-label={document.relatedText}>
            {RELATED_DOCUMENTS.filter((item) => item.kind !== kind).map((item) => (
              <Link key={item.kind} href={item.href}>
                {getLegalDocument(item.kind, language).documentTitle}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </main>
  );
}
