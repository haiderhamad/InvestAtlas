/** @jest-environment jsdom */
import {
  clearPublicSourceConsent, isPublicSourceApproved, readPublicSourceConsent,
  reconcilePublicSourceConsent, setPublicSourceConsent,
} from '@/lib/financial-data/providers/public-source-consent';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));

describe('session-only public-source consent', () => {
  beforeEach(() => { sessionStorage.clear(); clearPublicSourceConsent(); });
  afterEach(() => { sessionStorage.clear(); clearPublicSourceConsent(); });

  it('does not enable any public source before owner opt-in', () => {
    expect(readPublicSourceConsent('owner-A')).toEqual([]);
    expect(isPublicSourceApproved('owner-A', 'binance')).toBe(false);
  });

  it('keeps explicit consent only in tab session storage and scopes it to the owner', () => {
    setPublicSourceConsent('owner-A', ['coinpaprika', 'binance']);
    expect(readPublicSourceConsent('owner-A')).toEqual(['coinpaprika', 'binance']);
    expect(readPublicSourceConsent('owner-B')).toEqual([]);
    expect(localStorage.getItem('investatlas.public-sources.session.v2')).toBeNull();
    reconcilePublicSourceConsent('owner-A');
    expect(isPublicSourceApproved('owner-A', 'binance')).toBe(true);
    reconcilePublicSourceConsent('owner-B');
    expect(readPublicSourceConsent('owner-A')).toEqual([]);
  });

  it('clears at sign-out and does not accept malformed stored consent', () => {
    setPublicSourceConsent('owner-A', ['spot', 'kraken']);
    clearPublicSourceConsent();
    expect(isPublicSourceApproved('owner-A', 'spot')).toBe(false);
    sessionStorage.setItem('investatlas.public-sources.session.v3', '{"owner":"owner-A","sources":["unknown-feed","binance"]}');
    expect(readPublicSourceConsent('owner-A')).toEqual(['binance']);
  });
});
