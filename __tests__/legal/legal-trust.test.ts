import fs from 'node:fs';
import path from 'node:path';
import { getLegalDocument } from '@/lib/legal/product-legal';
import { LEGAL_TERMS_VERSION } from '@/lib/legal/legal-acceptance';
import { INVESTATLAS_PUBLIC_REPOSITORY_URL } from '@/lib/product-links';

describe('public legal and financial-data trust surfaces', () => {
  it('keeps the material trilingual legal update on one acceptance version', () => {
    expect(LEGAL_TERMS_VERSION).toBe('2026-11-07');
    expect(getLegalDocument('terms', 'en').lastUpdatedText).toContain('7 November 2026');
    expect(getLegalDocument('terms', 'de').lastUpdatedText).toContain('7. November 2026');
    expect(getLegalDocument('terms', 'ar').lastUpdatedText).toContain('7 نوفمبر 2026');
  });

  it.each(['terms', 'privacy', 'financial-data'] as const)(
    'provides complete English, German, and Arabic content for %s',
    (kind) => {
      for (const language of ['en', 'de', 'ar'] as const) {
        const document = getLegalDocument(kind, language);
        expect(document.documentTitle).toBeTruthy();
        expect(document.summaryText).toBeTruthy();
        expect(document.lastUpdatedText).toBeTruthy();
        expect(document.sections.length).toBeGreaterThanOrEqual(7);
        expect(document.sections.every((section) => section.blocks.length > 0)).toBe(true);
      }
    },
  );

  it.each(['terms', 'privacy', 'financial-data'] as const)(
    'keeps German and Arabic structure synchronized with English for %s',
    (kind) => {
      const structure = (language: 'en' | 'de' | 'ar') =>
        getLegalDocument(kind, language).sections.map((section) => ({
          blockCount: section.blocks.length,
          bulletCount: section.bulletItems?.length ?? 0,
          links: (section.links ?? []).map((link) => link.url),
        }));

      expect(structure('de')).toEqual(structure('en'));
      expect(structure('ar')).toEqual(structure('en'));
    },
  );

  it('ships actual German legal bodies instead of the former English fallback', () => {
    for (const kind of ['terms', 'privacy', 'financial-data'] as const) {
      const german = getLegalDocument(kind, 'de');
      const english = getLegalDocument(kind, 'en');
      const germanText = [
        german.summaryText,
        ...german.sections.flatMap((section) => [section.sectionName, ...section.blocks]),
      ].join(' ');

      expect(germanText).not.toContain('Eine vollständige deutsche Rechtsübersetzung ist noch nicht verfügbar');
      expect(germanText).not.toBe([
        english.summaryText,
        ...english.sections.flatMap((section) => [section.sectionName, ...section.blocks]),
      ].join(' '));
    }
  });

  it('identifies CoinGecko, disclaims provider liability, and prohibits raw redistribution', () => {
    const terms = getLegalDocument('terms', 'en');
    const combinedText = terms.sections.flatMap((section) => [
      section.sectionName,
      ...section.blocks,
      ...(section.bulletItems ?? []),
    ]).join(' ');

    expect(combinedText).toContain('CoinGecko API');
    expect(combinedText).toContain('bears no responsibility or liability');
    expect(combinedText).toContain('raw data');
    expect(combinedText).toContain('redistribute');
    expect(terms.sections.flatMap((section) => section.links ?? [])).toContainEqual({
      linkText: 'CoinGecko API Terms',
      url: 'https://www.coingecko.com/en/api_terms',
    });
  });

  it('documents that analytics is disabled and browser storage remains functional', () => {
    const privacy = getLegalDocument('privacy', 'en');
    const combinedText = privacy.sections.flatMap((section) => section.blocks).join(' ');

    expect(combinedText).toContain('Google Analytics/Firebase Analytics disabled');
    expect(combinedText).toContain('This storage is functional, not advertising tracking');
  });

  it('documents Tiingo per-user server BYOK, non-persistence and data boundaries in all legal languages', () => {
    const sections = (lang: 'en' | 'de' | 'ar') =>
      (['terms', 'privacy', 'financial-data'] as const)
        .flatMap((kind) => getLegalDocument(kind, lang).sections.flatMap((section) => section.blocks))
        .join(' ');
    const english = sections('en');
    expect(english).toContain('own Tiingo API token');
    expect(english).toContain('Next.js server running on Vercel');
    expect(english).toContain('it is not logged or persisted');
    expect(english).toContain('optional one-shot test remains local-only');
    expect(english).toContain('neither raw nor normalized prices are stored persistently');
    expect(english).toContain('at most the latest 100 observations');
    expect(english).toContain('Do not share or redistribute the data');

    const arabic = sections('ar');
    expect(arabic).toContain('Vercel');
    expect(arabic).toContain('Tiingo');
    expect(arabic).toContain('لا تُحفظ');

    const german = sections('de');
    expect(german).toContain('authentifizierter Next.js-Endpunkt');
    expect(german).toContain('Tiingo');
    expect(german).toContain('nicht dauerhaft gespeichert');
  });

  it('keeps the Demo Snapshot provider-independent in English, German, and Arabic', () => {
    const english = getLegalDocument('financial-data', 'en').sections
      .flatMap((section) => section.blocks)
      .join(' ');
    const arabic = getLegalDocument('financial-data', 'ar').sections
      .flatMap((section) => section.blocks)
      .join(' ');
    const german = getLegalDocument('financial-data', 'de').sections
      .flatMap((section) => section.blocks)
      .join(' ');

    expect(english).toContain('provider-independent synthetic Demo Snapshot');
    expect(german).toContain('synthetischen Demo-Snapshot ohne Anbieterbezug');
    expect(arabic).toContain('لقطة تجريبية اصطناعية واضحة ومستقلة عن المزوّد');
  });

  it('describes the current AI boundary truthfully in every legal language', () => {
    const expectations = {
      en: {
        reviewedImport: 'reviewed document and transaction import',
        singleProvider: 'highest-priority enabled provider',
        noFallback: 'never forwarded automatically to a fallback provider',
        deterministic: 'Technical analysis remains deterministic',
        savingsPlanDisabled: 'Savings Plan AI generation is disabled',
        staleClaim: 'AI may summarize or interpret sourced and calculated inputs',
      },
      de: {
        reviewedImport: 'geprüften Dokument- und Transaktionsimport',
        singleProvider: 'aktivierten Anbieter mit der höchsten Priorität',
        noFallback: 'niemals automatisch an einen Ersatzanbieter weitergegeben',
        deterministic: 'Die technische Analyse bleibt deterministisch',
        savingsPlanDisabled: 'KI-Erzeugung von Sparplänen ist deaktiviert',
        staleClaim: 'KI kann bezogene und berechnete Eingaben zusammenfassen oder einordnen',
      },
      ar: {
        reviewedImport: 'مسار استيراد المستندات والمعاملات الذي خضع للمراجعة',
        singleProvider: 'المزوّد المفعّل ذي الأولوية الأعلى فقط',
        noFallback: 'لا يحوّل InvestAtlas المستند تلقائيًا إلى مزوّد بديل',
        deterministic: 'يبقى التحليل الفني حتميًا',
        savingsPlanDisabled: 'توليد خطة الادخار بالذكاء الاصطناعي معطّل',
        staleClaim: 'يمكن للذكاء الاصطناعي تلخيص المدخلات المصدرية والمحسوبة أو تفسيرها',
      },
    } as const;

    for (const language of ['en', 'de', 'ar'] as const) {
      const combined = (['terms', 'privacy', 'financial-data'] as const)
        .flatMap((kind) => {
          const document = getLegalDocument(kind, language);
          return [
            document.summaryText,
            ...document.sections.flatMap((section) => [
              section.sectionName,
              ...section.blocks,
              ...(section.bulletItems ?? []),
            ]),
          ];
        })
        .join(' ');

      expect(combined).toContain(expectations[language].reviewedImport);
      expect(combined).toContain(expectations[language].singleProvider);
      expect(combined).toContain(expectations[language].noFallback);
      expect(combined).toContain(expectations[language].deterministic);
      expect(combined).toContain(expectations[language].savingsPlanDisabled);
      expect(combined).not.toContain(expectations[language].staleClaim);
    }
  });

  it('routes public GitHub links to the confirmed public repository', () => {
    for (const language of ['en', 'de', 'ar'] as const) {
      for (const kind of ['terms', 'privacy'] as const) {
        const githubLinks = getLegalDocument(kind, language).sections
          .flatMap((section) => section.links ?? [])
          .filter((link) => link.url.includes('github.com'));

        expect(githubLinks).not.toHaveLength(0);
        expect(githubLinks.every((link) => link.url === INVESTATLAS_PUBLIC_REPOSITORY_URL)).toBe(true);
      }
    }

    const helpSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'settings', 'help-about-settings.tsx'),
      'utf8',
    );
    expect(helpSource).toContain('INVESTATLAS_PUBLIC_REPOSITORY_URL');
    expect(helpSource).not.toContain('InvestAtlas-Private');
  });

  it('links signup and Google continuation to the actual legal routes', () => {
    const loginSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'login', 'page.tsx'),
      'utf8',
    );

    expect(loginSource).toContain('acceptedLegalTerms');
    expect(loginSource).toContain('href="/terms"');
    expect(loginSource).toContain('href="/privacy"');
    expect(loginSource).toContain('href="/financial-data-disclaimer"');
    expect(loginSource).toContain('!acceptedLegalTerms');
    expect(loginSource).toContain('recordLegalAcceptance()');
  });

  it('gates every application workspace behind the versioned acceptance component', () => {
    const shellSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'layout', 'app-shell.tsx'),
      'utf8',
    );

    expect(shellSource).toContain('<LegalAcceptanceGate />');
  });
});
