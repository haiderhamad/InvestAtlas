/** @jest-environment jsdom */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import DashboardChart from '@/components/dashboard/dashboard-chart';
let mockLanguage = 'en';
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ t: (text: string) => text, language: mockLanguage }) }));
jest.mock('@/lib/preferences/display-currency', () => ({ useDisplayCurrencyPreference: () => ({ formatMoney: (value: number) => `€${value}` }) }));
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children, { width: 800, height: 320 } as object) };
});
afterEach(() => { cleanup(); mockLanguage = 'en'; });
const data = [
  { shortDate: 'Nov 1', marketValue: 10000, invested: 10000 },
  { shortDate: 'Nov 2', marketValue: 10010, invested: 10000 },
];
it('distinguishes a small dashboard balance change without collapsing compact ticks', () => {
  const { container } = render(<DashboardChart data={data} />);
  const labels = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map(node => node.textContent);
  expect(new Set(labels).size).toBeGreaterThan(2);
});
it('places Arabic dashboard ticks to the right of the axis', () => {
  mockLanguage = 'ar';
  const { container } = render(<DashboardChart data={data} />);
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')];
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every(node => Number(node.getAttribute('x')) > 0 && node.getAttribute('text-anchor') === 'start')).toBe(true);
});
