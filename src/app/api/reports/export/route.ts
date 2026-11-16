import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * The legacy exporter reads from the retired Supabase data path while the
 * public Demo now uses Firebase (or an isolated Local Workspace). Returning an
 * empty, authoritative-looking report is a data-integrity failure, and leaving
 * the document generators public creates an unnecessary compute surface.
 *
 * Account portability now uses the bounded client/export-import flow. Keep this
 * unrelated server-side report generator closed until a concrete, safe product
 * requirement exists.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Report export is temporarily unavailable.' },
    {
      status: 410,
      headers: {
        Allow: '',
        'Cache-Control': 'no-store',
      },
    },
  );
}
