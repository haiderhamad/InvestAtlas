import {
  resolveFirebasePublicConfig,
  type FirebasePublicConfigInput,
} from '@/lib/firebase-config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VALID_FIREBASE_CONFIG: FirebasePublicConfigInput = {
  apiKey: `AIza${'A'.repeat(32)}`,
  authDomain: 'investatlas-demo.firebaseapp.com',
  projectId: 'investatlas-demo',
  storageBucket: 'investatlas-demo.firebasestorage.app',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef1234567890',
};

describe('Firebase public configuration boundary', () => {
  it('accepts a complete, syntactically valid Firebase web configuration', () => {
    const resolved = resolveFirebasePublicConfig(VALID_FIREBASE_CONFIG);

    expect(resolved).toEqual({
      config: VALID_FIREBASE_CONFIG,
      isConfigured: true,
    });
  });

  it.each([
    ['apiKey', 'your-firebase-web-api-key'],
    ['authDomain', 'your-project.firebaseapp.com'],
    ['projectId', 'your-project-id'],
    ['storageBucket', 'your-project.firebasestorage.app'],
    ['messagingSenderId', 'your-sender-id'],
    ['appId', 'your-firebase-web-app-id'],
  ] as const)(
    'treats the example %s value as unconfigured',
    (key, placeholder) => {
      const resolved = resolveFirebasePublicConfig({
        ...VALID_FIREBASE_CONFIG,
        [key]: placeholder,
      });

      expect(resolved.isConfigured).toBe(false);
      expect(Object.values(resolved.config)).not.toContain(placeholder);
    },
  );

  it.each([
    ['apiKey', 'not-a-google-api-key'],
    ['authDomain', 'https://investatlas-demo.firebaseapp.com/path'],
    ['projectId', 'InvestAtlas Demo'],
    ['storageBucket', 'https://investatlas-demo.firebasestorage.app'],
    ['messagingSenderId', 'sender-123'],
    ['appId', 'not-a-firebase-app-id'],
  ] as const)(
    'fails closed for an obviously invalid %s',
    (key, invalidValue) => {
      expect(
        resolveFirebasePublicConfig({
          ...VALID_FIREBASE_CONFIG,
          [key]: invalidValue,
        }).isConfigured,
      ).toBe(false);
    },
  );

  it('fails closed when configuration is incomplete', () => {
    expect(
      resolveFirebasePublicConfig({
        ...VALID_FIREBASE_CONFIG,
        appId: undefined,
      }).isConfigured,
    ).toBe(false);
  });

  it('does not log configuration values while validating them', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      resolveFirebasePublicConfig(VALID_FIREBASE_CONFIG);
      resolveFirebasePublicConfig({
        ...VALID_FIREBASE_CONFIG,
        apiKey: 'invalid-secret-looking-value',
      });

      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('does not initialize Firebase Auth with the unconfigured placeholder', () => {
    const firebaseModule = readFileSync(
      join(process.cwd(), 'src/lib/firebase.ts'),
      'utf8',
    );

    expect(firebaseModule).toContain(
      'const auth = isFirebaseConfigured ? getAuth(app) : null;',
    );
  });
});
