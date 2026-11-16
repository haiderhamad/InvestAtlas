/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FinancialProviderManager } from '@/components/settings/financial-provider-manager';

const mockSignOut = jest.fn<Promise<void>, []>();
const mockRouterReplace = jest.fn();
const mockRouterRefresh = jest.fn();
const mockWriteAnonymousWorkspaceMode = jest.fn();
let mockLanguage = 'en';

jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

jest.mock('@/lib/auth/firebase-api-auth', () => ({
  getFirebaseAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('@/lib/demo/workspace-mode', () => ({
  writeAnonymousWorkspaceMode: (mode: string) => mockWriteAnonymousWorkspaceMode(mode),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, refresh: mockRouterRefresh }),
}));

jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({
    language: mockLanguage,
    // Intentionally return a new callback on every render. Provider loading
    // must not depend on translation-function identity.
    t: (text: string) => text,
  }),
}));

function successfulProviderResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ providers: [] }),
  } as Response;
}

describe('FinancialProviderManager request behavior', () => {
  beforeEach(() => {
    mockLanguage = 'en';
    mockSignOut.mockReset().mockResolvedValue(undefined);
    mockRouterReplace.mockReset();
    mockRouterRefresh.mockReset();
    mockWriteAnonymousWorkspaceMode.mockReset();
    global.fetch = jest.fn(async () => successfulProviderResponse());
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('loads once and does not refetch after rerender or language change', async () => {
    const view = render(React.createElement(FinancialProviderManager, { isAvailable: false }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    view.rerender(React.createElement(FinancialProviderManager, { isAvailable: false }));
    mockLanguage = 'de';
    view.rerender(React.createElement(FinancialProviderManager, { isAvailable: false }));

    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries only after an explicit user action', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'internal detail must not be shown' }),
      } as Response)
      .mockResolvedValueOnce(successfulProviderResponse());
    global.fetch = fetchMock;

    render(React.createElement(FinancialProviderManager, { isAvailable: false }));

    expect(await screen.findByText('Financial provider status was requested too often. Wait a moment and try again.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry provider status' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('opens the isolated Demo Snapshot only after signing out', async () => {
    render(React.createElement(FinancialProviderManager, { isAvailable: false }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out and explore Demo Snapshot' }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockWriteAnonymousWorkspaceMode).toHaveBeenCalledWith('demo_snapshot');
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps Cloud unchanged and reports failure when sign-out fails', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('sign-out failed'));
    render(React.createElement(FinancialProviderManager, { isAvailable: false }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out and explore Demo Snapshot' }));

    expect(await screen.findByText('Could not open the Demo Snapshot. Your Cloud Workspace was not changed.')).toBeTruthy();
    expect(mockWriteAnonymousWorkspaceMode).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });
});
