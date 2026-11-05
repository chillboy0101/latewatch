// app/api/realtime/me/route.ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { getSignedInStaff } from '@/lib/auth/signed-in-staff';
import { registerRealtimeClient } from '@/lib/realtime';
import { staffMemberChannel } from '@/lib/realtime-channels';

export const dynamic = 'force-dynamic';

// The signed-in person's own live updates, for when Ably is unavailable. Whose they are comes
// from the login, never from the request, so no one can listen to someone else's.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let staffId: string;
  try {
    const member = await getSignedInStaff(user);
    if (!member) {
      return NextResponse.json({ error: 'No staff record for this account' }, { status: 403 });
    }
    staffId = member.id;
  } catch (error) {
    console.error('Failed to find the staff record for live updates:', error);
    return NextResponse.json({ error: 'Live updates are unavailable' }, { status: 503 });
  }

  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const close = () => {
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };

      cleanup = registerRealtimeClient(staffMemberChannel(staffId), { send, close });

      send('event: connected\ndata: {}\n\n');

      interval = setInterval(() => {
        try {
          send('event: ping\ndata: {}\n\n');
        } catch {
          // The cancel handler will finish cleanup.
        }
      }, 25000);
    },
    cancel() {
      if (interval) clearInterval(interval);
      interval = null;
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
