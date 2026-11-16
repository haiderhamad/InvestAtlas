import { NextResponse } from 'next/server';
import { getFinancialDataProviders } from '@/lib/financial-data/providers/catalog';

export async function GET() {
  const providers = getFinancialDataProviders();
  return NextResponse.json(providers, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export async function POST() {
  return NextResponse.json(
    { error: 'Provider configuration is read-only in the public demo.' },
    {
      status: 405,
      headers: {
        Allow: 'GET',
        'Cache-Control': 'no-store',
      },
    },
  );
}
