import 'server-only';

import { and, eq, inArray, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { latenessEntry, staff } from '@/db/schema';

/**
 * Who the offence book counts: current staff, plus former (archived or inactive) staff with
 * penalties up to the month's end, so a past month's figures don't change when someone leaves.
 * Attendance-only staff are never charged, as on Payments.
 */
export function offenceBookRosterWhere(monthEnd: string) {
  const chargedStaff = db.selectDistinct({ id: latenessEntry.staffId })
    .from(latenessEntry)
    .where(lte(latenessEntry.date, monthEnd));

  return and(
    eq(staff.isAttendanceOnly, false),
    or(and(eq(staff.active, true), eq(staff.archived, false)), inArray(staff.id, chargedStaff)),
  );
}
