/** @jest-environment jsdom */

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DataSyncSettings from '@/components/settings/data-sync-settings';

jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (text: string) => text, language: 'en' }),
}));

type AssetStatus = {
  symbol: string;
  name: string;
  source: string;
  isComplete: boolean | null;
  dataPoints: number | null;
  warnings: string[];
};

function asset(symbol: string, isComplete: boolean | null, dataPoints: number | null, warnings: string[] = []): AssetStatus {
  return { symbol, name: symbol, source: 'Fixture', isComplete, dataPoints, warnings };
}

describe('data synchronization history trust states', () => {
  afterEach(cleanup);

  it('never calls an explicitly incomplete measured history Optimal or Healthy', () => {
    render(createElement(DataSyncSettings, { coinData: [
      asset('AAPL', false, 20),
      asset('MSFT', true, 20),
    ] }));

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Review required')).toBeTruthy();
    expect(screen.queryByText('Optimal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    const incompleteRow = screen.getByText('AAPL').closest('tr');
    expect(incompleteRow).not.toBeNull();
    expect(within(incompleteRow!).getByText('Warning')).toBeTruthy();
  });

  it('does not count an unmeasured asset as fully covered or report Optimal', () => {
    render(createElement(DataSyncSettings, { coinData: [
      asset('AAPL', true, 20),
      asset('MSFT', null, null),
    ] }));
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Review required')).toBeTruthy();
  });

  it('reports Optimal only when all assets have complete measured history and no warnings', () => {
    render(createElement(DataSyncSettings, { coinData: [
      asset('AAPL', true, 20),
      asset('MSFT', true, 25),
    ] }));
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Optimal')).toBeTruthy();
  });

  it('exposes the expanded diagnostics table state to assistive technologies', () => {
    render(createElement(DataSyncSettings, { coinData: [asset('AAPL', false, 20)] }));
    const inspect = screen.getByRole('button', { name: 'Inspect' });
    expect(inspect.getAttribute('aria-expanded')).toBe('false');
    expect(inspect.getAttribute('aria-controls')).toBe('data-sync-diagnostics');
    fireEvent.click(inspect);
    const hide = screen.getByRole('button', { name: 'Hide' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('data-sync-diagnostics')).not.toBeNull();
  });
});
