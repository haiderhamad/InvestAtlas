import { translateAppText } from '@/lib/i18n/app-localization';

describe('chart insight localization', () => {
  test.each(['Short trend', 'short trend supportive', 'short trend weak', 'Needs more history', 'Weak momentum', 'Histogram'])(
    'does not leak the English insight "%s" into German or Arabic', source => {
      expect(translateAppText(source, 'de')).not.toBe(source);
      expect(translateAppText(source, 'ar')).not.toBe(source);
    },
  );
});
