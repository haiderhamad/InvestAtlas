import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts/render-private-firestore-rules.mjs');

describe('Private Cloud Firestore Rules template', () => {
  it('binds every existing browser rule to exactly one allowlisted Firebase UID', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const generated = execFileSync(process.execPath, [script, 'test_owner-123'], { encoding: 'utf8' });
    expect(generated).toContain("return request.auth != null && request.auth.uid == 'test_owner-123';");
    expect(generated).toContain('function ownsPath(userId)');
    expect(generated).toContain('validTransaction(request.resource.data)');
    expect(generated).toContain('allow read, write: if false;');
    expect(generated.replace(
      "return request.auth != null && request.auth.uid == 'test_owner-123';",
      'return request.auth != null;',
    )).toBe(source);
  });

  it.each(['../other', '', 'owner uid', 'replace-me', 'owner; true', 'a'.repeat(129)])(
    'refuses unsafe UID %s without producing rules',
    (uid) => {
      const result = spawnSync(process.execPath, [script, uid], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
    },
  );
  it('does not write a private rules file or change canonical rules', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
});
