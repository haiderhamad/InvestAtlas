import { getAuthErrorTranslationKey, getSafeFirebaseAuthErrorCode } from '@/lib/auth/auth-errors';

describe('Firebase authentication error presentation', () => {
  it('does not expose raw Firebase configuration errors', () => {
    expect(
      getAuthErrorTranslationKey({
        code: 'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
        message: 'Firebase: Error (auth/api-key-not-valid...)',
      }),
    ).toBe('Authentication is temporarily unavailable. Please contact the demo owner.');
  });

  it('uses one non-enumerating message for invalid credentials', () => {
    expect(getAuthErrorTranslationKey({ code: 'auth/user-not-found' })).toBe(
      'The email address or password is incorrect.',
    );
    expect(getAuthErrorTranslationKey({ code: 'auth/wrong-password' })).toBe(
      'The email address or password is incorrect.',
    );
  });

  it('keeps provider conflicts explicit without automatic linking', () => {
    expect(
      getAuthErrorTranslationKey({
        code: 'auth/account-exists-with-different-credential',
      }),
    ).toContain('no data was migrated');
  });

  it('provides specific advice for an unauthorized Firebase sign-in domain', () => {
    expect(getAuthErrorTranslationKey({ code: 'auth/unauthorized-domain' })).toBe(
      'Google sign-in is not authorized for this hostname in Firebase. Check Authentication settings and authorized domains.',
    );
  });

  it('returns only a safe, bounded diagnostic code without revealing messages or secrets', () => {
    expect(getSafeFirebaseAuthErrorCode({ code: 'auth/unauthorized-domain', message: 'private secret' })).toBe('auth/unauthorized-domain');
    expect(getSafeFirebaseAuthErrorCode({ code: 'auth/internal-error' })).toBe('auth/internal-error');
    expect(getSafeFirebaseAuthErrorCode({ code: 'auth/invalid-key?token=secret' })).toBeNull();
    expect(getSafeFirebaseAuthErrorCode({ code: 'auth/' + 'x'.repeat(500) })).toBeNull();
    expect(getSafeFirebaseAuthErrorCode(new Error('secret'))).toBeNull();
  });

  it('falls back to a generic localized key', () => {
    expect(getAuthErrorTranslationKey(new Error('sensitive details'))).toBe(
      'Authentication failed. Please try again.',
    );
  });
});
