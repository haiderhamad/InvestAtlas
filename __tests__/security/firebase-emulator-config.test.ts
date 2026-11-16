import { resolveFirebaseEmulatorMode } from '@/lib/firebase-emulator-config';

const localQA = {
  flag: 'true',
  nodeEnv: 'development',
  projectId: 'demo-investatlas-e2e',
  hostname: 'localhost',
};

describe('isolated Firebase browser emulator opt-in', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts explicit local QA on %s', (hostname) => {
    expect(resolveFirebaseEmulatorMode({ ...localQA, hostname })).toBe(true);
  });

  it.each([undefined, '', 'false', '1', 'TRUE'])('requires the exact opt-in flag %s', (flag) => {
    expect(resolveFirebaseEmulatorMode({ ...localQA, flag })).toBe(false);
  });

  it.each(['production', 'test', undefined])('refuses opted-in %s runtime', (nodeEnv) => {
    expect(() => resolveFirebaseEmulatorMode({ ...localQA, nodeEnv })).toThrow();
  });

  it.each(['investatlas-production', 'demo-other', '', undefined])('refuses project %s', (projectId) => {
    expect(() => resolveFirebaseEmulatorMode({ ...localQA, projectId })).toThrow();
  });

  it.each(['invest-atlas-tan.vercel.app', 'localhost.example.com', '192.168.1.2', '0.0.0.0', '127.0.0.2'])('refuses non-allowlisted browser host %s', (hostname) => {
    expect(() => resolveFirebaseEmulatorMode({ ...localQA, hostname })).toThrow();
  });

  it('does not enable browser auth during server rendering', () => {
    expect(resolveFirebaseEmulatorMode({ ...localQA, hostname: undefined })).toBe(false);
  });
});
