import { NextResponse } from 'next/server';

/**
 * Manual global cache mutation is intentionally unavailable in the public
 * Demo. Read requests populate their normal bounded caches as needed.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Manual market-data sync is disabled in the public Demo.' },
    {
      status: 405,
      headers: { Allow: 'GET' },
    },
  );
}
