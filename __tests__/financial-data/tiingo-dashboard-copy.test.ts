import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateAppText } from '@/lib/i18n/app-localization';

const shell = readFileSync(join(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8');
const messages = [
  'Connect a personal Tiingo token for supported raw daily US stock and ETF data. Your portfolio records remain available without it.',
  'Tiingo personal data is raw, unadjusted end-of-day data. It is not realtime, and daily change is unavailable.',
];

describe('signed-in Tiingo cloud banner', () => {
  it('does not point the user to the retired Alpha Vantage connection', () => {
    for (const message of messages) {
      expect(shell).toContain(`t(`);
      expect(shell).toContain(`'${message}'`);
    }
    expect(shell).not.toContain('Connect a personal Alpha Vantage key');
    expect(shell).not.toContain('Alpha Vantage personal data is raw');
  });

  it.each(['de', 'ar'] as const)('localizes Tiingo banner descriptions in %s', (locale) => {
    for (const message of messages) {
      const localized = translateAppText(message, locale);
      expect(localized).not.toBe(message);
      expect(localized).toContain('Tiingo');
      if (locale === 'ar') expect(localized).toMatch(/[\u0600-\u06FF]/);
    }
  });
});
