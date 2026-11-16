import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Bulk Shariah audit is disabled. Use the user-initiated single-asset evidence check.',
    },
    {
      status: 404,
    },
  );
}
