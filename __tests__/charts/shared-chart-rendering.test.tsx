/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InteractiveEquityChart from '@/components/charts/interactive-equity-chart';

let mockLanguage = 'en';

jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (text: string) => text, language: mockLanguage }),
}));
// jsdom has no layout engine. Keep Recharts rendering real, supply only measured size.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children, { width: 800, height: 320 } as object) };
});

afterEach(() => { cleanup(); mockLanguage = 'en'; });

it('shows the empty state when every supplied equity value is unavailable', () => {
  render(<InteractiveEquityChart dates={['2026-11-01', '2026-11-02']} series={[{ label: 'Strategy', color: '#19b7a4', data: [NaN, Infinity] }]} currencySymbol="€" />);
  expect(screen.queryByText('No equity data available.')).not.toBeNull();
});

it('plots a genuine zero-equity run instead of treating it as unavailable', () => {
  const { container } = render(<InteractiveEquityChart dates={['2026-11-01', '2026-11-02']} series={[{ label: 'Strategy', color: '#19b7a4', data: [0, 0] }]} currencySymbol="€" />);
  expect(container.querySelector('.recharts-area-curve')).not.toBeNull();
});

it('keeps daily labels distinguishable within a single month', () => {
  const { container } = render(<InteractiveEquityChart dates={['2026-11-01', '2026-11-15', '2026-11-29']} series={[{ label: 'Strategy', color: '#19b7a4', data: [100, 105, 110] }]} currencySymbol="€" />);
  const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels text')].map(node => node.textContent);
  expect(new Set(ticks).size).toBeGreaterThan(1);
});

it('exposes the selected range and updates it when the user chooses another period', () => {
  render(<InteractiveEquityChart dates={['2025-01-01', '2026-11-01']} series={[{ label: 'Strategy', color: '#19b7a4', data: [100, 110] }]} currencySymbol="€" />);
  expect(screen.getByRole('button', { name: 'MAX' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '6M' }));
  expect(screen.getByRole('button', { name: '6M' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'MAX' }).getAttribute('aria-pressed')).toBe('false');
});

it('distinguishes small equity movements on a large balance', () => {
  const { container } = render(<InteractiveEquityChart dates={['2026-11-01', '2026-11-02']} series={[{ label: 'Strategy', color: '#19b7a4', data: [10000, 10010] }]} currencySymbol="€" />);
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(new Set(ticks).size).toBeGreaterThan(2);
});

it('plots negative equity observations without bridging missing observations', () => {
  const { container } = render(<InteractiveEquityChart dates={['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']} series={[{ label: 'Strategy', color: '#19b7a4', data: [-2, -1, NaN, -4, -3] }]} currencySymbol="€" />);
  const path = container.querySelector('.recharts-area-curve')?.getAttribute('d') ?? '';
  expect(path.match(/M/g)?.length).toBe(2);
});


it('shows a visible marker when the range contains only one equity observation', () => {
  const { container } = render(<InteractiveEquityChart dates={['2026-11-01']} series={[{ label: 'Strategy', color: '#19b7a4', data: [100] }]} currencySymbol="€" />);
  expect(container.querySelector('.recharts-area-dot')).not.toBeNull();
});


it('keeps Arabic equity dates Gregorian when the browser defaults to the Hijri calendar', () => {
  mockLanguage = 'ar';
  const Original = Intl.DateTimeFormat;
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) =>
    new Original(locale === 'ar-SA' ? 'ar-SA-u-ca-islamic-umalqura' : locale, options));
  try {
    const { container } = render(<InteractiveEquityChart dates={['2025-11-01', '2026-11-01']} series={[{ label: 'Strategy', color: '#19b7a4', data: [100, 110] }]} currencySymbol="€" />);
    const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels text')].map(node => node.textContent);
    expect(ticks.some(text => text?.includes('نوفمبر'))).toBe(true);
    expect(container.querySelector('.interactive-equity-date-pill')?.textContent).toContain('٢٠٢٦');
  } finally { spy.mockRestore(); }
});
