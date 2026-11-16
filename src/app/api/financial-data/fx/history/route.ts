import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  PUBLIC_HISTORY_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import type { CurrencyCode } from '@/lib/financial-data/contracts';
import { fetchEcbFxHistory } from '@/lib/financial-data/fx/ecb';

const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;

function parseCurrency(value: string | null): CurrencyCode | null {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'EUR' || normalized === 'USD' ? normalized : null;
}

function parseDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_HISTORY_RATE_LIMIT);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const from = parseCurrency(searchParams.get('from'));
  const to = parseCurrency(searchParams.get('to'));
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const exactWindow = searchParams.get('exactWindow');
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (
    !from
    || (exactWindow !== null && exactWindow !== 'true' && exactWindow !== 'false')
    || !to
    || start === null
    || end === null
    || start > end
    || end > today
    || (end - start) / DAY_MS > MAX_RANGE_DAYS
  ) {
    return NextResponse.json(
      { error: 'Invalid FX history request' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const observations = await fetchEcbFxHistory(
      from,
      to,
      startDate!,
      endDate!,
      new Date(),
      request.signal,
    );
    const data = observations.flatMap((observation) => {
      if (observation.rate.status !== 'available' || !observation.rate.asOf) return [];
      if (exactWindow === 'true' && (observation.rate.asOf < startDate! || observation.rate.asOf > endDate!)) return [];
      return [{
        date: observation.rate.asOf,
        rate: observation.rate.value,
        asOf: observation.rate.asOf,
      }];
    });
    if (data.length === 0) {
      return NextResponse.json(
        { status: 'unavailable', data: [], sourceAttribution: 'Source: ECB statistics.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      {
        status: 'complete',
        data,
        generatedAt: new Date().toISOString(),
        sourceAttribution: 'Source: ECB statistics.',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, must-revalidate' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable', data: [], error: 'Historical FX reference data is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
