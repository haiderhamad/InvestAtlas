import { NextResponse } from 'next/server';
import {
  ApiPayloadError,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import {
  enforceRateLimit,
  PUBLIC_COMPUTE_RATE_LIMIT,
} from '@/lib/api/rate-limit';
import {
  isBacktestParameters,
  isBacktestSeries,
  MAX_BACKTEST_DATA_POINTS,
} from '@/lib/strategy/validation';

const MAX_REQUEST_BYTES = 512 * 1024;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, PUBLIC_COMPUTE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await readBoundedJson(request, MAX_REQUEST_BYTES);
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    const { asset, parameters, prices, dates } = body;

    if (
      typeof asset !== 'string'
      || !ASSET_PATTERN.test(asset.trim().toUpperCase())
      || !isBacktestParameters(parameters)
      || !Array.isArray(dates)
      || !isBacktestSeries(prices, dates, MAX_BACKTEST_DATA_POINTS)
    ) {
      return NextResponse.json({ error: 'Insufficient price data' }, { status: 400 });
    }

    const { runBacktest } = await import('@/lib/strategy/backtest-engine');
    const result = runBacktest(prices, dates, parameters, asset.trim().toUpperCase());
    
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ApiPayloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Backtest request failed');
    return NextResponse.json({ error: 'Backtest failed' }, { status: 500 });
  }
}
