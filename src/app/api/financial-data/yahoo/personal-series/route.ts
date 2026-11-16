import { handleYahooPersonalRequest } from '@/lib/financial-data/providers/yahoo-personal-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// In private_cloud, the outer proxy and this handler independently verify
// that the Firebase ID token belongs to the sole configured owner.
export async function POST(request: Request): Promise<Response> {
  return handleYahooPersonalRequest(request, 'private');
}
