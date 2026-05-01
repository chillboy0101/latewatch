// app/api/staff/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const active = url.searchParams.get('active');
    const whereClause = active === 'true'
      ? and(eq(staff.active, true), eq(staff.archived, false))
      : active === 'false'
      ? and(eq(staff.active, false), eq(staff.archived, false))
      : undefined;

    const staffList = await db.select({
      id: staff.id,
      fullName: staff.fullName,
      displayOrder: staff.displayOrder,
      active: staff.active,
      archived: staff.archived,
      archivedAt: staff.archivedAt,
      department: staff.department,
      unit: staff.unit,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    })
    .from(staff)
    .where(whereClause)
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

    return NextResponse.json(staffList, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to fetch staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fullName, department, unit } = body;
    const name = typeof fullName === 'string' ? fullName.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const normalizedDepartment = typeof department === 'string' && department.trim() ? department.trim() : null;
    const normalizedUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : null;

    const [existingStaff] = await db.select()
      .from(staff)
      .where(ilike(staff.fullName, name))
      .limit(1);

    if (existingStaff) {
      if (existingStaff.archived) {
        const [restored] = await db.update(staff)
          .set({
            active: true,
            archived: false,
            archivedAt: null,
            department: normalizedDepartment ?? existingStaff.department,
            unit: normalizedUnit ?? existingStaff.unit,
            updatedAt: new Date(),
          })
          .where(eq(staff.id, existingStaff.id))
          .returning();

        await writeAuditEvent({
          entityType: 'staff',
          entityId: restored.id,
          action: 'RESTORE',
          before: existingStaff,
          after: restored,
          reason: 'staff',
        });

        publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

        return NextResponse.json(restored);
      }

      return NextResponse.json(
        { error: 'This person already exists. Use Activate, Deactivate, or Archive instead of adding a duplicate.' },
        { status: 409 },
      );
    }

    const newStaff = await db.insert(staff).values({
      fullName: name,
      department: normalizedDepartment,
      unit: normalizedUnit,
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
      reason: 'staff',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

    return NextResponse.json(newStaff[0]);
  } catch (error) {
    console.error('Failed to create staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
