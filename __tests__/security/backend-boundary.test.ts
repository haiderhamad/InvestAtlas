import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('canonical backend boundary', () => {
  it('uses Firebase as the only cloud provider', () => {
    const database = projectFile('src/lib/db/index.ts');

    expect(database).toContain('new FirebaseProvider()');
    expect(database).not.toContain('SupabaseProvider');
    expect(database).not.toContain('NEXT_PUBLIC_DB_PROVIDER');
  });

  it('contains no Supabase runtime dependency or auth callback', () => {
    const packageJson = projectFile('package.json');
    const login = projectFile('src/app/login/page.tsx');

    expect(packageJson).not.toContain('@supabase/');
    expect(login).not.toContain('/auth/callback');
  });

  it('defines baseline browser security headers', () => {
    const config = projectFile('next.config.ts');

    expect(config).toContain('X-Content-Type-Options');
    expect(config).toContain('X-Frame-Options');
    expect(config).toContain('Referrer-Policy');
    expect(config).toContain('Permissions-Policy');
  });
});
