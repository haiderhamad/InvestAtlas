type FirebaseLikeError = {
  code?: unknown;
};

/** Only an inert Firebase auth error identifier, never the raw error message. */
export function getSafeFirebaseAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as FirebaseLikeError).code;
  return typeof code === 'string' && /^auth\/[a-z0-9][a-z0-9-]{0,78}$/.test(code)
    ? code : null;
}

export function getAuthErrorTranslationKey(error: unknown): string {
  const code =
    error && typeof error === 'object'
      ? String((error as FirebaseLikeError).code ?? '')
      : '';

  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Google sign-in is not authorized for this hostname in Firebase. Check Authentication settings and authorized domains.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-email':
      return 'The email address or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email address.';
    case 'auth/weak-password':
      return 'Choose a stronger password and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'This email already uses another sign-in method. Sign in with that method first; no data was migrated.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'The Google sign-in window was blocked. Allow pop-ups and try again.';
    case 'auth/network-request-failed':
      return 'Authentication could not reach Firebase. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait and try again.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'Authentication is temporarily unavailable. Please contact the demo owner.';
    default:
      return 'Authentication failed. Please try again.';
  }
}
