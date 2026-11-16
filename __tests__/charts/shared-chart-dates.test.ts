import { buildPortfolioMonitorSeries } from '@/lib/portfolio/ux-insights';

it.each(['America/Los_Angeles', 'Europe/Berlin'])('preserves a calendar day in %s', (timeZone) => {
  const Original = Intl.DateTimeFormat;
  // Model each browser's default timezone while retaining actual Intl formatting.
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) =>
    new Original(locale, { timeZone, ...options }));
  try {
    const result = buildPortfolioMonitorSeries([], [], {
      asOfDay: '2026-11-01', monthKey: '2026-11', invested: 100, marketValue: 100,
    }, {}, { language: 'en' });
    expect(result.find(point => point.date === '2026-11-01')?.shortDate).toBe('Nov 1');
  } finally { spy.mockRestore(); }
});


it('keeps Arabic portfolio dates Gregorian when the browser defaults to the Hijri calendar', () => {
  const Original = Intl.DateTimeFormat;
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) =>
    new Original(locale === 'ar-SA' ? 'ar-SA-u-ca-islamic-umalqura' : locale, options));
  try {
    const result = buildPortfolioMonitorSeries([], [], {
      asOfDay: '2026-11-01', monthKey: '2026-11', invested: 100, marketValue: 100,
    }, {}, { language: 'ar' });
    expect(result.find(point => point.date === '2026-11-01')?.shortDate).toBe('١ نوفمبر');
  } finally { spy.mockRestore(); }
});
