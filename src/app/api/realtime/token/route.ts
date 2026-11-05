// app/api/realtime/token/route.ts
import { NextResponse } from 'next/server';
import { Rest } from 'ably';
import { currentUser } from '@clerk/nextjs/server';
import { enforceRole } from '@/lib/auth/roles';
import { getSignedInStaff } from '@/lib/auth/signed-in-staff';
import { STAFF_CHANNELS, staffMemberChannel } from '@/lib/realtime-channels';
import { themeChannelForUser } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// Browsers only ever listen; every update is published by the server. Admins hear all LateWatch
// channels. Staff hear the shared ones the check-in page uses (which never say who an update is
// about), their own theme, and their own updates.
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
  let capability: Record<string, ['subscribe']>;
  if (isAdmin) {
    capability = { 'latewatch:*': ['subscribe'] };
  } else {
    const channels: string[] = [...STAFF_CHANNELS, themeChannelForUser(user.id)];
    // The same lookup the check-in page's own requests use, so it is the channel the page
    // listens to. If it fails, the page still refreshes on its timer.
    const member = await getSignedInStaff(user).catch((error) => {
      console.error('Failed to find the staff record for a live-updates token:', error);
      return null;
    });
    if (member) channels.push(staffMemberChannel(member.id));
    capability = Object.fromEntries(channels.map((channel) => [`latewatch:${channel}`, ['subscribe']]));
  }

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
