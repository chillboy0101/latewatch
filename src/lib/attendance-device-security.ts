import 'server-only';

import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import { staff, staffDevice } from '@/db/schema';

export const SHARED_ATTENDANCE_DEVICE_RESULT = 'SHARED_ATTENDANCE_DEVICE';
export const SHARED_ATTENDANCE_DEVICE_MESSAGE = 'This browser is already linked to another staff account. Use the staff member\'s own device or ask an admin to reset the old device.';

export async function findSharedAttendanceDeviceOwner(input: {
  deviceHash: string;
  staffId: string;
}) {
  const [owner] = await db.select({
    deviceId: staffDevice.id,
    email: staff.email,
    fullName: staff.fullName,
    staffId: staff.id,
  })
    .from(staffDevice)
    .innerJoin(staff, eq(staff.id, staffDevice.staffId))
    .where(and(
      eq(staffDevice.deviceHash, input.deviceHash),
      ne(staffDevice.staffId, input.staffId),
      or(eq(staff.active, true), isNull(staff.active)),
      or(eq(staff.archived, false), isNull(staff.archived)),
    ))
    .limit(1);

  return owner || null;
}
