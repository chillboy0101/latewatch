import { Redis } from '@upstash/redis';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimit } from '@/db/schema';

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window resets. 0 when the request was allowed. */
  retryAfterSeconds: number;
};

// The Vercel Upstash integration sets UPSTASH_*; the older Vercel KV naming sets KV_*.
// Accept either so the integration can be added from the marketplace without a code change.
function redisCredentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  return url && token ? { url, token } : null;
}

let cachedClient: Redis | null = null;

function getRedis(): Redis | null {
  if (cachedClient) return cachedClient;

  const credentials = redisCredentials();
  if (!credentials) return null;

  // REST rather than a TCP client: serverless invocations cannot pool TCP connections cleanly.
  cachedClient = new Redis(credentials);
  return cachedClient;
}

/**
 * Fixed window in Redis: INCR creates the key at 1, then EXPIRE ... NX sets the TTL only on
 * that first hit, so later hits inside the window do not extend it. Both commands go in one
 * pipeline, so this is a single round trip.
 */
async function allowRequestViaRedis(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const namespaced = `ratelimit:${key}`;
  const [count] = await redis.pipeline()
    .incr(namespaced)
    .expire(namespaced, windowSeconds, 'NX')
    .exec<[number, number]>();

  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };

  // Only read the TTL on the path that needs it. -1 means the key somehow has no expiry, in
  // which case the whole window is the honest answer.
  const ttl = await redis.ttl(namespaced);

  return {
    allowed: false,
    retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
  };
}

/**
 * Fixed window in Postgres: one atomic upsert, the same race-free shape the reminder sender
 * uses to claim deliveries. Concurrent requests serialise on the row's primary key, so two
 * instances cannot both read a stale count.
 *
 * The cutoff is computed here rather than with now() in SQL so a single clock decides both
 * the comparison and the new window start.
 */
async function allowRequestViaPostgres(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);

  const [row] = await db.insert(rateLimit)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when rate_limit.window_start < ${cutoff} then 1 else rate_limit.count + 1 end`,
        windowStart: sql`case when rate_limit.window_start < ${cutoff} then ${now} else rate_limit.window_start end`,
      },
    })
    .returning({ count: rateLimit.count, windowStart: rateLimit.windowStart });

  if (!row || row.count <= limit) return { allowed: true, retryAfterSeconds: 0 };

  const resetsAt = row.windowStart.getTime() + windowSeconds * 1000;

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetsAt - now.getTime()) / 1000)),
  };
}

/**
 * Returns allowed:false once the caller has exceeded `limit` requests inside `windowSeconds`.
 *
 * Redis is used when the Upstash credentials are present, Postgres otherwise, so local
 * development and preview deploys without the integration behave identically.
 */
export async function allowRequest(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();

  try {
    return redis
      ? await allowRequestViaRedis(redis, key, limit, windowSeconds)
      : await allowRequestViaPostgres(key, limit, windowSeconds);
  } catch (error) {
    // Fail open. This throttle is defence in depth on endpoints that are already behind Clerk
    // and idempotent by constraint, so it must never be the reason a staff member cannot
    // request a device transfer — not when Redis is unreachable, and not in the window
    // between a deploy and its migration.
    console.error('rate-limit check failed, allowing request', { key, error });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
