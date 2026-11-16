import fs from 'node:fs';
import path from 'node:path';
import { translateAppText } from '@/lib/i18n/app-localization';

const trustAndAvailabilityKeys = [
  'Independently verified',
  'Not independently verified',
  'Build a recurring crypto contribution plan with manual allocations.',
  'Set your target asset allocation manually.',
  'Review source availability; missing ATH data stays unavailable.',
  'Checking available market data…',
  'Unavailable sources stay unavailable; no synthetic prices are used.',
  'Technical analysis is unavailable.',
  'Mobile app navigation',
  'Account detail tabs',
  'Previous page',
  'Next page',
  'Close import dialog',
  'Close dialog',
  'Remove row',
  'Strategy chart view',
  'Last activity',
  'No recent activity',
  'Selected month',
  'Help & About',
] as const;

describe('trilingual core UI trust copy', () => {
  it.each(trustAndAvailabilityKeys)('provides a non-English German translation for %s', (key) => {
    expect(translateAppText(key, 'de')).not.toBe(key);
  });

  it.each(trustAndAvailabilityKeys)('provides a non-English Arabic translation for %s', (key) => {
    expect(translateAppText(key, 'ar')).not.toBe(key);
  });

  it('uses the reviewed natural translations for new trust states', () => {
    expect(translateAppText('Independently verified', 'de')).toBe('Unabhängig verifiziert');
    expect(translateAppText('Not independently verified', 'ar')).toBe('لم يتم التحقق منه بشكل مستقل');
    expect(translateAppText('Technical analysis is unavailable.', 'de')).toBe('Die technische Analyse ist derzeit nicht verfügbar.');
    expect(translateAppText('Technical analysis is unavailable.', 'ar')).toBe('التحليل الفني غير متاح حاليًا.');
    expect(translateAppText('Help & About', 'de')).toBe('Hilfe & Info');
    expect(
      translateAppText('Unavailable sources stay unavailable; no synthetic prices are used.', 'ar'),
    ).toBe('تظل المصادر غير المتاحة موسومة بأنها غير متاحة، ولا تُستخدم أسعار اصطناعية.');
  });

  it('keeps the reviewed UI surfaces free of known locale-less and hardcoded accessibility labels', () => {
    const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    const strategy = read('src/app/strategy-lab/page.tsx');
    const chart = read('src/components/charts/interactive-equity-chart.tsx');
    const accountDetail = read('src/app/accounts/[venue]/page.tsx');
    const sidebar = read('src/components/layout/sidebar.tsx');
    const importDialog = read('src/components/transactions/import-dialog.tsx');

    expect(strategy).not.toContain('toLocaleString(undefined');
    expect(strategy).not.toContain('aria-label="Strategy chart view"');
    expect(chart).not.toContain('toLocaleString(undefined');
    expect(accountDetail).not.toContain('aria-label="Account detail tabs"');
    expect(accountDetail).not.toContain('aria-label="Previous page"');
    expect(accountDetail).not.toContain('aria-label="Next page"');
    expect(accountDetail).not.toContain('aria-label="Close dialog"');
    expect(sidebar).not.toContain('aria-label="Open menu"');
    expect(sidebar).not.toContain('title="Settings"');
    expect(importDialog).not.toContain('title="Remove row"');
  });
});
