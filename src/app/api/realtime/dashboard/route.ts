// app/api/realtime/dashboard/route.ts
import { NextRequest } from 'next/server';
import { registerRealtimeClient } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
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
          // ignore
        }
      };

      cleanup = registerRealtimeClient('dashboard', { send, close });

      send('event: connected\ndata: {}\n\n');

      interval = setInterval(() => {
        try {
          send('event: ping\ndata: {}\n\n');
        } catch {
          // ignore
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
