import {
  LEGAL_TERMS_VERSION,
  normalizeLegalAcceptance,
} from '@/lib/legal/legal-acceptance';

describe('versioned legal acceptance', () => {
  it('accepts only the current version with a valid non-future timestamp', () => {
    expect(normalizeLegalAcceptance({
      version: LEGAL_TERMS_VERSION,
      acceptedAt: '2026-08-02T10:00:00.000Z',
    })).toEqual({
      version: LEGAL_TERMS_VERSION,
      acceptedAt: '2026-08-02T10:00:00.000Z',
    });
  });

  it.each([
    null,
    {},
    { version: '2026-01-01', acceptedAt: '2026-08-02T10:00:00.000Z' },
    { version: LEGAL_TERMS_VERSION, acceptedAt: 'not-a-date' },
    { version: LEGAL_TERMS_VERSION, acceptedAt: '2999-01-01T00:00:00.000Z' },
  ])('rejects stale or malformed acceptance %#', (value) => {
    expect(normalizeLegalAcceptance(value)).toBeNull();
  });
});
