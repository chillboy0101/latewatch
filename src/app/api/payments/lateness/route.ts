import { currentUser } from '@clerk/nextjs/server';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessEntry, latenessPayment, latenessPaymentAllocation, staff } from '@/db/schema';
import { allocateLatenessPayment, summarizeLatenessPaymentEntries } from '@/lib/lateness-payments';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OVERPAYMENT_MESSAGE = 'Payment amount exceeds outstanding balance';

function isDateKey(value: string | null) {
  return Boolean(value && DATE_KEY_PATTERN.test(value));
}

function normalizeAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(amount) ? amount : null;
}

function amountString(value: number) {
  return value.toFixed(2);
}

function sumAmount(values: Array<string | number | null | undefined>) {
  let total = 0;
  for (const value of values) {
    const amount = Number.parseFloat(String(value ?? '0'));
    total += Number.isFinite(amount) ? amount : 0;
  }

  return total;
}

function getActorEmail(user: Awaited<ReturnType<typeof currentUser>>) {
  return user?.primaryEmailAddress?.emailAddress
    || user?.emailAddresses[0]?.emailAddress
    || 'system';
}

async function getWeekEntries(input: {
  entryId?: string | null;
  staffId: string;
  weekEnd: string;
  weekStart: string;
}) {
  const rows = await db.select()
    .from(latenessEntry)
    .where(and(
      eq(latenessEntry.staffId, input.staffId),
      gte(latenessEntry.date, input.weekStart),
      lte(latenessEntry.date, input.weekEnd),
    ))
    .orderBy(asc(latenessEntry.date));

  return input.entryId ? rows.filter((row) => row.id === input.entryId) : rows;
}

