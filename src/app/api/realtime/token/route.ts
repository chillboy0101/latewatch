// app/api/realtime/token/route.ts
import { NextResponse } from 'next/server';
import { Rest } from 'ably';
import { currentUser } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.ABLY_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'ABLY_API_KEY is not configured' }, { status: 500 });
  }

  const client = new Rest({ key });

  const tokenRequest = await client.auth.createTokenRequest({
    clientId: user.id,
  });

  return NextResponse.json(tokenRequest, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
