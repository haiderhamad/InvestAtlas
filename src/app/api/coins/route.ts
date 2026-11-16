import { NextResponse } from 'next/server';
import { getCoins } from '@/lib/config/coins-store';

export async function GET() {
  try {
    const coins = await getCoins();
    return NextResponse.json(
      { coins },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch {
    console.error('[GET /api/coins] failed');
    return NextResponse.json({ error: 'Coin list could not be loaded.' }, { status: 500 });
  }
}

function readOnlyResponse() {
  return NextResponse.json(
    { error: 'Coin configuration is read-only in the public demo.' },
    {
      status: 405,
      headers: {
        Allow: 'GET',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function POST() {
  return readOnlyResponse();
}

export async function DELETE() {
  return readOnlyResponse();
}
