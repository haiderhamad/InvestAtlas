export type AuthProviderType = 'firebase';

export interface DbUser {
  id: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
}

export interface DbSession {
  user: DbUser | null;
}

export interface AuthResponse {
  user: DbUser | null;
  session: DbSession | null;
  error: Error | null;
}

export interface OAuthSignInResult {
  user: DbUser;
  isNewUser: boolean;
  providerIds: string[];
}

export interface DatabaseProvider {
  type: AuthProviderType;
  
  // Config check
  isConfigured(): boolean;
  
  // Auth
  signInWithPassword(email: string, password: string): Promise<AuthResponse>;
  signUp(email: string, password: string, fullName?: string): Promise<AuthResponse>;
  signInWithOAuth(provider: 'google'): Promise<OAuthSignInResult>;
  signOut(): Promise<void>;
  resetPasswordForEmail(email: string): Promise<{ error: Error | null }>;
  
  // Session handling
  getSession(): Promise<DbSession | null>;
  onAuthStateChange(callback: (session: DbSession | null) => void): () => void;
}
