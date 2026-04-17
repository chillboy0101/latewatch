import 'server-only';

import { getAblyRestClient } from '@/lib/ably-server';

export async function ablyPublish(channel: string, name: string, data?: unknown) {
  const client = getAblyRestClient();
  if (!client) return;

  await client.channels.get(channel).publish(name, data ?? null);
}
