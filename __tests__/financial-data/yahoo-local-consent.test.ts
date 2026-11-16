/** @jest-environment jsdom */
import {
  clearPublicSourceConsent, isPublicSourceApproved, readPublicSourceConsent,
  reconcilePublicSourceConsent, setPublicSourceConsent,
} from '@/lib/financial-data/providers/public-source-consent';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'local_personal' }));

describe('local personal manual Yahoo consent', () => {
  beforeEach(() => { sessionStorage.clear(); clearPublicSourceConsent(); });
  afterEach(() => { clearPublicSourceConsent(); });

  it('does not permit Yahoo automatically after entering the local workspace', () => {
    expect(readPublicSourceConsent('local-personal-provider')).toEqual([]);
    expect(isPublicSourceApproved('local-personal-provider', 'yahoo')).toBe(false);
  });

  it('enables approved sources only for this tab and owner, and clears on exit', () => {
    setPublicSourceConsent('local-personal-provider', ['yahoo', 'spot']);
    expect(readPublicSourceConsent('local-personal-provider')).toEqual(['yahoo', 'spot']);
    expect(isPublicSourceApproved('another-owner', 'yahoo')).toBe(false);
    reconcilePublicSourceConsent(null);
    expect(readPublicSourceConsent('local-personal-provider')).toEqual([]);
  });
});
