// app/api/realtime/token/route.ts
import { NextResponse } from 'next/server';
import { Rest } from 'ably';
import { currentUser } from '@clerk/nextjs/server';
import { enforceRole } from '@/lib/auth/roles';
import { themeChannelForUser } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// Browsers only ever listen; every update is published by the server. Admins hear all LateWatch
// channels, staff only what the check-in page uses and their own theme.
const STAFF_CHANNELS = ['attendance', 'notifications', 'staff-penalty-history'];

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
  const isAdmin = (await enforceRole(['admin'])) === null;
  const capability: Record<string, ['subscribe']> = isAdmin
    ? { 'latewatch:*': ['subscribe'] }
    : Object.fromEntries(
      [...STAFF_CHANNELS, themeChannelForUser(user.id)].map((channel) => [`latewatch:${channel}`, ['subscribe']]),
    );

  const tokenRequest = await client.auth.createTokenRequest({
    capability,
    clientId: user.id,
  });

  return NextResponse.json(tokenRequest, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
