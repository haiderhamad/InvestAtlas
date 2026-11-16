import { getLegalDocument } from '@/lib/legal/product-legal';
import { LEGAL_TERMS_VERSION } from '@/lib/legal/legal-acceptance';

test('renews the material disclosure date for the expanded personal price-source scope', () => {
  expect(LEGAL_TERMS_VERSION).toBe('2026-11-07');
  expect(getLegalDocument('privacy', 'en').lastUpdatedText).toContain('7 November 2026');
});

test.each(['en', 'de', 'ar'] as const)('discloses the actual personal sources, privacy, cache and failure boundaries in %s', language => {
  for (const kind of ['terms', 'privacy', 'financial-data'] as const) {
    const document = getLegalDocument(kind, language);
    const text = document.sections.flatMap(s => s.blocks).join(' ');
    for (const token of ['public_demo', 'local_personal', 'private_cloud', 'CoinPaprika', 'CoinGecko', 'XAU/USD', 'XAG/USD', 'MATIC', 'POL', '15']) expect(text).toContain(token);
    const links = document.sections.flatMap(s => s.links ?? []).map(l => l.url);
    expect(links).toContain('https://docs.coingecko.com/docs/keyless-public-api');
    expect(links).toContain('https://coinpaprika.com/api-terms-of-use/');
    expect(links).toContain('https://gold-api.com/terms');
  }
});
