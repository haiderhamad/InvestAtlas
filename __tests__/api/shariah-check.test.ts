import { NextRequest } from 'next/server';

import { POST } from '@/app/api/coins/check/route';

describe('POST /api/coins/check', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 404 }));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function check(symbol: string, type = 'crypto') {
    const request = new NextRequest('http://localhost/api/coins/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, type }),
    });
    const response = await POST(request);
    return response.json();
  }

  test('does not promote a legacy positive crypto allow-list entry to compliant', async () => {
    const result = await check('BTC');

    expect(result).toEqual(expect.objectContaining({
      status: 'review_required',
      halal: false,
      requiresManualReview: true,
    }));
    expect(result).not.toHaveProperty('riskCategory');
  });

  test('returns insufficient_data when no sourced evidence exists', async () => {
    const result = await check('UNKNOWN');

    expect(result).toEqual(expect.objectContaining({
      status: 'insufficient_data',
      halal: false,
      requiresManualReview: true,
    }));
    expect(result.shariahResult.sourceBreakdown).toEqual([]);
  });

  test('preserves an explicit internal non-compliant rule as a negative result', async () => {
    const result = await check('AAVE');

    expect(result).toEqual(expect.objectContaining({
      status: 'non_compliant',
      halal: false,
      requiresManualReview: false,
    }));
    expect(result).not.toHaveProperty('riskCategory');
  });

  test('rejects path-like symbols before constructing provider URLs', async () => {
    const request = new NextRequest('http://localhost/api/coins/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: '../BTC', type: 'crypto' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Symbol format is invalid.' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects unsupported asset types', async () => {
    const request = new NextRequest('http://localhost/api/coins/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTC', type: 'arbitrary' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Asset type is invalid.' });
  });

  test('rejects oversized request bodies before evaluating a symbol', async () => {
    const request = new NextRequest('http://localhost/api/coins/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTC', padding: 'x'.repeat(17 * 1024) }),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request payload is too large' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
