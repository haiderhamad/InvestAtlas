import { tiingoManagerText } from '@/components/settings/tiingo-manager-copy';

describe('personal Tiingo BYOK connection copy', () => {
  const keys = [
    'intro', 'source', 'attribution', 'connected', 'keyLabel', 'keyPlaceholder', 'consent',
    'security', 'rights', 'quota', 'quotaDetail', 'cleared', 'notice',
    'invalidKey', 'rateLimited', 'hourlyLimitReached', 'providerUnavailable',
    'unexpectedResponse', 'capabilityUnavailable',
    'oldCache', 'oldCachePrompt', 'oldCacheCleared',
  ] as const;
  it.each(['en', 'de', 'ar'] as const)('has complete localized security and consent text for %s', (locale) => {
    for (const key of keys) {
      expect(tiingoManagerText(locale, key)).toEqual(expect.any(String));
      expect(tiingoManagerText(locale, key).length).toBeGreaterThan(16);
    }
    expect(tiingoManagerText(locale, 'security')).toContain('api.tiingo.com');
    expect(tiingoManagerText(locale, 'consent')).toContain('Tiingo');
  });

  it('does not silently display English terms for the German and Arabic consent screens', () => {
    expect(tiingoManagerText('de', 'consent')).not.toBe(tiingoManagerText('en', 'consent'));
    expect(tiingoManagerText('ar', 'consent')).not.toBe(tiingoManagerText('en', 'consent'));
    expect(tiingoManagerText('ar', 'consent')).toMatch(/[\u0600-\u06FF]/);
  });
});
