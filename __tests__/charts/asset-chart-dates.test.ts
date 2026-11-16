import { formatAssetAxisDate } from '@/lib/charts/asset-chart';

describe('Gregorian market observation dates in Arabic', () => {
  // An explicit Islamic locale preference reproduces Safari's Arabic default
  // while exercising actual Intl formatting without replacing the browser API.
  const locale = 'ar-SA-u-ca-islamic-umalqura';

  it('keeps the ISO observation year Gregorian on long-range axes', () => {
    const label = formatAssetAxisDate('2026-11-03', 'All', '1d', locale);
    expect(label).toContain('٢٦');
    expect(label).toContain('نوفمبر');
  });

  it('keeps intraday month names Gregorian and the observation time in UTC', () => {
    const label = formatAssetAxisDate('2026-11-03T14:35:00Z', '7D', '1h', locale);
    expect(label).toContain('نوفمبر');
    expect(label).toContain('١٤:٣٥');
  });
});
