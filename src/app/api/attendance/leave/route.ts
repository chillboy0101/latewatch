import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq, gte, isNull, ne, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff, staffLeavePeriod } from '@/db/schema';
import { getAccraDateKey } from '@/lib/date-key';
import { isIsoDateKey } from '@/lib/date-format';
import { STAFF_LEAVE_TYPES, type StaffLeaveType } from '@/lib/staff-leave';
import { findOverlappingStaffLeavePeriod, getLeaveFinancialReview } from '@/lib/staff-leave-service';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';
import { enforceRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const VALID_LEAVE_TYPES = new Set<string>(STAFF_LEAVE_TYPES.map((type) => type.value));

function publishLeaveInvalidations(reason: string, staffId: string) {
  for (const channel of ['attendance', 'dashboard', 'entries', 'notifications', 'payments', 'staff-penalty-history', 'audit-trail']) {
    publishRealtime(channel, 'invalidate', { reason, staffId });
  }
}

export async function GET(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const url = new URL(request.url);
    const staffId = url.searchParams.get('staffId');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const hasReviewInput = Boolean(staffId || startDate || endDate);

    if (hasReviewInput) {
      if (!staffId || !startDate || !endDate || !isIsoDateKey(startDate) || !isIsoDateKey(endDate) || startDate > endDate) {
        return NextResponse.json({ error: 'Valid staff and ordered leave dates are required' }, { status: 400 });
      }

      const [overlap, financialReview] = await Promise.all([
        findOverlappingStaffLeavePeriod({ endDate, staffId, startDate }),
        getLeaveFinancialReview({ endDate, staffId, startDate }),
      ]);

      return NextResponse.json({
        financialReview,
        hasOverlap: Boolean(overlap),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const currentDate = getAccraDateKey();
    const periods = await db.select({
      createdByEmail: staffLeavePeriod.createdByEmail,
      endDate: staffLeavePeriod.endDate,
      id: staffLeavePeriod.id,
      leaveType: staffLeavePeriod.leaveType,
      returnedOn: staffLeavePeriod.returnedOn,
      source: staffLeavePeriod.source,
      staffId: staffLeavePeriod.staffId,
      staffName: staff.fullName,
      startDate: staffLeavePeriod.startDate,
    })
      .from(staffLeavePeriod)
      .innerJoin(staff, eq(staff.id, staffLeavePeriod.staffId))
      .where(and(
        ne(staffLeavePeriod.source, 'staff_status'),
        or(isNull(staffLeavePeriod.endDate), gte(staffLeavePeriod.endDate, currentDate)),
        or(isNull(staffLeavePeriod.returnedOn), gte(staffLeavePeriod.returnedOn, currentDate)),
      ))
      .orderBy(asc(staffLeavePeriod.startDate), asc(staff.fullName));

    return NextResponse.json(periods, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load staff leave:', error);
    return NextResponse.json({ error: 'Failed to load staff leave' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  try {
    const user = await currentUser();
    const body = await request.json().catch(() => ({}));
    const staffId = typeof body?.staffId === 'string' ? body.staffId : '';
    const startDate = typeof body?.startDate === 'string' ? body.startDate : '';
    const endDate = typeof body?.endDate === 'string' ? body.endDate : '';
    const leaveType = typeof body?.leaveType === 'string' ? body.leaveType : '';

    if (!staffId || !isIsoDateKey(startDate) || !isIsoDateKey(endDate) || startDate > endDate) {
      return NextResponse.json({ error: 'Select a staff member and valid ordered leave dates' }, { status: 400 });
    }
    if (!VALID_LEAVE_TYPES.has(leaveType)) {
      return NextResponse.json({ error: 'Select a valid leave type' }, { status: 400 });
    }

    const [member] = await db.select({ fullName: staff.fullName, id: staff.id, archived: staff.archived })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    if (!member || member.archived) {
      return NextResponse.json({ error: 'Staff member was not found or is former personnel' }, { status: 404 });
    }

    const overlap = await findOverlappingStaffLeavePeriod({ endDate, staffId, startDate });
    if (overlap) {
      return NextResponse.json({ error: 'These dates overlap an existing leave period' }, { status: 409 });
    }

    const financialReview = await getLeaveFinancialReview({ endDate, staffId, startDate });
    const actorEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'system';
    const [period] = await db.insert(staffLeavePeriod)
      .values({
        createdByEmail: actorEmail,
        endDate,
        leaveType: leaveType as StaffLeaveType,
        returnedOn: null,
        source: 'approved_leave',
        staffId,
        startDate,
      })
      .returning();

    await writeAuditEvent({
      entityType: 'staff_leave_period',
      entityId: period.id,
      action: 'CREATE',
      before: null,
      after: { ...period, financialReview, staffName: member.fullName },
      actor: { email: actorEmail, id: user?.id || null },
      reason: 'approved-staff-leave',
    });
    publishLeaveInvalidations('approved-staff-leave', staffId);

    return NextResponse.json({ financialReview, period }, { status: 201 });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code === '23P01' || code === '23505') {
      return NextResponse.json({ error: 'These dates overlap an existing leave period' }, { status: 409 });
    }
    console.error('Failed to approve staff leave:', error);
    return NextResponse.json({ error: 'Failed to approve staff leave' }, { status: 500 });
  }
}