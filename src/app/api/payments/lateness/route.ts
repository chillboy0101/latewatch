import { auth, currentUser } from '@clerk/nextjs/server';
import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { latenessDebtPardon, latenessDebtPardonEntry, latenessEntry, latenessPayment, latenessPaymentAllocation, staff } from '@/db/schema';
import { syncLatenessEntriesFromAttendanceForRange } from '@/lib/attendance-lateness-sync';
import { recordPaymentAtomically } from '@/lib/lateness-payment-record';
import { sendLatenessPaymentReceiptPush } from '@/lib/lateness-payment-receipt-push';
import {
  allocateLatenessPayment,
  getWeekBoundsForDate,
  summarizeLatenessPaymentEntries,
  summarizeLatenessPaymentsByMonth,
  type LatenessPaymentEntryLike,
} from '@/lib/lateness-payments';
import { publishRealtime } from '@/lib/realtime';
import { writeAuditEvent } from '@/lib/audit';
import { getAccraDateKey } from '@/lib/date-key';

export const dynamic = 'force-dynamic';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
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

// The first and last day of a month key such as 2026-10.
function monthDateRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
    start: `${month}-01`,
  };
}

async function getWeekEntries(input: {
  entryId?: string | null;
  range: { end: string; start: string } | null;
  staffId: string;
}) {
  const whereClause = input.range
    ? and(
      eq(latenessEntry.staffId, input.staffId),
      gte(latenessEntry.date, input.range.start),
      lte(latenessEntry.date, input.range.end),
    )
    : eq(latenessEntry.staffId, input.staffId);

  const rows = await db.select()
    .from(latenessEntry)
    .where(whereClause)
    .orderBy(asc(latenessEntry.date));

  return input.entryId ? rows.filter((row) => row.id === input.entryId) : rows;
}

