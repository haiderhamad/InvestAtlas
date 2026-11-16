/** @jest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FinancialProviderManagerV124 } from '@/components/settings/financial-provider-manager-v124';

const mockSignOut = jest.fn<Promise<void>, []>();
const mockRouterReplace = jest.fn();
const mockRouterRefresh = jest.fn();
const mockWriteAnonymousWorkspaceMode = jest.fn();
const mockTestCredential = jest.fn();
let connected = false;
let mockUserId = 'firebase-user';

jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: mockUserId, email: 'user@example.com' },
    signOut: mockSignOut,
  }),
}));
jest.mock('@/lib/auth/firebase-api-auth', () => ({
  getFirebaseApiIdentity: jest.fn(async () => ({ userId: mockUserId, token: 'synthetic-token' })),
}));
jest.mock('@/lib/demo/workspace-mode', () => ({
  writeAnonymousWorkspaceMode: (mode: string) => mockWriteAnonymousWorkspaceMode(mode),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, refresh: mockRouterRefresh }),
}));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (text: string) => text, language: 'en' }),
}));
jest.mock('@/lib/financial-data/providers/tiingo-browser', () => ({
  TiingoBrowserError: class TiingoBrowserError extends Error {
    status = 'provider_unavailable';
  },
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT: 'investatlas:tiingo-browser-provider-change',
  clearTiingoBrowserCredential: jest.fn(() => {
    connected = false;
    window.dispatchEvent(new Event('investatlas:tiingo-browser-provider-change'));
  }),
  getTiingoBrowserBudget: () => ({ used: 1, limit: 25, remainingEstimate: 24 }),
  hasTiingoBrowserCredential: () => connected,
  setTiingoBrowserCredential: jest.fn(() => {
    connected = true;
    window.dispatchEvent(new Event('investatlas:tiingo-browser-provider-change'));
  }),
  testTiingoBrowserCredential: (...args: unknown[]) => mockTestCredential(...args),
}));
jest.mock('@/lib/financial-data/providers/alpha-vantage-browser', () => ({
  clearAlphaVantageNormalizedCache: jest.fn(),
  getAlphaVantageCachedSymbols: () => [],
}));

function providerStatusResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ providers: [] }),
  } as Response;
}

describe('v1.2.4 financial provider manager behavior', () => {
  beforeEach(() => {
    connected = false;
    mockUserId = 'firebase-user';
    mockSignOut.mockReset().mockResolvedValue(undefined);
    mockRouterReplace.mockReset();
    mockRouterRefresh.mockReset();
    mockWriteAnonymousWorkspaceMode.mockReset();
    mockTestCredential.mockReset().mockResolvedValue('connected');
    const authMock = jest.requireMock('@/lib/auth/firebase-api-auth') as {
      getFirebaseApiIdentity: jest.Mock;
    };
    authMock.getFirebaseApiIdentity.mockReset().mockImplementation(async () => ({ userId: mockUserId, token: 'synthetic-token' }));
    global.fetch = jest.fn(async () => providerStatusResponse());
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('requires explicit personal-use confirmation before testing a key', async () => {
    render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const input = screen.getByLabelText('Personal Tiingo API token');
    const submit = screen.getByRole('button', { name: 'Connect and test for this tab' }) as HTMLButtonElement;

    fireEvent.input(input, { target: { value: 'personal-secret' } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
  });

  it('tests the key, establishes a tab-memory connection, and clears the input', async () => {
    render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const input = screen.getByLabelText('Personal Tiingo API token') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'personal-secret' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect and test for this tab' }));

    await waitFor(() => expect(mockTestCredential).toHaveBeenCalledWith(
      'firebase-user',
      'personal-secret',
    ));
    expect(input.value).toBe('');
    expect(screen.getByText('Connected for this tab')).toBeTruthy();
    expect(screen.queryByDisplayValue('personal-secret')).toBeNull();
  });

  it('does not fetch legacy metadata with a Firebase identity unrelated to the visible account', async () => {
    const auth = jest.requireMock('@/lib/auth/firebase-api-auth') as {
      getFirebaseApiIdentity: jest.Mock;
    };
    auth.getFirebaseApiIdentity.mockResolvedValue({
      userId: 'unrelated-user',
      token: 'unrelated-token-fixture',
    });
    render(React.createElement(FinancialProviderManagerV124));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never displays the previous account’s masked provider key during a user switch', async () => {
    let resolveOther!: (value: Response) => void;
    const oldAccount = {
      ok: true,
      json: async () => ({ providers: [{ id: 'tiingo', status: 'connected', maskedKey: 'previous-account-mask' }] }),
    } as Response;
    const otherAccount = new Promise<Response>((resolve) => { resolveOther = resolve; });
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(oldAccount)
      .mockImplementationOnce(() => otherAccount);

    const view = render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('previous-account-mask')).toBeTruthy());

    mockUserId = 'next-account';
    view.rerender(React.createElement(FinancialProviderManagerV124));
    expect(screen.queryByText('previous-account-mask')).toBeNull();

    resolveOther({ ok: true, json: async () => ({ providers: [] }) } as Response);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('previous-account-mask')).toBeNull();
  });

  it('ignores an obsolete provider response whose JSON resolves after the owner changes', async () => {
    let resolveOldPayload!: (value: { providers: Array<{ id: string; status: string; maskedKey: string }> }) => void;
    const oldPayload = new Promise<{ providers: Array<{ id: string; status: string; maskedKey: string }> }>((resolve) => {
      resolveOldPayload = resolve;
    });
    (global.fetch as jest.Mock).mockReset()
      .mockResolvedValueOnce({ ok: true, json: () => oldPayload } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [{ id: 'tiingo', status: 'connected', maskedKey: 'next-account-mask' }] }) } as Response);

    const view = render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    mockUserId = 'next-account';
    view.rerender(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('next-account-mask')).toBeTruthy());
    await act(async () => {
      resolveOldPayload({ providers: [{ id: 'tiingo', status: 'connected', maskedKey: 'late-previous-mask' }] });
    });
    expect(screen.queryByText('late-previous-mask')).toBeNull();
    expect(screen.getByText('next-account-mask')).toBeTruthy();
  });

  it('clears an unsent personal key and its consent immediately on an account change', () => {
    const view = render(React.createElement(FinancialProviderManagerV124));
    const input = screen.getByLabelText('Personal Tiingo API token') as HTMLInputElement;
    const consent = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'draft-key-first-user' } });
    fireEvent.click(consent);
    expect(input.value).toBe('draft-key-first-user');
    expect(consent.checked).toBe(true);

    mockUserId = 'second-user';
    view.rerender(React.createElement(FinancialProviderManagerV124));
    expect(input.value).toBe('');
    expect(consent.checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Connect and test for this tab' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not complete an in-flight key connection for an account that has changed', async () => {
    let finishTest!: (value: string) => void;
    mockTestCredential.mockImplementationOnce(() => new Promise<string>((resolve) => { finishTest = resolve; }));
    const manager = jest.requireMock('@/lib/financial-data/providers/tiingo-browser') as {
      setTiingoBrowserCredential: jest.Mock;
    };
    manager.setTiingoBrowserCredential.mockClear();

    const view = render(React.createElement(FinancialProviderManagerV124));
    const input = screen.getByLabelText('Personal Tiingo API token');
    fireEvent.input(input, { target: { value: 'draft-key-first-user' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect and test for this tab' }));
    await waitFor(() => expect(mockTestCredential).toHaveBeenCalledWith('firebase-user', 'draft-key-first-user'));

    mockUserId = 'second-user';
    view.rerender(React.createElement(FinancialProviderManagerV124));
    await act(async () => { finishTest('connected'); });
    expect(manager.setTiingoBrowserCredential).not.toHaveBeenCalled();
    expect(screen.queryByText('Tiingo is connected for this tab. Refresh your portfolio or charts to retrieve the latest available daily closes.')).toBeNull();
  });

  it('never deletes another account’s legacy key when identity changes during token retrieval', async () => {
    const auth = jest.requireMock('@/lib/auth/firebase-api-auth') as {
      getFirebaseApiIdentity: jest.Mock;
    };
    let resolveIdentity!: (value: { userId: string; token: string }) => void;
    const pendingIdentity = new Promise<{ userId: string; token: string }>((resolve) => { resolveIdentity = resolve; });
    (global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        providers: [{ id: 'tiingo', status: 'connected', maskedKey: 'legacy-old-user' }],
      }),
    } as Response));

    const view = render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('legacy-old-user')).toBeTruthy());
    auth.getFirebaseApiIdentity.mockImplementationOnce(() => pendingIdentity);
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove stored key' }));
    mockUserId = 'second-user';
    view.rerender(React.createElement(FinancialProviderManagerV124));

    await act(async () => {
      resolveIdentity({ userId: 'second-user', token: 'second-user-fixture' });
    });
    const deletes = (global.fetch as jest.Mock).mock.calls.filter(
      ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(0);
    expect(screen.queryByText('The previously stored Tiingo key was removed.')).toBeNull();
  });

  it('does not erase the new account’s status if an earlier account’s delete finishes later', async () => {
    let completeDelete!: (response: Response) => void;
    const delayedDelete = new Promise<Response>((resolve) => { completeDelete = resolve; });
    (global.fetch as jest.Mock).mockImplementation((_, options?: RequestInit) => {
      if (options?.method === 'DELETE') return delayedDelete;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          providers: [{ id: 'tiingo', status: 'connected', maskedKey: mockUserId === 'firebase-user' ? 'old-user-mask' : 'second-user-mask' }],
        }),
      } as Response);
    });
    const view = render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('old-user-mask')).toBeTruthy());
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove stored key' }));
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(
      ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE',
    )).toBe(true));

    mockUserId = 'second-user';
    view.rerender(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('second-user-mask')).toBeTruthy());
    await act(async () => {
      completeDelete({ ok: true, json: async () => ({ removed: true }) } as Response);
    });
    expect(screen.getByText('second-user-mask')).toBeTruthy();
    expect(screen.queryByText('The previously stored Tiingo key was removed.')).toBeNull();
  });

  it('deletes only with a verified token for the confirming account', async () => {
    (global.fetch as jest.Mock).mockImplementation((_, options?: RequestInit) => Promise.resolve(
      options?.method === 'DELETE'
        ? { ok: true, json: async () => ({ removed: true }) }
        : { ok: true, json: async () => ({
          providers: [{ id: 'tiingo', status: 'connected', maskedKey: 'fixture-mask' }],
        }) },
    ));
    const auth = jest.requireMock('@/lib/auth/firebase-api-auth') as {
      getFirebaseApiIdentity: jest.Mock;
    };
    auth.getFirebaseApiIdentity.mockResolvedValue({
      userId: 'firebase-user',
      token: 'original-owner-token',
    });

    render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('fixture-mask')).toBeTruthy());
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove stored key' }));
    await waitFor(() => expect(screen.getByText('The previously stored Tiingo key was removed.')).toBeTruthy());

    const deletes = (global.fetch as jest.Mock).mock.calls.filter(
      ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1].headers).toEqual({ Authorization: 'Bearer original-owner-token' });
    expect(screen.queryByText('fixture-mask')).toBeNull();
  });

  it('refuses deletion if the Firebase token identity and displayed workspace disagree', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => Promise.resolve({
      ok: true,
      json: async () => ({ providers: [
        { id: 'tiingo', status: 'connected', maskedKey: 'fixture-mask' },
      ] }),
    }));
    const auth = jest.requireMock('@/lib/auth/firebase-api-auth') as {
      getFirebaseApiIdentity: jest.Mock;
    };
    auth.getFirebaseApiIdentity
      .mockResolvedValueOnce({ userId: 'firebase-user', token: 'initial-owner-token' })
      .mockResolvedValue({ userId: 'different-user', token: 'different-user-token' });
    render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(screen.getByText('fixture-mask')).toBeTruthy());
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove stored key' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const deletes = (global.fetch as jest.Mock).mock.calls.filter(
      ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(0);
  });

  it('opens the isolated Demo Snapshot only after signing out', async () => {
    render(React.createElement(FinancialProviderManagerV124));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and explore Demo Snapshot' }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockWriteAnonymousWorkspaceMode).toHaveBeenCalledWith('demo_snapshot');
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });
});

