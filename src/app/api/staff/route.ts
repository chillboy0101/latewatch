// app/api/staff/route.ts
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff, staffLeavePeriod } from '@/db/schema';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { normalizeStaffEmail } from '@/lib/attendance';
import { getAccraDateKey } from '@/lib/date-key';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { enforceRole } from '@/lib/auth/roles';
import { getActiveLeavePeriod } from '@/lib/staff-leave';
import { recalculateStaffStoredPenalties } from '@/lib/staff-penalty-recalculation-server';
import { flagsForStaffType, isStaffType, penaltyFlagsOn, staffReturnDateError, staffTypeChangeError, staffTypeOf, type StaffType } from '@/lib/staff-type';
import { getStaffTypeChanges, saveStaffWithTypeChange, staffHistorySummary } from '@/lib/staff-type-history';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const url = new URL(request.url);
    const active = url.searchParams.get('active');
    const requestedDate = url.searchParams.get('date');
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
      staffType: staff.staffType,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    })
    .from(staff)
    .where(whereClause)
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

    const currentDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : getAccraDateKey();
    const leavePeriods = staffList.length > 0
      ? await db.select({
          endDate: staffLeavePeriod.endDate,
          leaveType: staffLeavePeriod.leaveType,
          returnedOn: staffLeavePeriod.returnedOn,
          source: staffLeavePeriod.source,
          staffId: staffLeavePeriod.staffId,
          startDate: staffLeavePeriod.startDate,
        })
        .from(staffLeavePeriod)
        .where(and(
          inArray(staffLeavePeriod.staffId, staffList.map((member) => member.id)),
          ne(staffLeavePeriod.source, 'staff_status'),
          lte(staffLeavePeriod.startDate, currentDate),
          or(isNull(staffLeavePeriod.returnedOn), gt(staffLeavePeriod.returnedOn, currentDate)),
          or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, currentDate)),
        ))
        .orderBy(desc(staffLeavePeriod.startDate))
      : [];
    const typeChanges = await getStaffTypeChanges(staffList.map((member) => member.id));
    const responseStaff = staffList.map((member) => {
      const activeLeave = getActiveLeavePeriod(leavePeriods, member.id, currentDate);
      return {
        ...member,
        // The person's type history and the charge rules for the requested date.
        typeChanges: typeChanges.get(member.id) || [],
        chargeOnDate: penaltyFlagsOn(currentDate, typeChanges.get(member.id), member),
        activeLeave: member.archived !== true && activeLeave ? {
          endDate: activeLeave.endDate,
          leaveType: activeLeave.leaveType,
          returnedOn: activeLeave.returnedOn,
          source: activeLeave.source,
          staffId: activeLeave.staffId,
          startDate: activeLeave.startDate,
        } : null,
        onLeave: member.archived !== true && Boolean(activeLeave),
      };
    });

    return NextResponse.json(responseStaff, {
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
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  try {
    const actor = await currentUser();
    const body = await request.json();
    const { fullName, email, department, unit, staffNo, gender, rank } = body;
    const name = typeof fullName === 'string' ? fullName.trim() : '';
    const normalizedEmail = normalizeStaffEmail(email);
    const staffType: StaffType = isStaffType(body?.staffType)
      ? body.staffType
      : body?.isAttendanceOnly === true ? 'special' : body?.isNssPersonnel === true ? 'nss' : 'main';
    const { isAttendanceOnly, isNssPersonnel } = flagsForStaffType(staffType);

    if (!name) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const normalizedDepartment = typeof department === 'string' && department.trim() ? department.trim() : null;
    const normalizedUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
    const normalizedStaffNo = typeof staffNo === 'string' && staffNo.trim() ? staffNo.trim() : null;
    const normalizedGender = typeof gender === 'string' && gender.trim() ? gender.trim() : null;
    const normalizedRank = typeof rank === 'string' && rank.trim() ? rank.trim() : null;

    if (!normalizedGender) {
      return NextResponse.json({ error: 'Gender is required for staff profiles.' }, { status: 400 });
    }

    if (staffType === 'main' && (!normalizedStaffNo || !normalizedRank)) {
      return NextResponse.json(
        { error: 'Staff No. and Rank are required for main staff profiles.' },
        { status: 400 },
      );
    }

    const [existingByName] = await db.select()
      .from(staff)
      .where(eq(sql`lower(${staff.fullName})`, name.toLowerCase()))
      .limit(1);
    const [existingByEmail] = normalizedEmail
      ? await db.select()
        .from(staff)
        .where(eq(sql`lower(${staff.email})`, normalizedEmail))
        .limit(1)
      : [];

    if (existingByEmail && existingByName && existingByEmail.id !== existingByName.id) {
      return NextResponse.json(
        { error: 'This email is already linked to another staff member.' },
        { status: 409 },
      );
    }
    // The same person comes back on the same profile (same email or name), never a second account.
    const existingStaff = existingByEmail || existingByName;

    if (existingStaff) {
      if (existingStaff.archived) {
        const previousType = staffTypeOf(existingStaff);
        const today = getAccraDateKey();
        const { awayStart, latestChangeDate } = await staffHistorySummary(existingStaff.id);
        const typeError = staffTypeChangeError({
          effectiveFrom: today,
          from: previousType,
          latestChangeDate,
          to: staffType,
          today,
        }) || staffReturnDateError({
          awayStart,
          effectiveFrom: today,
          latestChangeDate,
          today,
        });
        if (typeError) {
          return NextResponse.json({ error: `${existingStaff.fullName} is archived. ${typeError}` }, { status: 400 });
        }
        const actorEmail = actor?.emailAddresses[0]?.emailAddress || null;
        const [restored] = await saveStaffWithTypeChange(existingStaff.id, {
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
          staffType,
          updatedAt: new Date(),
        }, {
          actorEmail,
          effectiveFrom: today,
          previousType,
          staffId: existingStaff.id,
          staffType,
          today,
        });
        if (staffType !== previousType) {
          await recalculateStaffStoredPenalties({
            actor: { email: actorEmail, id: actor?.id },
            reason: 'staff-type-changed',
            staffMember: {
              fullName: restored.fullName,
              id: restored.id,
              isAttendanceOnly: restored.isAttendanceOnly,
              isNssPersonnel: restored.isNssPersonnel,
            },
          });
        }

        await writeAuditEvent({
          entityType: 'staff',
          entityId: restored.id,
          action: 'RESTORE',
          before: existingStaff,
          after: restored,
          reason: 'staff',
        });

        publishRealtime('dashboard', 'invalidate', { reason: 'staff' });

        publishRealtime('payments', 'invalidate', { reason: 'staff' });

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
        { error: `${existingStaff.fullName} already has a profile. Change their type there instead of adding a duplicate.` },
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
      staffType,
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

    publishRealtime('payments', 'invalidate', { reason: 'staff' });

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
