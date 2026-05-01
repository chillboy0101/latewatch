// actions/staff.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { staff as staffTable } from '@/db/schema';
import { updateTag } from 'next/cache';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { eq } from 'drizzle-orm';

export async function getStaff() {
  await requireRole(['admin', 'hr', 'viewer']);
  
  const staff = await db.query.staff.findMany({
    orderBy: (staff, { asc }) => [asc(staff.fullName)],
  });
  
  return staff;
}

export async function createStaff(data: { fullName: string; department?: string; unit?: string }) {
  const user = await requireRole(['admin']);
  
  const newStaff = await db.insert(staffTable).values({
    fullName: data.fullName,
    department: data.department,
    unit: data.unit,
    active: true,
    archived: false,
    archivedAt: null,
  }).returning();

  await writeAuditEvent({
    entityType: 'staff',
    entityId: newStaff[0].id,
    action: 'CREATE',
    before: null,
    after: newStaff[0],
    actor: user,
    reason: 'staff',
  });
  
  updateTag('staff');
  publishRealtime('dashboard', 'invalidate', { reason: 'staff' });
  
  return newStaff[0];
}

export async function updateStaff(id: string, data: { fullName?: string; active?: boolean; archived?: boolean; department?: string; unit?: string }) {
  const user = await requireRole(['admin']);

  const before = await db.query.staff.findFirst({
    where: (staff, { eq }) => eq(staff.id, id),
  });

  if (!before) {
    throw new Error('Staff member not found');
  }
  
  const updateData = {
    ...data,
    ...(typeof data.archived === 'boolean'
      ? {
          active: data.archived ? false : true,
          archivedAt: data.archived ? new Date() : null,
        }
      : {}),
    updatedAt: new Date(),
  };

  const updated = await db.update(staffTable)
    .set({
      ...updateData,
    })
    .where(eq(staffTable.id, id))
    .returning();

  const auditAction = typeof data.archived === 'boolean' && before.archived !== data.archived
    ? data.archived ? 'ARCHIVE' : 'RESTORE'
    : typeof data.active === 'boolean' && before.active !== data.active
    ? data.active ? 'ACTIVATE' : 'DEACTIVATE'
    : 'UPDATE';

  await writeAuditEvent({
    entityType: 'staff',
    entityId: id,
    action: auditAction,
    before,
    after: updated[0],
    actor: user,
    reason: 'staff',
  });
  
  updateTag('staff');
  publishRealtime('dashboard', 'invalidate', { reason: 'staff' });
  
  return updated[0];
}

export async function deactivateStaff(id: string) {
  await requireRole(['admin']);
  
  return updateStaff(id, { active: false });
}

export async function activateStaff(id: string) {
  await requireRole(['admin']);
  
  return updateStaff(id, { active: true });
}

export async function archiveStaff(id: string) {
  await requireRole(['admin']);

  return updateStaff(id, { archived: true });
}

export async function restoreStaff(id: string) {
  await requireRole(['admin']);

  return updateStaff(id, { archived: false });
}
