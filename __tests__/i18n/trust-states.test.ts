import { translateAppText } from '@/lib/i18n/app-localization';

describe('trust-state localization', () => {
  test.each([
    'Compliant',
    'Non-compliant',
    'Review required',
    'Insufficient data',
    'Unavailable — insufficient data',
    'AI interpretation only.',
    'Technical score',
  ])('provides a dedicated Arabic translation for %s', (source) => {
    expect(translateAppText(source, 'ar')).not.toBe(source);
  });

  test('localizes the purification uncertainty explanation in Arabic', () => {
    const source =
      'A precise purification total is unavailable because a required rate, source period, confirmation, or FX conversion is missing.';

    expect(translateAppText(source, 'ar')).not.toBe(source);
    expect(translateAppText(source, 'de')).not.toBe(source);
  });
});