async function getAllocationsForEntries(entryIds: string[]) {
  if (entryIds.length === 0) return [];

  return db.select({
    allocatedAmount: latenessPaymentAllocation.allocatedAmount,
    entryId: latenessPaymentAllocation.entryId,
    paymentId: latenessPaymentAllocation.paymentId,
    recordedAt: latenessPayment.recordedAt,
  })
    .from(latenessPaymentAllocation)
    .innerJoin(latenessPayment, eq(latenessPaymentAllocation.paymentId, latenessPayment.id))
    .where(inArray(latenessPaymentAllocation.entryId, entryIds));
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const url = new URL(request.url);
    const weekStart = url.searchParams.get('weekStart');
    const weekEnd = url.searchParams.get('weekEnd');
    const staffId = url.searchParams.get('staffId');
    const hasDateFilter = Boolean(weekStart || weekEnd);

    if (hasDateFilter && (!isDateKey(weekStart) || !isDateKey(weekEnd))) {
      return NextResponse.json({ error: 'Valid start and end dates are required when filtering payments' }, { status: 400 });
    }
    const historicalStaffRows = await db.select({ staffId: latenessEntry.staffId })
      .from(latenessEntry);
    const historicalStaffIds = [...new Set(historicalStaffRows.map((row) => row.staffId))];
    const chargeableRoster = and(eq(staff.active, true), eq(staff.archived, false), eq(staff.isAttendanceOnly, false));
    // Anyone ever charged stays listed (also after leaving or becoming attendance-only), so their
    // paid history and the totals never change.
    const chargedStaff = historicalStaffIds.length > 0 ? inArray(staff.id, historicalStaffIds) : undefined;
    const staffWhere = staffId
      ? and(eq(staff.id, staffId), or(chargeableRoster, chargedStaff))
      : or(chargeableRoster, chargedStaff);

    const staffRows = await db.select({
      active: staff.active,
      archived: staff.archived,
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
    const entryWhere = hasDateFilter
      ? and(
        inArray(latenessEntry.staffId, staffIds),
        gte(latenessEntry.date, weekStart!),
        lte(latenessEntry.date, weekEnd!),
      )
      : inArray(latenessEntry.staffId, staffIds);
    const entryRows = staffIds.length === 0
      ? []
      : await db.select()
        .from(latenessEntry)
        .where(entryWhere)
        .orderBy(asc(latenessEntry.date));

    const entryIds = entryRows.map((entry) => entry.id);
    const pardonRows = entryIds.length === 0
      ? []
      : await db.select({
        entryId: latenessDebtPardonEntry.entryId,
        forgivenAmount: latenessDebtPardonEntry.forgivenAmount,
        pardonedAt: latenessDebtPardon.cutoffAt,
      })
        .from(latenessDebtPardonEntry)
        .innerJoin(latenessDebtPardon, eq(latenessDebtPardonEntry.pardonId, latenessDebtPardon.id))
        .where(inArray(latenessDebtPardonEntry.entryId, entryIds));
    const pardonsByEntryId = new Map(pardonRows.map((pardon) => [pardon.entryId, pardon]));
    // A pardoned entry whose amount later became zero (for example an excused absence) no longer
    // carries a penalty, so it must not be reported as penalty or pardoned.
    const penaltyEntries = entryRows.filter((entry) => Number(entry.computedAmount || 0) > 0);
    const financialEntryIds = penaltyEntries.map((entry) => entry.id);
    const allocations = await getAllocationsForEntries(financialEntryIds);
    const allocationsByStaff = new Map<string, typeof allocations>();
    const entriesByStaff = new Map<string, LatenessPaymentEntryLike[]>();

    for (const entry of penaltyEntries) {
      const list = entriesByStaff.get(entry.staffId) || [];
      const pardon = pardonsByEntryId.get(entry.id);
      list.push(pardon == null
        ? entry
        : { ...entry, pardonedAmount: pardon.forgivenAmount });
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

    // Each person's recorded payments, newest first, so a mistaken one can be undone.
    const paymentRows = hasDateFilter || staffIds.length === 0
      ? []
      : await db.select({
        amount: latenessPayment.amount,
        id: latenessPayment.id,
        note: latenessPayment.note,
        recordedAt: latenessPayment.recordedAt,
        recordedByEmail: latenessPayment.recordedByEmail,
        staffId: latenessPayment.staffId,
      })
        .from(latenessPayment)
        .where(inArray(latenessPayment.staffId, staffIds))
        .orderBy(desc(latenessPayment.recordedAt));
    // The months whose penalty days each payment paid, so the page can list a month's payments.
    const monthByEntryId = new Map(penaltyEntries.map((entry) => [entry.id, entry.date.slice(0, 7)]));
    const monthsByPaymentId = new Map<string, Set<string>>();
    for (const allocation of allocations) {
      const month = monthByEntryId.get(allocation.entryId);
      if (!month) continue;
      const months = monthsByPaymentId.get(allocation.paymentId) || new Set<string>();
      months.add(month);
      monthsByPaymentId.set(allocation.paymentId, months);
    }
    const paymentsByStaff = new Map<string, typeof paymentRows>();
    for (const payment of paymentRows) {
      const list = paymentsByStaff.get(payment.staffId) || [];
      list.push(payment);
      paymentsByStaff.set(payment.staffId, list);
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
        // Left, deactivated or attendance-only now: the page lists them only while they still owe.
        former: !member.active || member.archived || member.isAttendanceOnly,
        fullName: member.fullName,
        id: member.id,
        isAttendanceOnly: member.isAttendanceOnly,
        isNssPersonnel: member.isNssPersonnel,
        outstandingBalance: amountString(outstandingBalance),
        paidAmount: amountString(paidAmount),
        payments: (paymentsByStaff.get(member.id) || []).map((payment) => ({
          amount: payment.amount,
          id: payment.id,
          months: [...(monthsByPaymentId.get(payment.id) || [])].sort(),
          note: payment.note,
          recordedAt: payment.recordedAt,
          recordedByEmail: payment.recordedByEmail,
        })),
        totalPenalty: amountString(totalPenalty),
      };
    });
    const monthlyBreakdown = summarizeLatenessPaymentsByMonth({
      allocations,
      currentDate: getAccraDateKey(),
      entries: penaltyEntries.map((entry) => {
        const pardon = pardonsByEntryId.get(entry.id);
        return {
          computedAmount: entry.computedAmount,
          date: entry.date.slice(0, 10),
          id: entry.id,
          pardonedAmount: pardon?.forgivenAmount,
        };
      }),
    });

    return NextResponse.json({
      monthlyBreakdown,
      staff: rows,
      scope: hasDateFilter ? 'week' : 'all',
      weekEnd: hasDateFilter ? weekEnd : null,
      weekStart: hasDateFilter ? weekStart : null,
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
    const hasDateFilter = Boolean(weekStart || weekEnd);
    // A month (2026-10) limits the payment to that month's penalty days, as the Payments page
    // shows one month at a time.
    const month = typeof body?.month === 'string' ? body.month : '';

    if (!staffId || amount == null || amount <= 0) {
      return NextResponse.json({ error: 'Valid staff and amount are required' }, { status: 400 });
    }

    if (hasDateFilter && (!isDateKey(weekStart) || !isDateKey(weekEnd))) {
      return NextResponse.json({ error: 'Valid start and end dates are required when limiting a payment' }, { status: 400 });
    }
    if (month && (hasDateFilter || !MONTH_KEY_PATTERN.test(month))) {
      return NextResponse.json({ error: 'A valid month is required when limiting a payment to a month' }, { status: 400 });
    }
    if (hasDateFilter) {
      await syncLatenessEntriesFromAttendanceForRange(weekStart, weekEnd);
    }

    const [member] = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
    })
      .from(staff)
      // Former (archived or inactive) and now attendance-only staff can still settle what they
      // owe; with nothing owed, the payment is refused below.
      .where(eq(staff.id, staffId))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Staff member was not found' }, { status: 404 });
    }

    const entries = await getWeekEntries({
      entryId,
      range: hasDateFilter ? { end: weekEnd, start: weekStart } : month ? monthDateRange(month) : null,
      staffId,
    });
    const penaltyEntries = entries.filter((entry) => Number(entry.computedAmount || 0) > 0);
    const existingAllocations = await getAllocationsForEntries(penaltyEntries.map((entry) => entry.id));
    const pardonRows = penaltyEntries.length === 0
      ? []
      : await db.select({
        entryId: latenessDebtPardonEntry.entryId,
        forgivenAmount: latenessDebtPardonEntry.forgivenAmount,
      })
        .from(latenessDebtPardonEntry)
        .where(inArray(latenessDebtPardonEntry.entryId, penaltyEntries.map((entry) => entry.id)));
    const pardonsByEntryId = new Map(pardonRows.map((pardon) => [pardon.entryId, pardon.forgivenAmount]));
    const payableEntries = penaltyEntries.map((entry) => {
      const forgivenAmount = pardonsByEntryId.get(entry.id);
      return forgivenAmount == null
        ? entry
        : { ...entry, pardonedAmount: forgivenAmount };
    });
    let allocationPlan: ReturnType<typeof allocateLatenessPayment>;

    try {
      allocationPlan = allocateLatenessPayment({
        amount,
        entries: payableEntries,
        existingAllocations,
        entryId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : OVERPAYMENT_MESSAGE;
      const status = message === OVERPAYMENT_MESSAGE || message === 'Lateness entry was not found' ? 400 : 422;
      return NextResponse.json({
        error: month && message === OVERPAYMENT_MESSAGE ? 'Payment amount exceeds this month\'s balance' : message,
      }, { status });
    }

    const dateByEntryId = new Map(payableEntries.map((entry) => [entry.id, entry.date]));
    const allocatedDates = allocationPlan.allocations
      .map((allocation) => dateByEntryId.get(allocation.entryId))
      .filter((date): date is string => Boolean(date))
      .sort();
    const fallbackDate = payableEntries[0]?.date || new Date().toISOString().slice(0, 10);
    const firstPaymentDate = allocatedDates[0] || fallbackDate;
    const lastPaymentDate = allocatedDates[allocatedDates.length - 1] || firstPaymentDate;
    const firstPaymentWeek = getWeekBoundsForDate(firstPaymentDate);
    const lastPaymentWeek = getWeekBoundsForDate(lastPaymentDate);
    const paymentWeekStart = hasDateFilter ? weekStart : firstPaymentWeek.weekStart;
    const paymentWeekEnd = hasDateFilter ? weekEnd : lastPaymentWeek.weekEnd;

    const actorEmail = getActorEmail(user);
    const paidByEntryId = new Map<string, number>();
    for (const allocation of existingAllocations) {
      paidByEntryId.set(allocation.entryId, (paidByEntryId.get(allocation.entryId) || 0) + Number(allocation.allocatedAmount || 0));
    }
    const penaltyByEntryId = new Map(payableEntries.map((entry) => [entry.id, entry.computedAmount]));
    const paymentId = await recordPaymentAtomically({
      allocations: allocationPlan.allocations.map((allocation) => ({
        ...allocation,
        expectedForgiven: pardonsByEntryId.get(allocation.entryId) || '0',
        expectedPaid: amountString(paidByEntryId.get(allocation.entryId) || 0),
        expectedPenalty: penaltyByEntryId.get(allocation.entryId) || '0',
      })),
      amount: amountString(amount),
      note,
      recordedByEmail: actorEmail,
      recordedByUserId: user.id,
      staffId,
      weekEnd: paymentWeekEnd,
      weekStart: paymentWeekStart,
    });

    if (!paymentId) {
      return NextResponse.json({
        error: 'This balance changed while the payment was being recorded (it may already have been recorded). Refresh and check before trying again.',
      }, { status: 409 });
    }

    const [payment] = await db.select().from(latenessPayment).where(eq(latenessPayment.id, paymentId)).limit(1);
    const createdAllocations = await db.select()
      .from(latenessPaymentAllocation)
      .where(eq(latenessPaymentAllocation.paymentId, paymentId));

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

    publishRealtime('payments', 'invalidate', {
      reason: 'lateness-payment',
      staffId,
      weekEnd: paymentWeekEnd,
      weekStart: paymentWeekStart,
    });
    publishRealtime('staff-penalty-history', 'invalidate', { reason: 'lateness-payment', staffId });
    publishRealtime('dashboard', 'invalidate', { reason: 'lateness-payment' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'lateness-payment' });
    publishRealtime('notifications', 'invalidate', { reason: 'lateness-payment' });

    try {
      await sendLatenessPaymentReceiptPush(payment);
    } catch (error) {
      console.error('Failed to send payment receipt notification:', error);
    }

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
