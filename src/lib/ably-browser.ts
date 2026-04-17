'use client';

import { Realtime } from 'ably';

let realtime: Realtime | null = null;

export async function getAblyRealtime() {
  if (realtime) return realtime;

  realtime = new Realtime({
    authUrl: '/api/realtime/token',
    autoConnect: true,
    echoMessages: false,
  });

  return realtime;
}
