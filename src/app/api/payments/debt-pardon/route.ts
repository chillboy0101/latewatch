import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { enforceRole } from '@/lib/auth/roles';
import { getAccraDateKey } from '@/lib/date-key';
import { isIsoDateKey } from '@/lib/date-format';
import { applyLatenessDebtPardon, previewLatenessDebtPardon } from '@/lib/lateness-debt-pardon';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

const HASH_PATTERN = /^[0-9a-f]{32}$/i;
const MAX_REASON_LENGTH = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Empty means everyone; otherwise the pardon covers only this staff member.
async function resolveStaff(value: unknown) {
  const staffId = typeof value === 'string' ? value.trim() : '';
  if (!staffId) return { staffId: null, staffName: null };
  if (!UUID_PATTERN.test(staffId)) return { error: 'Select a valid staff member' };
  const [member] = await db.select({ fullName: staff.fullName, id: staff.id }).from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!member) return { error: 'Staff member was not found' };
  return { staffId: member.id, staffName: member.fullName };
}

function resolveCutoffDate(value: unknown) {
  const today = getAccraDateKey();
  const cutoffDate = typeof value === 'string' && value.trim() ? value.trim() : today;
  if (!isIsoDateKey(cutoffDate)) return { error: 'A valid cutoff date is required' };
  if (cutoffDate > today) return { error: 'The cutoff date cannot be in the future' };
  return { cutoffDate };
}

export async function GET(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  const resolved = resolveCutoffDate(request.nextUrl.searchParams.get('cutoffDate'));
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const target = await resolveStaff(request.nextUrl.searchParams.get('staffId'));
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  try {
    const preview = await previewLatenessDebtPardon(resolved.cutoffDate, target.staffId);
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to preview debt pardon:', error);
    return NextResponse.json({ error: 'Failed to preview debt pardon' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await enforceRole(['admin']);
  if (authError) {
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const resolved = resolveCutoffDate(body?.cutoffDate);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const target = await resolveStaff(body?.staffId);
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  const expectedSnapshotHash = typeof body?.expectedSnapshotHash === 'string' ? body.expectedSnapshotHash.trim() : '';
  if (!HASH_PATTERN.test(expectedSnapshotHash)) {
    return NextResponse.json({ error: 'Preview the pardon before applying it' }, { status: 400 });
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) {
    return NextResponse.json({ error: 'A reason for the pardon is required' }, { status: 400 });
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `The reason must be ${MAX_REASON_LENGTH} characters or fewer` }, { status: 400 });
  }

  const actorEmail = (user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || '').toLowerCase();
  if (!actorEmail) {
    return NextResponse.json({ error: 'Your account has no email address to record on the pardon' }, { status: 400 });
  }

  try {
    const result = await applyLatenessDebtPardon({
      actorEmail,
      actorUserId: user.id,
      cutoffDate: resolved.cutoffDate,
      expectedSnapshotHash,
      reason,
      source: 'payments-page-pardon',
      staffId: target.staffId,
      staffName: target.staffName,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Debts changed since the preview, or there is nothing left to pardon. Nothing was pardoned; review the preview again.' },
        { status: 409 },
      );
    }
    if (result.detailsWritten !== result.entryCount || result.auditWritten !== 1) {
      console.error('Debt pardon write verification failed:', result);
      return NextResponse.json({ error: 'The pardon was recorded but failed verification. Check the audit trail.' }, { status: 500 });
    }

    const payload = { reason: 'lateness-debt-pardon', pardonId: result.id, staffId: target.staffId };
    for (const channel of ['payments', 'entries', 'staff-penalty-history', 'dashboard', 'notifications', 'audit-trail']) {
      publishRealtime(channel, 'invalidate', payload);
    }

    return NextResponse.json({ ...result, cutoffDate: resolved.cutoffDate, staffName: target.staffName });
  } catch (error) {
    console.error('Failed to apply debt pardon:', error);
    return NextResponse.json({ error: 'Failed to apply debt pardon' }, { status: 500 });
  }
}
