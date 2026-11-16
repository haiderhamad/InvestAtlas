import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Price API ready. Use ?symbol=BTC&days=365' });
}
