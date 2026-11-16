import { handleYahooPersonalRequest } from '@/lib/financial-data/providers/yahoo-personal-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Loopback or explicitly configured trusted-WLAN public reads; no API key.
export async function POST(request: Request): Promise<Response> {
  return handleYahooPersonalRequest(request, 'local');
}
