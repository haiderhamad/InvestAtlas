import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Private Cloud API proxy boundary', () => {
  const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
  it('restricts private API access using verified identity and server-only owner UID', () => {
    expect(source).toContain('INVESTATLAS_PRIVATE_OWNER_UID');
    expect(source).toContain("identitytoolkit.googleapis.com/v1/accounts:lookup");
    expect(source).toContain('uid !== ownerUid');
    expect(source).toContain('return failure(403)');
    expect(source).toContain("matcher: '/api/:path*'");
    expect(source).toContain("'Cache-Control': 'no-store'");
  });
  it('never exports owner config in the browser bundle', () => {
    expect(source).not.toContain('NEXT_PUBLIC_INVESTATLAS_PRIVATE_OWNER_UID');
  });
  it('does not allow private API operations in Local Personal mode', () => {
    expect(source).toContain("INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'");
    expect(source).toContain('isLocalFirebaseApiPath(request.nextUrl.pathname)');
    expect(source).toContain("request.nextUrl.pathname.startsWith('/api/prices/')");
  });
});
