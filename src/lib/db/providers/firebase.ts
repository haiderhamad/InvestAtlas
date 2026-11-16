import type {
  AuthResponse,
  DatabaseProvider,
  DbSession,
  DbUser,
  OAuthSignInResult,
} from '../types';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  sendPasswordResetEmail, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup,
  getAdditionalUserInfo,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';

const mapFirebaseUserToDbUser = (user: FirebaseUser): DbUser => ({
  id: user.uid,
  email: user.email ?? undefined,
  fullName: user.displayName ?? undefined,
  avatarUrl: user.photoURL ?? undefined,
});

function requireConfiguredAuth() {
  if (!auth) {
    throw Object.assign(
      new Error('Firebase authentication is not configured.'),
      { code: 'auth/configuration-not-found' },
    );
  }
  return auth;
}

export class FirebaseProvider implements DatabaseProvider {
  type = 'firebase' as const;

  isConfigured(): boolean {
    return isFirebaseConfigured && auth !== null;
  }

  async signInWithPassword(email: string, password: string): Promise<AuthResponse> {
    try {
      const credential = await signInWithEmailAndPassword(requireConfiguredAuth(), email, password);
      const user = credential.user;
      const dbUser = mapFirebaseUserToDbUser(user);
      const session: DbSession = { user: dbUser };
      return { user: dbUser, session, error: null };
    } catch (error) {
      return { user: null, session: null, error: error as Error };
    }
  }

  async signUp(email: string, password: string, fullName?: string): Promise<AuthResponse> {
    try {
      const credential = await createUserWithEmailAndPassword(requireConfiguredAuth(), email, password);
      const user = credential.user;

      const normalizedFullName = fullName?.trim();
      if (normalizedFullName) {
        await updateProfile(user, { displayName: normalizedFullName });
      }

      const dbUser = mapFirebaseUserToDbUser(user);
      const session: DbSession = { user: dbUser };
      return { user: dbUser, session, error: null };
    } catch (error) {
      return { user: null, session: null, error: error as Error };
    }
  }

  async signInWithOAuth(provider: 'google'): Promise<OAuthSignInResult> {
    const googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(requireConfiguredAuth(), googleProvider);

    return {
      user: mapFirebaseUserToDbUser(credential.user),
      isNewUser: getAdditionalUserInfo(credential)?.isNewUser ?? false,
      providerIds: credential.user.providerData
        .map((identity) => identity.providerId)
        .filter(Boolean),
    };
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(requireConfiguredAuth());
  }

  async resetPasswordForEmail(email: string): Promise<{ error: Error | null }> {
    try {
      await sendPasswordResetEmail(requireConfiguredAuth(), email);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async getSession(): Promise<DbSession | null> {
    const user = auth?.currentUser;
    if (!user) return null;
    return { user: mapFirebaseUserToDbUser(user) };
  }

  onAuthStateChange(callback: (session: DbSession | null) => void): () => void {
    if (!auth) {
      callback(null);
      return () => {};
    }
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        callback({ user: mapFirebaseUserToDbUser(user) });
      } else {
        callback(null);
      }
    });
  }
}
