export const FIREBASE_E2E_PROJECT = 'demo-investatlas-e2e';

export interface FirebaseEmulatorInput {
  flag: string | undefined;
  nodeEnv: string | undefined;
  projectId: string | undefined;
  hostname?: string;
}

/** Explicit local QA only. Invalid opt-in must never fall back to live Firebase. */
export function resolveFirebaseEmulatorMode(input: FirebaseEmulatorInput): boolean {
  if (input.flag !== 'true') return false;
  if (input.nodeEnv !== 'development' || input.projectId !== FIREBASE_E2E_PROJECT) {
    throw new Error('Firebase emulator mode requires development and the isolated E2E project.');
  }
  // Server rendering has no browser identity and must not initialize Auth.
  if (input.hostname === undefined) return false;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(input.hostname)) {
    throw new Error('Firebase emulator mode is restricted to loopback browser origins.');
  }
  return true;
}
