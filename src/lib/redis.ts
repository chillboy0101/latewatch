import 'server-only';

import { Redis } from '@upstash/redis';

// The Vercel Upstash integration sets UPSTASH_*; the older Vercel KV naming sets KV_*.
// Accept either so the integration can be added from the marketplace without a code change.
function redisCredentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  return url && token ? { url, token } : null;
}

let cachedClient: Redis | null = null;

export function getRedis(): Redis | null {
  if (cachedClient) return cachedClient;

  const credentials = redisCredentials();
  if (!credentials) return null;

  // REST rather than a TCP client: serverless invocations cannot pool TCP connections cleanly.
  cachedClient = new Redis(credentials);
  return cachedClient;
}
