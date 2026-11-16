import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('analytics product-truth boundary', () => {
  it('does not expose unsourced ETF, region, sector, or volatility heuristics', () => {
    const analytics = source('src/app/analytics/page.tsx');

    expect(analytics).not.toMatch(
      /buildLookThroughBreakdown|readAssetRisks|ETF look-through|Geographical Regions|Sector Allocation|Risk \/ Volatility/u,
    );
    expect(
      existsSync(join(process.cwd(), 'src/lib/portfolio/etf-breakdown.ts')),
    ).toBe(false);
  });

  it('does not let Shariah screening create investment-risk classifications', () => {
    const route = source('src/app/api/coins/check/route.ts');
    const settings = source('src/app/settings/coins/page.tsx');

    expect(route).not.toContain('riskCategory');
    expect(settings).not.toMatch(/saveAssetRisk|riskCategory/u);
  });

  it('keeps the gold-silver relationship descriptive rather than a valuation signal', () => {
    const insight = source('src/lib/portfolio/ux-insights.ts');
    const portfolio = source('src/app/portfolio/page.tsx');
    const charts = source('src/app/charts/page.tsx');
    const visibleRatioSources = `${insight}\n${portfolio}\n${charts}`;

    expect(visibleRatioSources).not.toMatch(
      /silverValuation|Silver Valuation Signal|Silver looks|Silver cheap|Silver expensive|catch-up potential/iu,
    );
    expect(insight).toContain('referenceBand');
    expect(charts).toContain('latestMatchedMetalObservation');
    expect(portfolio).toContain('field.observedAt ?? field.asOf');
    expect(portfolio).toContain('asOf,');
  });

  it('keeps the removed AI allocation endpoint as a fail-closed tombstone', () => {
    const route = source('src/app/api/ai/savings-plan/route.ts');
    const page = source('src/app/savings-plan/page.tsx');

    expect(route).not.toMatch(/callProvider|getActiveProviders|parseSavingsPlanResult/u);
    expect(route).toContain('{ status: 410 }');
    expect(page).not.toMatch(/Suggest Portfolio|Optimize Current|Check Strategy & Rebalance/u);
  });
});
