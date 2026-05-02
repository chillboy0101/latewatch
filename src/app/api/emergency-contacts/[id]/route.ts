import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { emergencyContact, staff } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

type EmergencyContactBody = {
  address?: unknown;
  alternatePhone?: unknown;
  contactName?: unknown;
  email?: unknown;
  notes?: unknown;
  phone?: unknown;
  relationship?: unknown;
  staffId?: unknown;
};

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeContactBody(body: EmergencyContactBody) {
  const updateData: Partial<typeof emergencyContact.$inferInsert> = { updatedAt: new Date() };

  if (body.contactName !== undefined) {
    const contactName = optionalText(body.contactName);
    if (!contactName) return { error: 'Family or spouse contact name is required' };
    updateData.contactName = contactName;
  }

  if (body.phone !== undefined) {
    const phone = optionalText(body.phone);
    if (!phone) return { error: 'Staff phone number is required' };
    updateData.phone = phone;
  }

  if (body.address !== undefined) updateData.address = optionalText(body.address);
  if (body.alternatePhone !== undefined) {
    const familyPhone = optionalText(body.alternatePhone);
    if (!familyPhone) return { error: 'Family or spouse phone number is required' };
    updateData.alternatePhone = familyPhone;
  }
  if (body.email !== undefined) updateData.email = optionalText(body.email)?.toLowerCase() || null;
  if (body.notes !== undefined) updateData.notes = optionalText(body.notes);
  if (body.relationship !== undefined) updateData.relationship = optionalText(body.relationship);
  if (body.staffId !== undefined) {
    const staffId = optionalText(body.staffId);
    if (!staffId) return { error: 'Linked staff member is required' };
    updateData.staffId = staffId;
  }

  return { data: updateData };
}

async function getLinkedStaffName(staffId: string | null | undefined) {
  if (!staffId) return null;

  const [member] = await db.select({ fullName: staff.fullName })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  return member?.fullName || null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const [before] = await db.select().from(emergencyContact).where(eq(emergencyContact.id, id)).limit(1);

    if (!before) {
      return NextResponse.json({ error: 'Emergency contact not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as EmergencyContactBody;
    const normalized = normalizeContactBody(body);

    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const nextStaffId = normalized.data.staffId === undefined ? before.staffId : normalized.data.staffId;
    const nextStaffName = await getLinkedStaffName(nextStaffId);
    if (nextStaffId && !nextStaffName) {
      return NextResponse.json({ error: 'Linked staff member was not found' }, { status: 400 });
    }

    const beforeStaffName = await getLinkedStaffName(before.staffId);

    const [updated] = await db.update(emergencyContact)
      .set(normalized.data)
      .where(eq(emergencyContact.id, id))
      .returning();

    await writeAuditEvent({
      entityType: 'emergency_contact',
      entityId: id,
      action: 'UPDATE',
      before: { ...before, staffName: beforeStaffName },
      after: { ...updated, staffName: nextStaffName },
      reason: 'emergency-contact',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'emergency-contact' });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update emergency contact:', error);
    return NextResponse.json({ error: 'Failed to update emergency contact' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const [before] = await db.select().from(emergencyContact).where(eq(emergencyContact.id, id)).limit(1);

    if (!before) {
      return NextResponse.json({ error: 'Emergency contact not found' }, { status: 404 });
    }

    await db.delete(emergencyContact).where(eq(emergencyContact.id, id));
    const beforeStaffName = await getLinkedStaffName(before.staffId);

    await writeAuditEvent({
      entityType: 'emergency_contact',
      entityId: id,
      action: 'DELETE',
      before: { ...before, staffName: beforeStaffName },
      after: { contactName: before.contactName, phone: before.phone, staffName: beforeStaffName },
      reason: 'emergency-contact',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'emergency-contact' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete emergency contact:', error);
    return NextResponse.json({ error: 'Failed to delete emergency contact' }, { status: 500 });
  }
}
