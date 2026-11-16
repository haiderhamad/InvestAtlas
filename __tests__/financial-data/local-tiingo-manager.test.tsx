/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FinancialProviderManagerV124 } from '@/components/settings/financial-provider-manager-v124';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { getFirebaseApiIdentity } from '@/lib/auth/firebase-api-auth';
import { setTiingoBrowserCredential } from '@/lib/financial-data/providers/tiingo-browser';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';

const mockTest = jest.fn();
let connected = false;
jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, signOut: jest.fn() }),
}));
jest.mock('@/lib/auth/firebase-api-auth', () => ({
  getFirebaseApiIdentity: jest.fn(),
}));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (s: string) => s, language: 'en' }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT: 'investatlas:tiingo-browser-provider-change',
  TiingoBrowserError: class TiingoBrowserError extends Error { status = 'provider_unavailable'; },
  getTiingoBrowserBudget: () => ({ used: 0, limit: 25 }),
  hasTiingoBrowserCredential: () => connected,
  setTiingoBrowserCredential: jest.fn(() => {
    connected = true;
    window.dispatchEvent(new Event('investatlas:tiingo-browser-provider-change'));
  }),
  clearTiingoBrowserCredential: jest.fn(() => {
    connected = false;
    window.dispatchEvent(new Event('investatlas:tiingo-browser-provider-change'));
  }),
  testTiingoBrowserCredential: (...args: unknown[]) => mockTest(...args),
}));
jest.mock('@/lib/financial-data/providers/alpha-vantage-browser', () => ({
  getAlphaVantageCachedSymbols: () => [],
  clearAlphaVantageNormalizedCache: jest.fn(),
}));

describe('Local Personal Tiingo settings without Firebase', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
    connected = false;
    mockTest.mockReset().mockResolvedValue('connected');
    jest.mocked(getFirebaseApiIdentity).mockReset();
    jest.mocked(setTiingoBrowserCredential).mockClear();
    global.fetch = jest.fn();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('rejects late Tiingo test success after leaving Local Workspace for Demo', async () => {
    let succeed!: () => void;
    mockTest.mockImplementationOnce(() => new Promise<void>((resolve) => { succeed = resolve; }));
    render(React.createElement(FinancialProviderManagerV124));
    fireEvent.input(screen.getByLabelText('Personal Tiingo API token'), {
      target: { value: 'SYNTHETIC_PENDING_TOKEN' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect and test for this tab' }));
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    window.localStorage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, 'demo_snapshot');
    succeed();
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'Connect and test for this tab',
    }) as HTMLButtonElement).disabled).toBe(false));
    expect(setTiingoBrowserCredential).not.toHaveBeenCalled();
    expect(connected).toBe(false);
  });

  it('allows a local-only key and does not contact Firebase or server vault', async () => {
    render(React.createElement(FinancialProviderManagerV124));
    const submit = screen.getByRole('button', { name: 'Connect and test for this tab' }) as HTMLButtonElement;
    fireEvent.input(screen.getByLabelText('Personal Tiingo API token'), {
      target: { value: 'SYNTHETIC_LOCAL_ONLY' },
    });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mockTest).toHaveBeenCalledWith(
      LOCAL_PERSONAL_PROVIDER_OWNER_ID, 'SYNTHETIC_LOCAL_ONLY',
    ));
    await waitFor(() => expect(setTiingoBrowserCredential).toHaveBeenCalledWith(
      LOCAL_PERSONAL_PROVIDER_OWNER_ID, 'SYNTHETIC_LOCAL_ONLY',
    ));
    expect(getFirebaseApiIdentity).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign out and explore Demo Snapshot' })).toBeNull();
  });
});
