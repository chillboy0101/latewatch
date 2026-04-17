import 'server-only';

import { ablyPublish } from '@/lib/ably-channel';

type Client = {
  send: (data: string) => void;
  close: () => void;
};

type RealtimeState = {
  clientsByChannel: Map<string, Set<Client>>;
};

function getState(): RealtimeState {
  const g = globalThis as unknown as { __latewatchRealtime?: RealtimeState };
  if (!g.__latewatchRealtime) {
    g.__latewatchRealtime = {
      clientsByChannel: new Map(),
    };
  }
  return g.__latewatchRealtime;
}

export function registerRealtimeClient(channel: string, client: Client) {
  const state = getState();
  const set = state.clientsByChannel.get(channel) ?? new Set<Client>();
  set.add(client);
  state.clientsByChannel.set(channel, set);

  return () => {
    const current = state.clientsByChannel.get(channel);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) state.clientsByChannel.delete(channel);
  };
}

export function publishRealtime(channel: string, event: string, data?: unknown) {
  const state = getState();
  const clients = state.clientsByChannel.get(channel);

  // Publish via Ably when configured (Vercel-safe serverless)
  // Fire-and-forget; in-memory SSE below still supports local/dev.
  void ablyPublish(`latewatch:${channel}`, event, data);

  if (!clients || clients.size === 0) return;

  const payload = data === undefined ? '' : JSON.stringify(data);
  const message = `event: ${event}\ndata: ${payload}\n\n`;

  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      try {
        client.close();
      } catch {
        // ignore
      }
      clients.delete(client);
    }
  }
}
