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
  ['en', /gold and silver/i, /all 27/i, /Price coverage and backups/, /No verified independent free metal backup/],
  ['de', /Gold und Silber/, /alle 27/, /Preisabdeckung und Ersatzquellen/, /Keine verifizierte unabhängige kostenlose Metall-Ersatzquelle/],
  ['ar', /للذهب والفضة/, /27/, /تغطية الأسعار والمصادر البديلة/, /لا يوجد مصدر مجاني مستقل موثّق بديل للمعادن/],
])('shows scope and real backup limits in %s without activating providers', (lang, metals, coins, title, limitation) => {
  language = String(lang);
  render(<PersonalMarketSources owner="coverage-owner" />);
  expect(screen.getByRole('checkbox', { name: metals as RegExp })).toBeTruthy();
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
