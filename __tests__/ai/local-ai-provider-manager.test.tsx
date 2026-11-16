/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalAIProviderManager } from '@/components/settings/local-ai-provider-manager';
import { clearLocalAIConfig, getLocalAIConfig } from '@/lib/ai/local-browser-provider';
import { ANONYMOUS_WORKSPACE_MODE_KEY } from '@/lib/demo/workspace-mode';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'local_personal',
}));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));

describe('Local AI provider manager session-only UX', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
    clearLocalAIConfig();
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        result: { status: 'ok', provider: 'OpenAI', models: ['gpt-test'] },
      }),
    } as Response));
  });
  afterEach(() => {
    cleanup();
    clearLocalAIConfig();
    global.fetch = originalFetch;
  });

  it('requires upload consent and a key, then saves only to tab memory', async () => {
    render(React.createElement(LocalAIProviderManager));
    const submit = screen.getByRole('button', { name: 'Test and connect AI key' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText('Personal API key'), { target: { value: 'SYNTHETIC_ONLY_KEY' } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    fireEvent.submit(submit.closest('form')!);

    await waitFor(() => expect(getLocalAIConfig()?.apiKey).toBe('SYNTHETIC_ONLY_KEY'));
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/local/ai/test');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({
      cache: 'no-store', credentials: 'same-origin',
      redirect: 'error', referrerPolicy: 'no-referrer',
    });
    expect(init.body).toContain('SYNTHETIC_ONLY_KEY');
    expect(screen.queryByText('SYNTHETIC_ONLY_KEY')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove session key' }));
    expect(getLocalAIConfig()).toBeNull();
  });

  it('never restores a pending AI key after switching from Local Workspace to Demo', async () => {
    let complete!: (response: Response) => void;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    render(React.createElement(LocalAIProviderManager));
    fireEvent.input(screen.getByLabelText('Personal API key'), {
      target: { value: 'SYNTHETIC_PENDING_KEY' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect AI key' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    window.localStorage.setItem(ANONYMOUS_WORKSPACE_MODE_KEY, 'demo_snapshot');
    complete({
      ok: true,
      json: async () => ({ result: { status: 'ok' } }),
    } as Response);
    await waitFor(() => expect(
      (screen.getByLabelText('Personal API key') as HTMLInputElement).value,
    ).toBe(''));
    expect(getLocalAIConfig()).toBeNull();
  });

  it('never stores a failed provider key', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ result: { status: 'invalid_key' } }),
    } as Response));
    render(React.createElement(LocalAIProviderManager));
    fireEvent.input(screen.getByLabelText('Personal API key'), { target: { value: 'INVALID_SYNTHETIC_KEY' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect AI key' }));
    await waitFor(() => expect(screen.getByText(
      'Local AI provider connection failed. Check your key, model and plan.',
    )).toBeTruthy());
    expect(getLocalAIConfig()).toBeNull();
  });
});
