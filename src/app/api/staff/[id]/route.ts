// app/api/staff/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [result] = await db.select().from(staff).where(eq(staff.id, id));

    if (!result) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch staff member:', error);
    return NextResponse.json({ error: 'Failed to fetch staff member' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { fullName, department, unit, active } = body;

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (fullName !== undefined) updateData.fullName = fullName;
    if (department !== undefined) updateData.department = department;
    if (unit !== undefined) updateData.unit = unit;
    if (active !== undefined) updateData.active = active;

    // Capture before state for audit
    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    const updated = await db.update(staff)
      .set(updateData)
      .where(eq(staff.id, id))
      .returning();

    if (!updated.length) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    // Audit log
    const { auditEvent } = await import('@/db/schema');
    const { currentUser } = await import('@clerk/nextjs/server');
    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

    await db.insert(auditEvent).values({
      entityType: 'staff',
      entityId: id,
      action: 'UPDATE',
      beforeJson: before,
      afterJson: updated[0],
      actorUserId,
      actorEmail,
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error('Failed to update staff member:', error);
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    // Soft-delete: mark inactive rather than destroying data
    const [updated] = await db.update(staff)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(staff.id, id))
      .returning();

    // Audit log
    const { auditEvent } = await import('@/db/schema');
    const { currentUser } = await import('@clerk/nextjs/server');
    let actorEmail = 'system';
    let actorUserId: string | null = null;
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
        actorUserId = user.id;
      }
    } catch { /* continue */ }

    await db.insert(auditEvent).values({
      entityType: 'staff',
      entityId: id,
      action: 'DELETE',
      beforeJson: before,
      afterJson: updated,
      actorUserId,
      actorEmail,
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete staff member:', error);
    return NextResponse.json({ error: 'Failed to delete staff member' }, { status: 500 });
  }
}