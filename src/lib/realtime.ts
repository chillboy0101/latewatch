import 'server-only';

import { ablyPublish } from '@/lib/ably-channel';
import { isStaffChannel, staffMemberChannel } from '@/lib/realtime-channels';

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

// All an update on a staff channel may say. Every signed-in staff member hears those channels, so
// anything else (whose sign-out it was, which record changed) is dropped there, whatever was sent.
const STAFF_CHANNEL_FIELDS = new Set(['date', 'personal', 'reason', 'reminderType']);

function payloadFor(channel: string, data: unknown) {
  if (!isStaffChannel(channel)) return data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return Object.fromEntries(Object.entries(data).filter(([key]) => STAFF_CHANNEL_FIELDS.has(key)));
}

export function publishRealtime(channel: string, event: string, data?: unknown) {
  const state = getState();
  const clients = state.clientsByChannel.get(channel);
  const sent = payloadFor(channel, data);

  // Publish via Ably when configured (Vercel-safe serverless)
  // Fire-and-forget; in-memory SSE below still supports local/dev. Live updates are best-effort:
  // an Ably timeout must never become an unhandled rejection that ends the request early.
  void ablyPublish(`latewatch:${channel}`, event, sent).catch((error) => {
    console.warn('Realtime publish failed:', error);
  });

  if (!clients || clients.size === 0) return;

  const payload = sent === undefined ? '' : JSON.stringify(sent);
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

/**
 * An update about one staff member. Shared channels only learn that it is about someone
 * (`personal: true`: admin pages refresh, staff pages skip it; the id stays on admin-only
 * channels). The person's own channel gets it in full, named after the staff channel it stands
 * for, so their page reacts just as it would to that channel.
 */
export function publishStaffUpdate(staffId: string, channels: readonly string[], data: Record<string, unknown>) {
  for (const channel of channels) {
    publishRealtime(channel, 'invalidate', { ...data, personal: true, staffId });
    if (isStaffChannel(channel)) publishRealtime(staffMemberChannel(staffId), channel, data);
  }
}
