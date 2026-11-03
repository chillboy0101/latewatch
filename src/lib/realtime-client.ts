'use client';

import { getAblyRealtime } from '@/lib/ably-browser';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

type SubscribeRealtimeOptions = {
  channel: string;
  events: string[];
  // `data` is what the server published with the event (e.g. which staff member it is about).
  onEvent: (eventName: string, data?: unknown) => void;
  onStatus?: (status: RealtimeStatus) => void;
};

export async function subscribeRealtimeChannel({
  channel,
  events,
  onEvent,
  onStatus,
}: SubscribeRealtimeOptions) {
  let closed = false;
  let usingSse = false;
  let eventSource: EventSource | null = null;
  let ablyCleanup: (() => void) | null = null;
  let sseCleanup: (() => void) | null = null;
  let connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (status: RealtimeStatus) => {
    if (!closed) onStatus?.(status);
  };

  const startSse = () => {
    if (closed || usingSse) return;
    usingSse = true;
    ablyCleanup?.();
    ablyCleanup = null;

    eventSource = new EventSource(`/api/realtime/${channel}`);

    const handleConnected = () => setStatus('live');
    const handleError = () => setStatus('offline');
    const sseHandlers = events.map((eventName) => ({
      eventName,
      handler: (event: Event) => onEvent(eventName, parseEventData((event as MessageEvent).data)),
    }));

    eventSource.addEventListener('connected', handleConnected);
    eventSource.onerror = handleError;

    for (const { eventName, handler } of sseHandlers) {
      eventSource.addEventListener(eventName, handler);
    }

    sseCleanup = () => {
      eventSource?.removeEventListener('connected', handleConnected);
      for (const { eventName, handler } of sseHandlers) {
        eventSource?.removeEventListener(eventName, handler);
      }
      eventSource?.close();
      eventSource = null;
    };
  };

  setStatus('connecting');

  try {
    const ably = await getAblyRealtime();
    const ablyChannel = ably.channels.get(`latewatch:${channel}`);
    const handlers = events.map((eventName) => ({
      eventName,
      handler: (message: { data?: unknown }) => onEvent(eventName, message?.data),
    }));

    for (const { eventName, handler } of handlers) {
      await ablyChannel.subscribe(eventName, handler);
    }

    const handleConnectionState = (change: { current: string }) => {
      if (usingSse || closed) return;

      if (change.current === 'connected') {
        setStatus('live');
      }

      if (change.current === 'failed' || change.current === 'suspended' || change.current === 'closed') {
        startSse();
      }
    };

    ably.connection.on(handleConnectionState);

    ablyCleanup = () => {
      for (const { eventName, handler } of handlers) {
        ablyChannel.unsubscribe(eventName, handler);
      }
      ably.connection.off(handleConnectionState);
    };

    if (ably.connection.state === 'connected') {
      setStatus('live');
    } else {
      connectionTimeout = setTimeout(() => {
        if (!closed && ably.connection.state !== 'connected') {
          startSse();
        }
      }, 2500);
    }
  } catch {
    startSse();
  }

  return () => {
    closed = true;
    if (connectionTimeout) clearTimeout(connectionTimeout);
    ablyCleanup?.();
    sseCleanup?.();
    setStatus('offline');
  };
}

// SSE sends the data as a JSON string (empty when there is none).
function parseEventData(raw: unknown) {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
