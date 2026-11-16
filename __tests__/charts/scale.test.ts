import { formatChartAxis, formatChartQuote, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';

describe('financial chart scale', () => {
  test('keeps finite zero and signed observations while excluding missing and nonfinite samples', () => {
    expect(getChartDomain([null, undefined, NaN, Infinity, -Infinity, -10, 0, 30], { paddingRatio: 0 })).toEqual([-10, 30]);
    expect(getChartDomain([null, undefined, NaN, Infinity])).toEqual([0, 1]);
  });

  test('magnitude bars include zero for positive, negative and equal totals', () => {
    expect(getChartDomain([100, 200], { includeZero: true, paddingRatio: 0 })).toEqual([0, 200]);
    expect(getChartDomain([100, 100], { includeZero: true, paddingRatio: 0 })).toEqual([0, 100]);
    expect(getChartDomain([-20, 100], { includeZero: true, paddingRatio: 0 })).toEqual([-20, 100]);
    expect(getChartDomain([-20, -10], { includeZero: true, paddingRatio: 0 })).toEqual([-20, 0]);
    expect(getChartDomain([0, 0], { includeZero: true })).toEqual([0, 1]);
  });

  test('pads line ranges without forcing zero and keeps constant series drawable', () => {
    expect(getChartDomain([100, 200], { paddingRatio: 0.05 })).toEqual([95, 205]);
    expect(getChartDomain([100, 100], { paddingRatio: 0.05 })).toEqual([95, 105]);
    const tiny = getChartDomain([0.00001, 0.00002]);
    expect(tiny[0]).toBeGreaterThan(0);
    expect(tiny[0]).toBeLessThan(0.00001);
    expect(tiny[1]).toBeGreaterThan(0.00002);
  });

  test.each(['en-US', 'de-DE', 'ar-SA'])('distinguishes adjacent ticks across visible ranges in %s', locale => {
    const fixtures: Array<{ values: number[]; domain: [number, number] }> = [
      { values: [0, 10, 20, 30, 40], domain: [0, 40] },
      { values: [10000, 10002.5, 10005, 10007.5, 10010], domain: [10000, 10010] },
      { values: [95000, 95002.5, 95005, 95007.5, 95010], domain: [95000, 95010] },
      { values: [0.00001, 0.0000125, 0.000015, 0.0000175, 0.00002], domain: [0.00001, 0.00002] },
      { values: [-10, -5, 0, 5, 10], domain: [-10, 10] },
      { values: [1e-16, 2e-16, 3e-16], domain: [1e-16, 3e-16] },
      { values: [0.000001, 0.00000100000000025, 0.0000010000000005, 0.00000100000000075, 0.000001000000001], domain: [0.000001, 0.000001000000001] },
    ];
    for (const { values, domain } of fixtures) {
      const labels = values.map(value => formatChartAxis(value, domain, locale));
      expect(new Set(labels).size).toBe(values.length);
      expect(labels.every(label => label.length > 0)).toBe(true);
    }
  });

  test('formats plain narrow labels and units without dropping significant digits', () => {
    expect(formatChartAxis(10002.5, [10000, 10010], 'en-US')).toBe('10,002.5');
    expect(formatChartAxis(10002.5, [10000, 10010], 'de-DE')).toBe('10.002,5');
    expect(formatChartAxis(0.000015, [0.00001, 0.00002], 'en-US')).toBe('0.000015');
    expect(formatChartAxis(20, [0, 40], 'en-US', { currencySymbol: '€' })).toBe('€20');
    expect(formatChartAxis(2.5, [-5, 5], 'en-US', { suffix: '%' })).toBe('2.5%');
    expect(formatChartAxis(NaN, [0, 1], 'en-US')).toBe('—');
  });

  test('quotes below a cent stay nonzero without changing normal currency formatting', () => {
    expect(formatChartQuote(0.000015, 'en-US', 'EUR')).toBe('€0.000015');
    expect(formatChartQuote(0.000015, 'de-DE', 'EUR')).toContain('0,000015');
    expect(formatChartQuote(297, 'en-US', 'EUR')).toBe('€297.00');
    expect(formatChartQuote(0, 'en-US', 'USD')).toBe('$0.00');
    expect(formatChartQuote(NaN, 'en-US', 'USD')).toBe('—');
  });

  test('reserves more gutter for precise labels while bounding layout consumption', () => {
    expect(getChartAxisWidth([0.00001, 0.00002], 'en-US')).toBeGreaterThan(getChartAxisWidth([0, 40], 'en-US'));
    expect(getChartAxisWidth([-1e15, 1e15], 'ar-SA', { currencySymbol: '€', compact: false })).toBeLessThanOrEqual(120);
  });
});
