import { readFileSync } from 'node:fs';
import { getLegalDocument } from '@/lib/legal/product-legal';

describe('public source repository references', () => {
  const publicUrl = 'https://github.com/haiderhamad/InvestAtlas';

  it.each(['en', 'de', 'ar'] as const)('uses the renamed public repository in %s without linking the private code', (language) => {
    for (const kind of ['terms', 'privacy'] as const) {
      const document = getLegalDocument(kind, language);
      const github = document.sections.flatMap((section) => section.links ?? []).filter((link) => link.url.startsWith('https://github.com/'));
      expect(github.length).toBeGreaterThan(0);
      expect(github.every((link) => link.url === publicUrl)).toBe(true);
      expect(JSON.stringify(document)).not.toMatch(/InvestAtlas[- ]Showcase|InvestAtlas-Private/i);
    }
    const help = readFileSync('src/components/settings/help-about-settings.tsx', 'utf8');
    expect(help).toContain('INVESTATLAS_PUBLIC_REPOSITORY_URL');
    expect(help).not.toMatch(/InvestAtlas-showcase|InvestAtlas-Private/);
  });
});
