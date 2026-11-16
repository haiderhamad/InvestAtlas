import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { resolveFirebasePublicConfig } from "@/lib/firebase-config";
import { resolveFirebaseEmulatorMode } from '@/lib/firebase-emulator-config';
import { INVESTATLAS_DEPLOYMENT_MODE, modeAllowsFirebase } from '@/lib/runtime/deployment-mode';

const emulatorRequested = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === 'true';
const emulatorEnabled = resolveFirebaseEmulatorMode({
  flag: process.env.NEXT_PUBLIC_FIREBASE_EMULATORS,
  nodeEnv: process.env.NODE_ENV,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  hostname: typeof window === 'undefined' ? undefined : window.location.hostname,
});

const {
  config: firebaseConfig,
  isConfigured: hasValidFirebaseConfig,
} = resolveFirebasePublicConfig({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
if (INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' && !hasValidFirebaseConfig) {
  throw new Error('Private Cloud requires a complete user-owned Firebase web configuration.');
}

const isFirebaseConfigured = hasValidFirebaseConfig && (!emulatorRequested || emulatorEnabled)
  && modeAllowsFirebase(INVESTATLAS_DEPLOYMENT_MODE);

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
// Do not initialize Firebase Auth with the safe placeholder config. The Auth
// SDK otherwise contacts Google with the placeholder API key even though the
// app correctly selected the anonymous Local Workspace.
const auth = isFirebaseConfigured ? getAuth(app) : null;
const db = getFirestore(app);

if (emulatorEnabled) {
  if (!auth || app.options.projectId !== 'demo-investatlas-e2e') {
    throw new Error('Firebase emulator initialization requires the isolated E2E configuration.');
  }
  // Firebase app/service instances survive HMR; remember Firestore connection
  // on the global object rather than reconnecting an already-used instance.
  const runtime = globalThis as typeof globalThis & {
    __investAtlasEmulatorFirestore?: WeakSet<object>;
  };
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  const connected = runtime.__investAtlasEmulatorFirestore ??= new WeakSet<object>();
  if (!connected.has(db)) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connected.add(db);
  }
}

export { auth, db, isFirebaseConfigured };
