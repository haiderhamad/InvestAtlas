import { FirebaseProvider } from './providers/firebase';
import type { DatabaseProvider } from './types';

// Firebase is the one canonical cloud identity and data path. The anonymous
// Local Workspace is implemented by browser stores, not a second backend.
export const db: DatabaseProvider = new FirebaseProvider();
export * from './types';
