'use client';

import { db } from '@/lib/db';
import { Gem, Mail, Lock, ArrowRight, Eye, EyeOff, UserRound, AlertCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { normalizeInternalRedirectPath } from '@/lib/auth/internal-redirect';
import { getAuthErrorTranslationKey, getSafeFirebaseAuthErrorCode } from '@/lib/auth/auth-errors';
import { useAuth } from '@/lib/auth/auth-context';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import {
  readLegalAcceptance,
  recordLegalAcceptance,
} from '@/lib/legal/legal-acceptance';

type AuthMode = 'login' | 'signup' | 'forgot';

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useAppTranslation();
  const { user } = useAuth();
  const nextPath = normalizeInternalRedirectPath(searchParams.get('next'));
  const callbackError = searchParams.get('error');
  const describeAuthError = (authError: unknown): string => {
    const message = t(getAuthErrorTranslationKey(authError));
    if (process.env.NODE_ENV !== 'development') return message;
    const code = getSafeFirebaseAuthErrorCode(authError);
    return code ? `${message} (${code})` : message;
  };

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    callbackError
      ? t(process.env.NODE_ENV === 'development'
        ? 'The sign-in URL contains an error parameter. Open /login without it and try again.'
        : 'Authentication failed. Please try again.')
      : null,
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [newGoogleWorkspace, setNewGoogleWorkspace] = useState(false);
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);

  // Apply dark theme for the login page
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    setAcceptedLegalTerms(Boolean(readLegalAcceptance()));
  }, []);

  useEffect(() => {
    if (user && !googleLoading && !newGoogleWorkspace) {
      router.replace(nextPath);
    }
  }, [googleLoading, newGoogleWorkspace, nextPath, router, user]);

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (mode === 'signup' && !acceptedLegalTerms) {
      setError(t('You must accept the Terms of Service and Privacy Policy to continue.'));
      return;
    }

    setLoading(true);

    try {
      if (mode === 'signup') {
        recordLegalAcceptance();
        const { error: signUpError } = await db.signUp(email, password, fullName);

        if (signUpError) {
          throw signUpError;
        }

        router.push(nextPath);
        router.refresh();
      } else {
        const { error: signInError } = await db.signInWithPassword(email, password);

        if (signInError) {
          throw signInError;
        }

        router.push(nextPath);
        router.refresh();
      }
    } catch (authError) {
      setError(describeAuthError(authError));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (!email.trim()) {
        throw new Error(t('Please enter your email address first.'));
      }

      const { error: resetError } = await db.resetPasswordForEmail(email);

      if (resetError) {
        throw resetError;
      }

      setSuccessMessage(t('Password reset link sent! Check your email inbox.'));
    } catch (authError) {
      setError(describeAuthError(authError));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!acceptedLegalTerms) {
      setError(t('You must accept the Terms of Service and Privacy Policy to continue.'));
      return;
    }

    setGoogleLoading(true);
    recordLegalAcceptance();

    try {
      const result = await db.signInWithOAuth('google');
      if (result.isNewUser) {
        setNewGoogleWorkspace(true);
        setGoogleLoading(false);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch (authError) {
      setError(describeAuthError(authError));
      setGoogleLoading(false);
    }
  };

  const continueWithNewGoogleWorkspace = () => {
    router.push(nextPath);
    router.refresh();
  };

  const returnToOriginalSignIn = async () => {
    await db.signOut();
    setNewGoogleWorkspace(false);
    setMode('login');
    setPassword('');
    setError(null);
    setSuccessMessage(null);
  };

  const isLogin = mode === 'login';
  const isForgot = mode === 'forgot';

  if (INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'
    || INVESTATLAS_DEPLOYMENT_MODE === 'public_demo') {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-card">
            <div className="login-card-header">
              <h1>{t(INVESTATLAS_DEPLOYMENT_MODE === 'public_demo' ? 'Read-only demo snapshot' : 'Local Workspace')}</h1>
              <p>{t(INVESTATLAS_DEPLOYMENT_MODE === 'public_demo'
                ? 'Synthetic portfolio examples — not live market observations or personal data.'
                : 'Data stays in this browser')}</p>
            </div>
            <Link href="/" className="btn btn-primary">{t('Back to Dashboard')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-ambient" />

      <div className="login-container">
        <div className="login-brand">
          <div className="login-logo">
            <Gem size={28} />
          </div>
          <h1 className="login-title">InvestAtlas</h1>
          <p className="login-tagline">
            {t('Shariah-aware portfolio tracking, tax analysis, and strategy backtesting — with transparent evidence and uncertainty.')}
          </p>
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <h2>{isForgot ? t('Reset your password') : isLogin ? t('Welcome back') : t('Create your account')}</h2>
            <p>
              {isForgot
                ? t('Enter your email and we’ll send you a reset link')
                : isLogin
                ? t('Sign in to access your portfolio')
                : t('Start tracking your investments today')}
            </p>
          </div>

          {error && (
            <div className="login-alert error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="login-alert success" role="status">
              <Mail size={16} />
              <span>{successMessage}</span>
            </div>
          )}

          {newGoogleWorkspace && (
            <div className="login-alert warning" role="status">
              <AlertCircle size={16} />
              <div>
                <strong>{t('A new Google cloud workspace was created.')}</strong>
                <p style={{ marginTop: 6 }}>
                  {t('If you expected existing portfolio data, sign out and use the original sign-in method. No Local Workspace or cloud data was migrated.')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={continueWithNewGoogleWorkspace}
                  >
                    {t('Continue with new workspace')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void returnToOriginalSignIn()}
                  >
                    {t('Sign out and use email')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isForgot && !newGoogleWorkspace && (
            <>
              <label className="login-legal-consent">
                <input
                  type="checkbox"
                  checked={acceptedLegalTerms}
                  onChange={(event) => setAcceptedLegalTerms(event.target.checked)}
                />
                <span>
                  {t('I agree to the')}{' '}
                  <Link href="/terms" target="_blank" rel="noreferrer">{t('Terms of Service')}</Link>{' '}
                  {t('and the')}{' '}
                  <Link href="/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')}</Link>.
                </span>
              </label>

              <div className="login-social-grid">
                <button
                  type="button"
                  className="login-google-btn"
                  aria-busy={googleLoading}
                  onClick={handleGoogleAuth}
                  disabled={googleLoading || loading || !acceptedLegalTerms}
                >
                  {googleLoading ? (
                    <span className="login-spinner" />
                  ) : (
                    <GoogleIcon size={20} />
                  )}
                  <span>Google</span>
                </button>

              </div>

              <div className="login-divider">
                <span>{t('or continue with email')}</span>
              </div>
            </>
          )}

          {!newGoogleWorkspace && (
          <form onSubmit={isForgot ? handleForgotPassword : handleEmailAuth} className="login-form">
            {!isLogin && !isForgot && (
              <div className="login-field">
                <label htmlFor="fullName">{t('Full name')}</label>
                <div className="login-input-wrap">
                  <UserRound size={16} className="login-input-icon" />
                  <input
                    id="fullName"
                    type="text"
                    placeholder={t('Your full name')}
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required={!isLogin}
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="email">{t('Email address')}</label>
              <div className="login-input-wrap">
                <Mail size={16} className="login-input-icon" />
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {!isForgot && (
            <div className="login-field">
              <label htmlFor="password">{t('Password')}</label>
              <div className="login-input-wrap">
                <Lock size={16} className="login-input-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isLogin ? t('Enter your password') : t('Create a password (min 6 chars)')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={6}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-controls="password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? t('Hide password') : t('Show password')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            )}

            {isLogin && (
              <div className="login-forgot">
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(null); setSuccessMessage(null); }}
                >
                  {t('Forgot password?')}
                </button>
              </div>
            )}

            {!isForgot && (
              <button
                type="submit"
                className="login-submit-btn"
                aria-label={isLogin ? t('Sign in') : t('Create account')}
                aria-busy={loading}
                disabled={loading || googleLoading || (!isLogin && !acceptedLegalTerms)}
              >
                {loading ? (
                  <span className="login-spinner" />
                ) : (
                  <>
                    <span>{isLogin ? t('Sign in') : t('Create account')}</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}

            {isForgot && (
              <button
                type="submit"
                className="login-submit-btn"
                aria-label={t('Send reset link')}
                aria-busy={loading}
                disabled={loading}
              >
                {loading ? (
                  <span className="login-spinner" />
                ) : (
                  <>
                    <span>{t('Send reset link')}</span>
                    <Mail size={16} />
                  </>
                )}
              </button>
            )}
          </form>
          )}

          {!newGoogleWorkspace && <div className="login-switch">
            {isForgot ? (
              <p>
                {t('Remember your password?')}{' '}
                <button type="button" onClick={() => { setMode('login'); setError(null); setSuccessMessage(null); }}>
                  {t('Back to sign in')}
                </button>
              </p>
            ) : isLogin ? (
              <p>
                {t("Don't have an account?")}{' '}
                <button type="button" onClick={() => { setMode('signup'); setError(null); setSuccessMessage(null); }}>
                  {t('Sign up')}
                </button>
              </p>
            ) : (
              <p>
                {t('Already have an account?')}{' '}
                <button type="button" onClick={() => { setMode('login'); setError(null); setSuccessMessage(null); }}>
                  {t('Sign in')}
                </button>
              </p>
            )}
          </div>}
        </div>

        <nav className="login-legal" aria-label={t('Legal and data information')}>
          <Link href="/terms">{t('Terms of Service')}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy">{t('Privacy Policy')}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/financial-data-disclaimer">{t('Financial Data Disclaimer')}</Link>
        </nav>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
