import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateBuyAndHoldMetrics } from '@/lib/strategy/buy-and-hold';

describe('buy-and-hold comparison metrics', () => {
  it('derives risk and annual metrics from the passive equity curve', () => {
    const metrics = calculateBuyAndHoldMetrics(
      [100, 80, 90],
      ['2024-01-01', '2024-07-01', '2025-01-01'],
      100,
      '1d',
    );

    expect(metrics).not.toBeNull();
    expect(metrics?.totalReturnPct).toBeCloseTo(-10);
    expect(metrics?.annualizedReturnPct).toBeCloseTo(-10, 1);
    expect(metrics?.maxDrawdownPct).toBeCloseTo(20);
    expect(metrics?.volatility).toBeGreaterThan(0);
    expect(metrics?.beta).toBeCloseTo(1);
    expect(metrics?.worstYear).toEqual({
      year: '2024',
      returnPct: -20,
    });
  });

  it('returns unavailable for invalid or incomplete source data', () => {
    expect(calculateBuyAndHoldMetrics([], [], 100, '1d')).toBeNull();
    expect(
      calculateBuyAndHoldMetrics(
        [100, 90],
        ['2024-01-01'],
        100,
        '1d',
      ),
    ).toBeNull();
    expect(
      calculateBuyAndHoldMetrics(
        [0, 90],
        ['2024-01-01', '2025-01-01'],
        100,
        '1d',
      ),
    ).toBeNull();
  });

  it('does not use hard-coded fallback metrics in the manual table', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/strategy-lab/page.tsx'),
      'utf8',
    );

    expect(source).not.toContain(
      'annualizedReturnPct: finalResults[0].equityCurve.length',
    );
    expect(source).toMatch(
      /<DetailedMetricsTable[\s\S]*?result=\{singleResult\}[\s\S]*?buyHoldMetrics=\{buyHoldMetrics\}/u,
    );
  });
});
