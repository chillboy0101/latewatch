// actions/staff.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { staff as staffTable } from '@/db/schema';
import { updateTag } from 'next/cache';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { normalizeWhatsAppPhone } from '@/lib/whatsapp-notices';
import { eq } from 'drizzle-orm';

type StaffWriteData = {
  active?: boolean;
  archived?: boolean;
  department?: string;
  fullName?: string;
  isAttendanceOnly?: boolean;
  isNssPersonnel?: boolean;
  unit?: string;
  whatsappNotificationsEnabled?: boolean;
  whatsappPhone?: string | null;
};

function normalizeWhatsAppFields(data: Pick<StaffWriteData, 'whatsappNotificationsEnabled' | 'whatsappPhone'>) {
  const hasPhone = Object.prototype.hasOwnProperty.call(data, 'whatsappPhone');
  const update: {
    whatsappNotificationsEnabled?: boolean;
    whatsappPhone?: string | null;
  } = {};

  if (hasPhone) {
    if (data.whatsappPhone !== null && data.whatsappPhone !== undefined && typeof data.whatsappPhone !== 'string') {
      throw new Error('Enter a valid WhatsApp number');
    }

    const normalizedPhone = typeof data.whatsappPhone === 'string' && data.whatsappPhone.trim()
      ? normalizeWhatsAppPhone(data.whatsappPhone)
      : null;

    if (typeof data.whatsappPhone === 'string' && data.whatsappPhone.trim() && !normalizedPhone) {
      throw new Error('Enter a valid WhatsApp number');
    }

    update.whatsappPhone = normalizedPhone;
    if (!normalizedPhone) update.whatsappNotificationsEnabled = false;
  }

  if (typeof data.whatsappNotificationsEnabled === 'boolean' && update.whatsappNotificationsEnabled !== false) {
    update.whatsappNotificationsEnabled = data.whatsappNotificationsEnabled;
  }

  return update;
}

export async function getStaff() {
  await requireRole(['admin', 'hr', 'viewer']);
  
  const staff = await db.query.staff.findMany({
    orderBy: (staff, { asc }) => [asc(staff.fullName)],
  });
  
  return staff;
}

export async function createStaff(data: StaffWriteData & { fullName: string }) {
  const user = await requireRole(['admin']);
  const whatsappFields = normalizeWhatsAppFields(data);
  
  const newStaff = await db.insert(staffTable).values({
    fullName: data.fullName,
    department: data.department,
    ...whatsappFields,
    isAttendanceOnly: data.isAttendanceOnly === true,
    isNssPersonnel: data.isAttendanceOnly === true ? false : data.isNssPersonnel === true,
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

export async function updateStaff(id: string, data: StaffWriteData) {
  const user = await requireRole(['admin']);

  const before = await db.query.staff.findFirst({
    where: (staff, { eq }) => eq(staff.id, id),
  });

  if (!before) {
    throw new Error('Staff member not found');
  }
  
  const whatsappFields = normalizeWhatsAppFields(data);
  const baseData = { ...data };
  delete baseData.whatsappNotificationsEnabled;
  delete baseData.whatsappPhone;
  const updateData = {
    ...baseData,
    ...whatsappFields,
    ...(typeof data.isAttendanceOnly === 'boolean' || typeof data.isNssPersonnel === 'boolean'
      ? {
          isNssPersonnel: data.isAttendanceOnly === true ? false : data.isNssPersonnel === true,
        }
      : {}),
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
