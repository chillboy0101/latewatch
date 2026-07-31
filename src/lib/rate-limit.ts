import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimit } from '@/db/schema';

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window resets. 0 when the request was allowed. */
  retryAfterSeconds: number;
};

/**
 * Fixed-window throttle backed by a single atomic upsert, the same race-free shape the
 * reminder sender uses to claim deliveries. Concurrent requests serialise on the row's
 * primary key, so two instances cannot both read a stale count.
 *
 * The window cutoff is computed here rather than with now() in SQL so a single clock
 * decides both the comparison and the new window start.
 */
export async function allowRequest(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);

  let row: { count: number; windowStart: Date } | undefined;

  try {
    [row] = await db.insert(rateLimit)
      .values({ key, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`case when rate_limit.window_start < ${cutoff} then 1 else rate_limit.count + 1 end`,
          windowStart: sql`case when rate_limit.window_start < ${cutoff} then ${now} else rate_limit.window_start end`,
        },
      })
      .returning({ count: rateLimit.count, windowStart: rateLimit.windowStart });
  } catch (error) {
    // Fail open. This throttle is defence in depth on endpoints that are already behind
    // Clerk and idempotent by constraint, so it must never be the reason a staff member
    // cannot request a device transfer — including in the window between a deploy and
    // its migration.
    console.error('rate-limit check failed, allowing request', { key, error });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  if (row.count <= limit) return { allowed: true, retryAfterSeconds: 0 };

  const resetsAt = row.windowStart.getTime() + windowSeconds * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetsAt - now.getTime()) / 1000));

  return { allowed: false, retryAfterSeconds };
}
