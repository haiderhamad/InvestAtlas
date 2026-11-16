'use client';

import { auth } from '@/lib/firebase';

async function waitForFirebaseAuth() {
  if (!auth) return;
  const maybeReadyAuth = auth as typeof auth & { authStateReady?: () => Promise<void> };
  if (typeof maybeReadyAuth.authStateReady === 'function') {
    await maybeReadyAuth.authStateReady();
  }
}

export async function getFirebaseIdToken(): Promise<string | null> {
  return (await getFirebaseApiIdentity())?.token ?? null;
}

export interface FirebaseApiIdentity {
  userId: string;
  token: string;
}

export async function getFirebaseApiIdentity(): Promise<FirebaseApiIdentity | null> {
  if (typeof window === 'undefined') return null;
  if (!auth) return null;
  await waitForFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  const userId = currentUser.uid;
  const token = await currentUser.getIdToken();
  if (auth.currentUser?.uid !== userId) {
    throw new Error('Firebase authentication changed during request');
  }
  return { userId, token };
}

export async function getFirebaseAuthHeaders(headers: HeadersInit = {}): Promise<HeadersInit> {
  const token = await getFirebaseIdToken();
  return token
    ? {
        ...headers,
        Authorization: `Bearer ${token}`,
      }
    : headers;
}
