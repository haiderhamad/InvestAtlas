import { POST } from '@/app/api/coins/audit/route';

describe('POST /api/coins/audit', () => {
  test('keeps the unused bulk mutation surface disabled', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error:
        'Bulk Shariah audit is disabled. Use the user-initiated single-asset evidence check.',
    });
  });
});
