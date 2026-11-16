import { handleEodhdPersonalRequest } from '@/lib/financial-data/providers/eodhd-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  return handleEodhdPersonalRequest(request, 'local');
}
