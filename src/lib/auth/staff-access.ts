import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { staff } from '@/db/schema';

// Who may use LateWatch is decided by the Staff list, not by a seat in the Clerk organisation
// (which the free plan caps at 20). A signed-in account gets in when one of its *verified*
// email addresses belongs to a staff member who has not been archived. Sign-up stays
// invite-only in Clerk, so only people an admin added can create an account at all.

const ALLOWED_TTL_MS = 60_000;
const DENIED_TTL_MS = 10_000;
const accessCache = new Map<string, { allowed: boolean; expiresAt: number }>();

export async function hasActiveStaffAccess(userId: string) {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  let allowed = false;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const verifiedEmails = user.emailAddresses
      .filter((address) => address.verification?.status === 'verified')
      .map((address) => address.emailAddress.trim().toLowerCase())
      .filter(Boolean);

    if (verifiedEmails.length > 0) {
      const [member] = await db.select({ id: staff.id })
        .from(staff)
        .where(and(
          eq(staff.archived, false),
          inArray(sql`lower(${staff.email})`, verifiedEmails),
        ))
        .limit(1);
      allowed = Boolean(member);
    }
  } catch (error) {
    // Never cache a failed lookup; the caller treats it as "no access" for this request only.
    console.error('Failed to check LateWatch staff access:', error);
    return false;
  }

  accessCache.set(userId, { allowed, expiresAt: Date.now() + (allowed ? ALLOWED_TTL_MS : DENIED_TTL_MS) });
  return allowed;
}
