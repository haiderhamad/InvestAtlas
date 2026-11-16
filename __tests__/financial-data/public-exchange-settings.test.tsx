/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PersonalMarketSources } from '@/components/settings/personal-market-sources';
import {
  clearPublicSourceConsent, isPublicSourceApproved, readPublicSourceConsent,
} from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

jest.mock('@/components/settings/personal-history-settings', () => ({ PersonalHistorySettings: () => null }));
jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('public sources require a deliberate per-login activation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearPublicSourceConsent();
    resolveBrowserWorkspace('owner-1');
  });
  afterEach(cleanup);

  test('no public API can be used before activation, even when a source checkbox is preselected', () => {
    render(React.createElement(PersonalMarketSources, { owner: 'owner-1' }));
    expect(screen.getByText('No public sources active in this login.')).toBeTruthy();
    expect(isPublicSourceApproved('owner-1', 'binance')).toBe(false);
    expect(isPublicSourceApproved('owner-1', 'coinpaprika')).toBe(false);

    const confirmation = screen.getByRole('checkbox', { name: /I will use the selected sources only/ });
    const activate = screen.getByRole('button', { name: 'Activate public sources for this login' });
    expect((activate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmation);
    fireEvent.click(activate);

    expect(isPublicSourceApproved('owner-1', 'binance')).toBe(true);
    expect(isPublicSourceApproved('owner-1', 'coinpaprika')).toBe(true);
    expect(isPublicSourceApproved('owner-1', 'spot')).toBe(true);
    expect(isPublicSourceApproved('owner-1', 'kraken')).toBe(false);
    expect(readSourceSelection('owner-1').binance).toBe(true);
    expect(readPublicSourceConsent('owner-2')).toEqual([]);
    expect(screen.getByText(/Active for this login/)).toBeTruthy();
    clearPublicSourceConsent();
    expect(isPublicSourceApproved('owner-1', 'binance')).toBe(false);
  });

  test('private cloud offers personal provider priority even when hosted Tiingo is disabled', () => {
    render(React.createElement(PersonalMarketSources, { owner: 'owner-1' }));
    const preference = screen.getByLabelText('Preferred personal connection') as HTMLSelectElement;
    expect(preference).toBeTruthy();
    fireEvent.change(preference, { target: { value: 'marketdata' } });
    expect(readSourceSelection('owner-1').preferred).toBe('marketdata');
  });

  test('an active owner can revoke every public source without agreeing to activate anything', () => {
    render(React.createElement(PersonalMarketSources, { owner: 'owner-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I will use the selected sources only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate public sources for this login' }));
    for (const name of [/Yahoo Finance/, /Gold API: indicative/, /CoinPaprika Free:/, /CoinGecko: optional/, /Binance: public/]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    const update = screen.getByRole('button', { name: 'Update active sources' });
    expect((update as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(update);
    expect(readPublicSourceConsent('owner-1')).toEqual([]);
    expect(readSourceSelection('owner-1')).toMatchObject({ yahoo: false, spot: false, coinpaprika: false, binance: false, kraken: false });
    expect(screen.getByText('No public sources active in this login.')).toBeTruthy();
  });

  test('Yahoo is the first visible, explicitly enabled public source for personal research', () => {
    render(React.createElement(PersonalMarketSources, { owner: 'owner-1' }));
    const group = document.querySelector('section[aria-label="Public sources for this login"]');
    expect(group).not.toBeNull();
    const firstProvider = group!.querySelector('label.financial-provider-consent');
    expect(firstProvider?.textContent).toContain('Yahoo Finance');
    expect(isPublicSourceApproved('owner-1', 'yahoo')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /I will use the selected sources only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate public sources for this login' }));
    expect(isPublicSourceApproved('owner-1', 'yahoo')).toBe(true);
    expect(readSourceSelection('owner-1').yahoo).toBe(true);
  });

  test('a user can activate only Kraken and leave other sources off', () => {
    render(React.createElement(PersonalMarketSources, { owner: 'owner-1' }));
    for (const name of [/Yahoo Finance/, /Gold API: indicative/, /CoinPaprika Free:/, /CoinGecko: optional/, /Binance: public/]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    fireEvent.click(screen.getByRole('checkbox', { name: /Kraken: public/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I will use the selected sources only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate public sources for this login' }));
    expect(readPublicSourceConsent('owner-1')).toEqual(['kraken']);
    expect(readSourceSelection('owner-1')).toMatchObject({
      spot: false, coinpaprika: false, binance: false, kraken: true,
    });
    expect(readSourceSelection('owner-2').kraken).toBe(false);
  });
});
