import fs from 'node:fs';
import path from 'node:path';

const firebaseSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/firebase.ts'),
  'utf8',
);

describe('Firebase Analytics privacy default', () => {
  it('does not import or initialize Firebase Analytics', () => {
    expect(firebaseSource).not.toContain('firebase/analytics');
    expect(firebaseSource).not.toContain('getAnalytics');
    expect(firebaseSource).not.toContain('NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID');
  });
});
