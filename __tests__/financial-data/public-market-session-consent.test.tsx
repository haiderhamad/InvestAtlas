/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PublicMarketSessionConsent } from '@/components/settings/public-market-session-consent';
import {
  clearPublicSourceConsent,
  readPublicSourceConsent,
} from '@/lib/financial-data/providers/public-source-consent';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud',
}));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ language: 'en' }),
}));

const confirmation = () => screen.getByRole('checkbox', { name: /I will use the selected sources/ });
const gold = () => screen.getByRole('checkbox', { name: /^Gold API:/ });
const bullion = () => screen.getByRole<HTMLInputElement>('checkbox', { name: /^Standard Bullion:/ });
const yahoo = () => screen.getByRole('checkbox', { name: /^Yahoo Finance/ });
const activation = () => screen.getByRole('button', { name: 'Activate public sources for this login' });
const update = () => screen.getByRole('button', { name: 'Update active sources' });

function selectOnlyBullion() {
  const target = bullion();
  for (const option of screen.getAllByRole<HTMLInputElement>('checkbox')) {
    if (option.checked && option !== target) fireEvent.click(option);
  }
  if (!target.checked) fireEvent.click(target);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearPublicSourceConsent();
});

afterEach(() => {
  cleanup();
  clearPublicSourceConsent();
});

it('shows the current selection as confirmed after saving and reopening settings in the same tab', () => {
  const owner = 'confirmed-sources';
  const first = render(<PublicMarketSessionConsent owner={owner} />);
  selectOnlyBullion();
  fireEvent.click(confirmation());
  fireEvent.click(activation());

  expect(screen.getByRole('status')).toHaveTextContent('Active for this login: bullion');
  expect(confirmation()).toBeChecked();
  expect(update()).toBeDisabled();

  first.unmount();
  render(<PublicMarketSessionConsent owner={owner} />);
  expect(bullion()).toBeChecked();
  expect(gold()).not.toBeChecked();
  expect(confirmation()).toBeChecked();
});

it('restores the saved sources for the same workspace after sign-out without activating them', () => {
  const owner = 'remembered-sources';
  const first = render(<PublicMarketSessionConsent owner={owner} />);
  selectOnlyBullion();
  fireEvent.click(confirmation());
  fireEvent.click(activation());
  first.unmount();
  clearPublicSourceConsent();

  const next = render(<PublicMarketSessionConsent owner={owner} />);
  expect(bullion()).toBeChecked();
  expect(yahoo()).not.toBeChecked();
  expect(confirmation()).not.toBeChecked();
  expect(activation()).toBeDisabled();
  expect(readPublicSourceConsent(owner)).toEqual([]);

  next.unmount();
  render(<PublicMarketSessionConsent owner="different-owner" />);
  expect(bullion()).not.toBeChecked();
  expect(yahoo()).toBeChecked();
});

it('requires an explicit confirmation when the draft changes', () => {
  render(<PublicMarketSessionConsent owner="changed-draft" />);
  fireEvent.click(confirmation());
  expect(activation()).toBeEnabled();
  fireEvent.click(bullion());
  expect(confirmation()).not.toBeChecked();
  expect(activation()).toBeDisabled();
});

it('remembers the explicit removal of every public source', () => {
  const owner = 'all-sources-disabled';
  const first = render(<PublicMarketSessionConsent owner={owner} />);
  selectOnlyBullion();
  fireEvent.click(confirmation());
  fireEvent.click(activation());
  fireEvent.click(bullion());
  fireEvent.click(update());
  first.unmount();
  clearPublicSourceConsent();

  render(<PublicMarketSessionConsent owner={owner} />);
  expect(screen.getAllByRole<HTMLInputElement>('checkbox').every(option => !option.checked)).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent('No public sources active');
});

it('clears remembered sources while the current login has no active consent', () => {
  const owner = 'clear-inactive-sources';
  const first = render(<PublicMarketSessionConsent owner={owner} />);
  selectOnlyBullion();
  fireEvent.click(confirmation());
  fireEvent.click(activation());
  first.unmount();
  clearPublicSourceConsent();

  const next = render(<PublicMarketSessionConsent owner={owner} />);
  expect(bullion()).toBeChecked();
  fireEvent.click(bullion());
  expect(confirmation()).toBeDisabled();
  const clear = screen.getByRole('button', { name: 'Clear saved sources' });
  expect(clear).toBeEnabled();
  fireEvent.click(clear);
  expect(clear).toBeDisabled();
  expect(readPublicSourceConsent(owner)).toEqual([]);

  next.unmount();
  render(<PublicMarketSessionConsent owner={owner} />);
  expect(bullion()).not.toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('No public sources active');
});