async function getAllocationsForEntries(entryIds: string[]) {
  if (entryIds.length === 0) return [];

  return db.select()
    .from(latenessPaymentAllocation)
    .where(inArray(latenessPaymentAllocation.entryId, entryIds));
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const url = new URL(request.url);
    const weekStart = url.searchParams.get('weekStart');
    const weekEnd = url.searchParams.get('weekEnd');
    const staffId = url.searchParams.get('staffId');

    if (!isDateKey(weekStart) || !isDateKey(weekEnd)) {
      return NextResponse.json({ error: 'Valid weekStart and weekEnd are required' }, { status: 400 });
    }

    const staffWhere = staffId
      ? and(eq(staff.id, staffId), eq(staff.active, true), eq(staff.archived, false))
      : and(eq(staff.active, true), eq(staff.archived, false));

    const staffRows = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
      isAttendanceOnly: staff.isAttendanceOnly,
      isNssPersonnel: staff.isNssPersonnel,
    })
      .from(staff)
      .where(staffWhere)
      .orderBy(asc(staff.displayOrder), asc(staff.fullName));

    const staffIds = staffRows.map((member) => member.id);
    const entryRows = staffIds.length === 0
      ? []
      : await db.select()
        .from(latenessEntry)
        .where(and(
          inArray(latenessEntry.staffId, staffIds),
          gte(latenessEntry.date, weekStart!),
          lte(latenessEntry.date, weekEnd!),
        ))
        .orderBy(asc(latenessEntry.date));

    const penaltyEntries = entryRows.filter((entry) => Number(entry.computedAmount || 0) > 0);
    const allocations = await getAllocationsForEntries(penaltyEntries.map((entry) => entry.id));
    const allocationsByStaff = new Map<string, typeof allocations>();
    const entriesByStaff = new Map<string, typeof penaltyEntries>();

    for (const entry of penaltyEntries) {
      const list = entriesByStaff.get(entry.staffId) || [];
      list.push(entry);
      entriesByStaff.set(entry.staffId, list);
    }

    const staffIdByEntryId = new Map(penaltyEntries.map((entry) => [entry.id, entry.staffId]));
    for (const allocation of allocations) {
      const allocationStaffId = staffIdByEntryId.get(allocation.entryId);
      if (!allocationStaffId) continue;
      const list = allocationsByStaff.get(allocationStaffId) || [];
      list.push(allocation);
      allocationsByStaff.set(allocationStaffId, list);
    }

    const rows = staffRows.map((member) => {
      const entries = summarizeLatenessPaymentEntries({
        allocations: allocationsByStaff.get(member.id) || [],
        entries: entriesByStaff.get(member.id) || [],
      });
      const totalPenalty = sumAmount(entries.map((entry) => entry.penaltyAmount));
      const paidAmount = sumAmount(entries.map((entry) => entry.paidAmount));
      const outstandingBalance = sumAmount(entries.map((entry) => entry.outstandingAmount));

      return {
        email: member.email,
        entries,
        fullName: member.fullName,
        id: member.id,
        isAttendanceOnly: member.isAttendanceOnly,
        isNssPersonnel: member.isNssPersonnel,
        outstandingBalance: amountString(outstandingBalance),
        paidAmount: amountString(paidAmount),
        totalPenalty: amountString(totalPenalty),
      };
    });

    return NextResponse.json({
      staff: rows,
      weekEnd,
      weekStart,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load lateness payments:', error);
    return NextResponse.json({ error: 'Failed to load lateness payments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const staffId = typeof body?.staffId === 'string' ? body.staffId : '';
    const weekStart = typeof body?.weekStart === 'string' ? body.weekStart : '';
    const weekEnd = typeof body?.weekEnd === 'string' ? body.weekEnd : '';
    const entryId = typeof body?.entryId === 'string' && body.entryId.trim() ? body.entryId.trim() : null;
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const amount = normalizeAmount(body?.amount);

    if (!staffId || !isDateKey(weekStart) || !isDateKey(weekEnd) || amount == null || amount <= 0) {
      return NextResponse.json({ error: 'Valid staff, amount, weekStart, and weekEnd are required' }, { status: 400 });
    }

    const [member] = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
    })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    }

    const entries = await getWeekEntries({ entryId, staffId, weekEnd, weekStart });
    const penaltyEntries = entries.filter((entry) => Number(entry.computedAmount || 0) > 0);
    const existingAllocations = await getAllocationsForEntries(penaltyEntries.map((entry) => entry.id));
    let allocationPlan: ReturnType<typeof allocateLatenessPayment>;

    try {
      allocationPlan = allocateLatenessPayment({
        amount,
        entries: penaltyEntries,
        existingAllocations,
        entryId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : OVERPAYMENT_MESSAGE;
      const status = message === OVERPAYMENT_MESSAGE || message === 'Lateness entry was not found' ? 400 : 422;
      return NextResponse.json({ error: message }, { status });
    }

    const actorEmail = getActorEmail(user);
    const [payment] = await db.insert(latenessPayment)
      .values({
        amount: amountString(amount),
        note,
        recordedByEmail: actorEmail,
        recordedByUserId: user.id,
        staffId,
        weekEnd,
        weekStart,
      })
      .returning();

    const createdAllocations = [];
    for (const allocation of allocationPlan.allocations) {
      const [createdAllocation] = await db.insert(latenessPaymentAllocation)
        .values({
          allocatedAmount: allocation.amount,
          entryId: allocation.entryId,
          paymentId: payment.id,
        })
        .returning();
      if (createdAllocation) createdAllocations.push(createdAllocation);
    }

    await writeAuditEvent({
      entityType: 'lateness_payment',
      entityId: payment.id,
      action: 'CREATE',
      before: null,
      after: {
        allocations: createdAllocations,
        member,
        payment,
      },
      actor: { email: actorEmail, id: user.id },
      publish: false,
      reason: 'lateness-payment',
    });

    publishRealtime('payments', 'invalidate', { reason: 'lateness-payment', staffId, weekEnd, weekStart });
    publishRealtime('staff-penalty-history', 'invalidate', { reason: 'lateness-payment', staffId });
    publishRealtime('dashboard', 'invalidate', { reason: 'lateness-payment' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'lateness-payment' });
    publishRealtime('notifications', 'invalidate', { reason: 'lateness-payment' });

    return NextResponse.json({
      allocations: createdAllocations,
      outstandingAfter: allocationPlan.outstandingAfter,
      outstandingBefore: allocationPlan.outstandingBefore,
      payment,
      success: true,
    });
  } catch (error) {
    console.error('Failed to record lateness payment:', error);
    return NextResponse.json({ error: 'Failed to record lateness payment' }, { status: 500 });
  }
}
