import 'server-only';

import { and, eq, inArray, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { latenessEntry, staff } from '@/db/schema';

/** Current staff who can be charged (attendance-only staff never are). */
export const currentChargeableStaff = () => and(eq(staff.active, true), eq(staff.archived, false), eq(staff.isAttendanceOnly, false));

/**
 * Who the offence book counts: current chargeable staff, plus anyone charged up to the month's
 * end (former staff, or someone made attendance-only later), so a past month's figures don't
 * change when someone leaves.
 */
export function offenceBookRosterWhere(monthEnd: string) {
  const chargedStaff = db.selectDistinct({ id: latenessEntry.staffId })
    .from(latenessEntry)
    .where(lte(latenessEntry.date, monthEnd));

  return or(currentChargeableStaff(), inArray(staff.id, chargedStaff));
}
