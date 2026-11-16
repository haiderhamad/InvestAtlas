import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertCloudDataReady,
  getCloudDataStatus,
  markCloudDataReady,
  reportCloudDataUnavailable,
  setCloudDataWorkspace,
} from '@/lib/storage/cloud-data-status';

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('cloud data failure state', () => {
  beforeEach(() => {
    setCloudDataWorkspace(null);
  });

  it('gates every required collection until the active UID is ready', () => {
    setCloudDataWorkspace('user-a');

    expect(getCloudDataStatus().pendingScopes).toEqual([
      'transactions',
      'accounts',
      'asset_risks',
    ]);
    expect(() => assertCloudDataReady('transactions')).toThrow(
      'Cloud transactions is not ready.',
    );

    markCloudDataReady('transactions', 'user-a');
    expect(() => assertCloudDataReady('transactions')).not.toThrow();
    expect(getCloudDataStatus().pendingScopes).toEqual([
      'accounts',
      'asset_risks',
    ]);
  });

  it('ignores stale callbacks from a previous Firebase UID', () => {
    setCloudDataWorkspace('user-a');
    markCloudDataReady('transactions', 'user-a');
    setCloudDataWorkspace('user-b');

    reportCloudDataUnavailable(
      'transactions',
      'user-a',
      { code: 'permission-denied' },
    );

    expect(getCloudDataStatus().scopes.transactions.state).toBe('pending');
    expect(getCloudDataStatus().unavailableScopes).toEqual([]);
  });

  it('keeps unavailable cloud data blocked instead of treating it as empty', () => {
    setCloudDataWorkspace('user-a');
    reportCloudDataUnavailable(
      'accounts',
      'user-a',
      { code: 'permission-denied' },
    );

    expect(getCloudDataStatus().scopes.accounts).toEqual({
      state: 'unavailable',
      errorCode: 'permission-denied',
    });
    expect(() => assertCloudDataReady('accounts')).toThrow();
  });

  it('renders a full workspace gate, not only a warning banner', () => {
    const shell = source('src/components/layout/app-shell.tsx');

    expect(shell).toContain('shouldGateCloudWorkspace');
    expect(shell).toContain('not treating unavailable cloud data as an empty portfolio');
    expect(shell).toContain('Editing, calculations, and exports are blocked');
  });
});
