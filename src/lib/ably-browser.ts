'use client';

import * as Ably from 'ably';

let realtime: Ably.Types.RealtimePromise | null = null;

export async function getAblyRealtime() {
  if (realtime) return realtime;

  realtime = new (Ably as any).Realtime.Promise({
    authUrl: '/api/realtime/token',
    autoConnect: true,
    echoMessages: false,
  });

  return realtime;
}
