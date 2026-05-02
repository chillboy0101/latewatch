import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { emergencyContact, staff } from '@/db/schema';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

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
  const contactName = optionalText(body.contactName);
  const familyPhone = optionalText(body.alternatePhone);
  const staffId = optionalText(body.staffId);
  const staffPhone = optionalText(body.phone);

  if (!staffId) return { error: 'Linked staff member is required' };
  if (!staffPhone) return { error: 'Staff phone number is required' };
  if (!contactName) return { error: 'Family or spouse contact name is required' };
  if (!familyPhone) return { error: 'Family or spouse phone number is required' };

  return {
    data: {
      active: true,
      address: optionalText(body.address),
      alternatePhone: familyPhone,
      contactName,
      email: optionalText(body.email)?.toLowerCase() || null,
      notes: optionalText(body.notes),
      phone: staffPhone,
      relationship: optionalText(body.relationship),
      staffId,
      updatedAt: new Date(),
    },
  };
}

async function getLinkedStaffName(staffId: string | null) {
  if (!staffId) return null;

  const [member] = await db.select({ fullName: staff.fullName })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  return member?.fullName || null;
}

export async function GET() {
  try {
    const contacts = await db.select({
      active: emergencyContact.active,
      address: emergencyContact.address,
      alternatePhone: emergencyContact.alternatePhone,
      contactName: emergencyContact.contactName,
      createdAt: emergencyContact.createdAt,
      email: emergencyContact.email,
      id: emergencyContact.id,
      notes: emergencyContact.notes,
      phone: emergencyContact.phone,
      relationship: emergencyContact.relationship,
      staffId: emergencyContact.staffId,
      staffName: staff.fullName,
      updatedAt: emergencyContact.updatedAt,
    })
      .from(emergencyContact)
      .leftJoin(staff, eq(emergencyContact.staffId, staff.id))
      .orderBy(asc(staff.fullName), asc(emergencyContact.contactName));

    return NextResponse.json(contacts, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to fetch emergency contacts:', error);
    return NextResponse.json({ error: 'Failed to fetch emergency contacts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as EmergencyContactBody;
    const normalized = normalizeContactBody(body);

    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const linkedStaffName = await getLinkedStaffName(normalized.data.staffId);
    if (normalized.data.staffId && !linkedStaffName) {
      return NextResponse.json({ error: 'Linked staff member was not found' }, { status: 400 });
    }

    const [created] = await db.insert(emergencyContact)
      .values({
        ...normalized.data,
        createdAt: new Date(),
      })
      .returning();

    await writeAuditEvent({
      entityType: 'emergency_contact',
      entityId: created.id,
      action: 'CREATE',
      before: null,
      after: { ...created, staffName: linkedStaffName },
      reason: 'emergency-contact',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'emergency-contact' });

    return NextResponse.json(created);
  } catch (error) {
    console.error('Failed to create emergency contact:', error);
    return NextResponse.json({ error: 'Failed to create emergency contact' }, { status: 500 });
  }
}
