// app/api/staff/route.ts
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { normalizeStaffEmail } from '@/lib/attendance';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';

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
      email: staff.email,
      displayOrder: staff.displayOrder,
      active: staff.active,
      archived: staff.archived,
      archivedAt: staff.archivedAt,
      staffNo: staff.staffNo,
      gender: staff.gender,
      rank: staff.rank,
      department: staff.department,
      unit: staff.unit,
      isNssPersonnel: staff.isNssPersonnel,
      isAttendanceOnly: staff.isAttendanceOnly,
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
    const actor = await currentUser();
    const body = await request.json();
    const { fullName, email, department, unit, staffNo, gender, rank } = body;
    const name = typeof fullName === 'string' ? fullName.trim() : '';
    const normalizedEmail = normalizeStaffEmail(email);
    const isAttendanceOnly = body?.isAttendanceOnly === true;
    const isNssPersonnel = !isAttendanceOnly && body?.isNssPersonnel === true;

    if (!name) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const normalizedDepartment = typeof department === 'string' && department.trim() ? department.trim() : null;
    const normalizedUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
    const normalizedStaffNo = typeof staffNo === 'string' && staffNo.trim() ? staffNo.trim() : null;
    const normalizedGender = typeof gender === 'string' && gender.trim() ? gender.trim() : null;
    const normalizedRank = typeof rank === 'string' && rank.trim() ? rank.trim() : null;

    const [existingStaff] = await db.select()
      .from(staff)
      .where(ilike(staff.fullName, name))
      .limit(1);

    if (normalizedEmail) {
      const [existingEmail] = await db.select()
        .from(staff)
        .where(ilike(staff.email, normalizedEmail))
        .limit(1);

      if (existingEmail && existingEmail.id !== existingStaff?.id) {
        return NextResponse.json(
          { error: 'This email is already linked to another staff member.' },
          { status: 409 },
        );
      }
    }

    if (existingStaff) {
      if (existingStaff.archived) {
        const [restored] = await db.update(staff)
          .set({
            active: true,
            archived: false,
            archivedAt: null,
            email: normalizedEmail ?? existingStaff.email,
            staffNo: normalizedStaffNo ?? existingStaff.staffNo,
            gender: normalizedGender ?? existingStaff.gender,
            rank: normalizedRank ?? existingStaff.rank,
            department: normalizedDepartment ?? existingStaff.department,
            unit: normalizedUnit ?? existingStaff.unit,
            isAttendanceOnly,
            isNssPersonnel,
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

        if (restored.email) {
          await syncStaffEmailIdentity({
            actorUserId: actor?.id,
            email: restored.email,
            isAttendanceOnly: restored.isAttendanceOnly,
            isNssPersonnel: restored.isNssPersonnel,
            staffId: restored.id,
            staffName: restored.fullName,
          });
        }

        return NextResponse.json(restored);
      }

      return NextResponse.json(
        { error: 'This person already exists. Use Activate, Deactivate, or Archive instead of adding a duplicate.' },
        { status: 409 },
      );
    }

    const newStaff = await db.insert(staff).values({
      fullName: name,
      email: normalizedEmail,
      staffNo: normalizedStaffNo,
      gender: normalizedGender,
      rank: normalizedRank,
      department: normalizedDepartment,
      unit: normalizedUnit,
      isAttendanceOnly,
      isNssPersonnel,
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

    if (newStaff[0].email) {
      await syncStaffEmailIdentity({
        actorUserId: actor?.id,
        email: newStaff[0].email,
        isAttendanceOnly: newStaff[0].isAttendanceOnly,
        isNssPersonnel: newStaff[0].isNssPersonnel,
        staffId: newStaff[0].id,
        staffName: newStaff[0].fullName,
      });
    }

    return NextResponse.json(newStaff[0]);
  } catch (error) {
    console.error('Failed to create staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
