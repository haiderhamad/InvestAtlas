import { normalizeInternalRedirectPath } from '@/lib/auth/internal-redirect';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('internal post-auth redirects', () => {
  it.each([
    null,
    '',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'https://attacker.example',
    '//attacker.example',
    '///attacker.example',
    '/\\attacker.example',
    '/%2f%2fattacker.example',
    '/%5cattacker.example',
    '/safe\u0000unsafe',
    '/%0d%0aLocation:evil',
  ])('falls back for unsafe target %p', (target) => {
    expect(normalizeInternalRedirectPath(target)).toBe('/');
  });

  it.each([
    ['/', '/'],
    ['/portfolio', '/portfolio'],
    ['/settings?tab=account#delete', '/settings?tab=account#delete'],
  ])('keeps safe application target %s', (target, expected) => {
    expect(normalizeInternalRedirectPath(target)).toBe(expected);
  });

  it('normalizes the redirect before the Firebase post-auth navigation', () => {
    const login = projectFile('src/app/login/page.tsx');

    expect(login).toContain(
      "normalizeInternalRedirectPath(searchParams.get('next'))",
    );
    expect(login).not.toContain(
      "const nextPath = searchParams.get('next')",
    );
    expect(
      existsSync(join(process.cwd(), 'src/app/verify/page.tsx')),
    ).toBe(false);
  });
});
