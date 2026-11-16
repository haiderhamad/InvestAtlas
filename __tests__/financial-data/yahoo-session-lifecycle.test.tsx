/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { readPublicSourceConsent, setPublicSourceConsent, clearPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { writeAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { clearLocalAIConfig, getLocalAIConfig, setLocalAIConfig } from '@/lib/ai/local-browser-provider';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));
jest.mock('@/lib/db', () => ({ db: { isConfigured: () => false, signOut: async () => {} } }));
jest.mock('@/lib/auth/firebase-api-auth', () => ({ getFirebaseApiIdentity: async () => null }));
const owner = 'local-personal-provider';

function SessionControls() {
  const { signOut } = useAuth();
  return <button onClick={() => { void signOut(); }}>End personal session</button>;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearPublicSourceConsent(); clearLocalAIConfig(); });
afterEach(cleanup);

test('real AuthProvider clears public-source permission after signing out', async () => {
  render(<AuthProvider><SessionControls /></AuthProvider>);
  await screen.findByRole('button', { name: 'End personal session' });
  act(() => setPublicSourceConsent(owner, ['yahoo']));
  expect(readPublicSourceConsent(owner)).toEqual(['yahoo']);
  fireEvent.click(screen.getByRole('button', { name: 'End personal session' }));
  await waitFor(() => expect(readPublicSourceConsent(owner)).toEqual([]));
});

test('ending a Local Personal session also clears its optional AI key from memory', async () => {
  render(<AuthProvider><SessionControls /></AuthProvider>);
  await screen.findByRole('button', { name: 'End personal session' });
  act(() => setLocalAIConfig({type:'openai',apiKey:'SYNTHETIC_SESSION_ONLY',model:''}));
  expect(getLocalAIConfig()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'End personal session' }));
  await waitFor(() => expect(getLocalAIConfig()).toBeNull());
});

test('leaving Local Personal for Demo then returning requires new approval', async () => {
  render(<AuthProvider><SessionControls /></AuthProvider>);
  await screen.findByRole('button', { name: 'End personal session' });
  act(() => setPublicSourceConsent(owner, ['yahoo']));
  act(() => writeAnonymousWorkspaceMode('demo_snapshot'));
  expect(readPublicSourceConsent(owner)).toEqual([]);
  act(() => writeAnonymousWorkspaceMode('local_workspace'));
  expect(readPublicSourceConsent(owner)).toEqual([]);
});
