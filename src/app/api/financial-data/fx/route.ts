import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  PUBLIC_CURRENT_PRICE_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import type { CurrencyCode } from '@/lib/financial-data/contracts';
import { fetchEcbCurrentFx } from '@/lib/financial-data/fx/ecb';

function parseCurrency(value: string | null): CurrencyCode | null {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'EUR' || normalized === 'USD'
    ? normalized
    : null;
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_CURRENT_PRICE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const from = parseCurrency(searchParams.get('from'));
    const to = parseCurrency(searchParams.get('to'));
    if (!from || !to) {
      return NextResponse.json(
        { error: 'Unsupported FX currency' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const observation = await fetchEcbCurrentFx(from, to);
    if (observation.rate.status === 'unavailable') {
      return NextResponse.json(
        {
          status: 'unavailable',
          error: 'Current FX reference data is temporarily unavailable',
          reason: observation.rate.reason,
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    return NextResponse.json(
      {
        status:
          observation.rate.freshness === 'stale'
            ? 'partial'
            : 'complete',
        data: observation,
        generatedAt: new Date().toISOString(),
        sourceAttribution: 'Source: ECB statistics.',
      },
      {
        headers: {
          'Cache-Control': observation.rate.freshness === 'fresh'
            ? 'public, s-maxage=300, must-revalidate'
            : 'no-store',
        },
      },
    );
  } catch {
    console.error('Current FX request failed');
    return NextResponse.json(
      {
        status: 'unavailable',
        error: 'Current FX reference data is temporarily unavailable',
        reason: 'provider_unavailable',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
