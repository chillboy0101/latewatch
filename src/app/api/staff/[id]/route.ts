// app/api/staff/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, staff } from '@/db/schema';
import { count, eq } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';

type StaffUpdateBody = {
  active?: boolean;
  archived?: boolean;
  department?: string | null;
  fullName?: string;
  unit?: string | null;
};

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
    const body = await request.json() as StaffUpdateBody;
    const { fullName, department, unit, active, archived } = body;

    const updateData: Partial<typeof staff.$inferInsert> = { updatedAt: new Date() };
    if (fullName !== undefined) updateData.fullName = fullName.trim();
    if (department !== undefined) updateData.department = typeof department === 'string' && department.trim() ? department.trim() : null;
    if (unit !== undefined) updateData.unit = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
    if (active !== undefined) updateData.active = active;
    if (archived !== undefined) {
      updateData.archived = archived;
      updateData.archivedAt = archived ? new Date() : null;
      updateData.active = archived ? false : true;
    }

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

    const auditAction = typeof archived === 'boolean' && before.archived !== archived
      ? archived ? 'ARCHIVE' : 'RESTORE'
      : typeof active === 'boolean' && before.active !== active
      ? active ? 'ACTIVATE' : 'DEACTIVATE'
      : 'UPDATE';

    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: auditAction,
      before,
      after: updated[0],
      reason: 'staff',
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
    const permanent = request.nextUrl.searchParams.get('permanent') === 'true';
    const purgeRecords = request.nextUrl.searchParams.get('purgeRecords') === 'true';

    const [before] = await db.select().from(staff).where(eq(staff.id, id));
    if (!before) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    if (permanent) {
      if (!before.archived) {
        return NextResponse.json(
          { error: 'Archive this staff member before permanently deleting them.' },
          { status: 400 },
        );
      }

      const [entryCount] = await db.select({ count: count() })
        .from(latenessEntry)
        .where(eq(latenessEntry.staffId, id));

      const totalEntries = Number(entryCount?.count || 0);
      if (totalEntries > 0 && !purgeRecords) {
        return NextResponse.json(
          {
            error: `This staff member has ${totalEntries} lateness record${totalEntries === 1 ? '' : 's'}. Archive them instead so historical exports remain accurate.`,
          },
          { status: 409 },
        );
      }

      await writeAuditEvent({
        entityType: 'staff',
        entityId: id,
        action: 'DELETE',
        before,
        after: {
          fullName: before.fullName,
          purgedEntryCount: purgeRecords ? totalEntries : 0,
        },
        reason: 'staff',
      });

      if (purgeRecords) {
        await db.delete(latenessEntry).where(eq(latenessEntry.staffId, id));
      }

      await db.delete(staff).where(eq(staff.id, id));

      publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

      return NextResponse.json({ success: true, deleted: true, purgedEntryCount: purgeRecords ? totalEntries : 0 });
    }

    const [updated] = await db.update(staff)
      .set({ active: false, archived: true, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(staff.id, id))
      .returning();

    await writeAuditEvent({
      entityType: 'staff',
      entityId: id,
      action: 'ARCHIVE',
      before,
      after: updated,
      reason: 'staff',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json({ success: true, staff: updated });
  } catch (error) {
    console.error('Failed to delete staff member:', error);
    return NextResponse.json({ error: 'Failed to delete staff member' }, { status: 500 });
  }
}
