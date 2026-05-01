import { registerRealtimeClient } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

export async function GET() {
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

      cleanup = registerRealtimeClient('notifications', { send, close });

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
