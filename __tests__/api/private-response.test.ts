import { privateJson } from '@/lib/api/private-response';

describe('private API JSON responses', () => {
  it('marks user-specific JSON as private and non-cacheable', async () => {
    const response = privateJson(
      { ok: true },
      {
        status: 202,
        headers: {
          'Cache-Control': 'public, max-age=3600',
          Pragma: 'cache',
          'X-Test-Header': 'preserved',
        },
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0',
    );
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Test-Header')).toBe('preserved');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
