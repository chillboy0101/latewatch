// actions/staff.ts
'use server';

import { requireRole } from '@/lib/auth/roles';
import { db } from '@/db';
import { staff as staffTable } from '@/db/schema';
import { updateTag } from 'next/cache';
import { publishRealtime } from '@/lib/realtime';
import { eq } from 'drizzle-orm';

export async function getStaff() {
  await requireRole(['admin', 'hr', 'viewer']);
  
  const staff = await db.query.staff.findMany({
    orderBy: (staff, { asc }) => [asc(staff.fullName)],
  });
  
  return staff;
}

export async function createStaff(data: { fullName: string; department?: string; unit?: string }) {
  await requireRole(['admin']);
  
  const newStaff = await db.insert(staffTable).values({
    fullName: data.fullName,
    department: data.department,
    unit: data.unit,
  }).returning();
  
  updateTag('staff');
  publishRealtime('dashboard', 'invalidate', { reason: 'staff' });
  
  return newStaff[0];
}

export async function updateStaff(id: string, data: { fullName?: string; active?: boolean; department?: string; unit?: string }) {
  await requireRole(['admin']);
  
  const updated = await db.update(staffTable)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(staffTable.id, id))
    .returning();
  
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
