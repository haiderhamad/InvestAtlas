/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PersonalMarketSources } from '@/components/settings/personal-market-sources';
import { PersonalPriceAttribution } from '@/components/financial/personal-price-attribution';
import { clearPublicSourceConsent, readPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

let language = 'en';
jest.mock('@/components/settings/personal-history-settings', () => ({ PersonalHistorySettings: () => null }));
jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/i18n/use-app-translation', () => ({ useAppTranslation: () => ({ t: (s: string) => s, language }) }));
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); clearPublicSourceConsent(); resolveBrowserWorkspace('coverage-owner'); });
afterEach(cleanup);

test.each([
  ['en', /gold and silver/i, /all 27/i, /Price coverage and backups/, /Saved Standard Bullion history/],
  ['de', /Gold und Silber/, /alle 27/, /Preisabdeckung und Ersatzquellen/, /Gespeicherte Standard-Bullion-Historie/],
  ['ar', /للذهب والفضة/, /27/, /تغطية الأسعار والمصادر البديلة/, /سجل Standard Bullion المحفوظ/],
])('shows scope and real backup limits in %s without activating providers', (lang, metals, coins, title, limitation) => {
  language = String(lang);
  render(<PersonalMarketSources owner="coverage-owner" />);
  expect(screen.getAllByRole('checkbox', { name: metals as RegExp })).toHaveLength(2);
  expect(screen.getByRole('checkbox', { name: coins as RegExp })).toBeTruthy();
  expect(screen.getByText(title as RegExp)).toBeTruthy();
  expect(screen.getByText(limitation as RegExp)).toBeTruthy();
  expect(readPublicSourceConsent('coverage-owner')).toEqual([]);
});

test('the new backup needs fresh session consent; the previous consent version grants nothing', () => {
  language = 'en';
  window.sessionStorage.setItem('investatlas.public-sources.session.v1', JSON.stringify({ owner: 'coverage-owner', sources: ['yahoo', 'spot', 'coinpaprika', 'coingecko'] }));
  expect(readPublicSourceConsent('coverage-owner')).toEqual([]);
  render(<PersonalMarketSources owner="coverage-owner" />);
  expect(screen.getByRole('checkbox', { name: /CoinGecko: optional/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /I will use the selected sources only/ }));
  fireEvent.click(screen.getByRole('button', { name: /Activate public sources/ }));
  expect(readPublicSourceConsent('coverage-owner')).toContain('coingecko');
});

test('shows mandatory linked attribution for the actually approved aggregators and updates on revoke', () => {
  language = 'en'; setPublicSourceConsent('coverage-owner', ['coinpaprika', 'coingecko']);
  render(<PersonalPriceAttribution owner="coverage-owner" />);
  expect(screen.getByRole('link', { name: 'Powered by CoinPaprika' }).getAttribute('href')).toBe('https://coinpaprika.com/');
  expect(screen.getByRole('link', { name: 'Powered by CoinGecko' }).getAttribute('href')).toBe('https://www.coingecko.com/en/api');
  cleanup(); clearPublicSourceConsent(); render(<PersonalPriceAttribution owner="coverage-owner" />);
  expect(screen.queryByRole('link')).toBeNull();
});

test('the metal-history source needs its own deliberate selection and has linked attribution', () => {
  language = 'en'; setPublicSourceConsent('coverage-owner', ['spot']);
  render(<PersonalMarketSources owner="coverage-owner" />);
  const source = screen.getByRole('checkbox', { name: /Standard Bullion:/ });
  expect((source as HTMLInputElement).checked).toBe(false);
  expect(readPublicSourceConsent('coverage-owner')).not.toContain('bullion');
  fireEvent.click(source);
  fireEvent.click(screen.getByRole('checkbox', { name: /I will use the selected sources only/ }));
  fireEvent.click(screen.getByRole('button', { name: /Update active sources/ }));
  expect(readPublicSourceConsent('coverage-owner')).toEqual(['spot', 'bullion']);
  cleanup(); render(<PersonalPriceAttribution owner="coverage-owner" />);
  expect(screen.getByRole('link', { name: 'Data by Standard Bullion' }).getAttribute('href')).toBe('https://standardbullion.com/market-data');
});
