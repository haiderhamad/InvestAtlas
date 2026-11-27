/** @jest-environment jsdom */
import { deserialize, serialize } from 'node:v8';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { getCloudDataStatus } from '@/lib/storage/cloud-data-status';

const mockSnapshots = new Map<string, (snapshot: unknown) => void>();
jest.mock('@/lib/runtime/deployment-mode', () => ({
  ...jest.requireActual('@/lib/runtime/deployment-mode'), INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud',
}));
jest.mock('@/lib/firebase', () => ({ auth: {}, db: {}, isFirebaseConfigured: true }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, notify: (user: unknown) => void) => {
    queueMicrotask(() => notify({ uid: 'cold-start-owner' }));
    return () => {};
  },
}));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  where: () => undefined,
  query: (name: string) => name,
  onSnapshot: (name: string, receive: (snapshot: unknown) => void) => {
    mockSnapshots.set(name, receive);
    return () => mockSnapshots.delete(name);
  },
}));

function DirectRoute() {
  return <span>{useAuth().user?.id}</span>;
}

test('a signed-in cold route releases all workspace scopes after their first acknowledged snapshots', async () => {
  // jsdom omits this browser API, used to copy the real readiness snapshot.
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  render(<AuthProvider><DirectRoute /></AuthProvider>);
  await screen.findByText('cold-start-owner');
  expect(getCloudDataStatus().pendingScopes).toEqual(['transactions', 'accounts', 'asset_risks']);

  await waitFor(() => expect([...mockSnapshots.keys()].sort()).toEqual(['asset-risks', 'manual-accounts', 'transactions']));
  const ack = { metadata: { hasPendingWrites: false }, docs: [] };
  mockSnapshots.get('transactions')!(ack);
  mockSnapshots.get('manual-accounts')!(ack);
  mockSnapshots.get('asset-risks')!({ ...ack, metadata: { hasPendingWrites: true } });
  expect(getCloudDataStatus().blockedScopes).toEqual(['asset_risks']);
  mockSnapshots.get('asset-risks')!(ack);
  expect(getCloudDataStatus().blockedScopes).toEqual([]);
});
