import { currentUser } from '@clerk/nextjs/server';
import { and, eq, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { deviceTransferRequest, staff, staffDevice } from '@/db/schema';
import {
  findSharedAttendanceDeviceOwner,
  SHARED_ATTENDANCE_DEVICE_MESSAGE,
  SHARED_ATTENDANCE_DEVICE_RESULT,
} from '@/lib/attendance-device-security';
import { writeAuditEvent } from '@/lib/audit';
import {
  isStaffSessionRevocationError,
  revokeStaffLoginSessionById,
  revokeStaffLoginSessionsExcept,
  type StaffSessionRevocationResult,
} from '@/lib/clerk-session-revocation';
import { disableActivePushSubscriptionsForStaff } from '@/lib/push-subscriptions';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

function actionFromBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = (value as Record<string, unknown>).action;
  return action === 'approve' || action === 'reject' ? action : null;
}

// Puts a claimed request back to pending when the approval can't go through.
async function releaseClaim(id: string) {
  await db.update(deviceTransferRequest)
    .set({ reviewedAt: null, reviewedByEmail: null, reviewedByUserId: null, status: 'pending', updatedAt: new Date() })
    .where(eq(deviceTransferRequest.id, id));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let claimedId: string | null = null;
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = actionFromBody(body);
    if (!action) {
      return NextResponse.json({ error: 'Approval action is required' }, { status: 400 });
    }

    const [transfer] = await db.select()
      .from(deviceTransferRequest)
      .where(eq(deviceTransferRequest.id, id))
      .limit(1);

    if (!transfer) {
      return NextResponse.json({ error: 'Device transfer request was not found' }, { status: 404 });
    }

    if (transfer.status !== 'pending') {
      return NextResponse.json({ error: 'This request has already been reviewed' }, { status: 400 });
    }

    const [member] = await db.select({
      email: staff.email,
      fullName: staff.fullName,
      id: staff.id,
    })
      .from(staff)
      .where(eq(staff.id, transfer.staffId))
      .limit(1);

    const [beforeDevice] = await db.select()
      .from(staffDevice)
      .where(eq(staffDevice.staffId, transfer.staffId))
      .limit(1);

    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const now = new Date();

    // Claim the request before acting: only one review can move it off "pending", so two admins
    // can't approve and reject it at once, or approve it twice.
    const [reviewedRequest] = await db.update(deviceTransferRequest)
      .set({
        reviewedAt: now,
        reviewedByEmail: actorEmail,
        reviewedByUserId: user.id,
        status: action === 'approve' ? 'approved' : 'rejected',
        updatedAt: now,
      })
      .where(and(eq(deviceTransferRequest.id, transfer.id), eq(deviceTransferRequest.status, 'pending')))
      .returning();
    if (!reviewedRequest) {
      return NextResponse.json({ error: 'This request has already been reviewed' }, { status: 400 });
    }
    claimedId = reviewedRequest.id;

    let disabledPushSubscriptions = 0;
    let closedOtherRequests = 0;
    let nextDevice: typeof staffDevice.$inferSelect | null = beforeDevice || null;
    let revokedSessions = 0;
    let sessionRevocation: StaffSessionRevocationResult | null = null;

    if (action === 'approve') {
      const sharedDeviceOwner = await findSharedAttendanceDeviceOwner({
        deviceHash: transfer.deviceHash,
        staffId: transfer.staffId,
      });
      if (sharedDeviceOwner) {
        await writeAuditEvent({
          entityType: 'staff_device_transfer',
          entityId: transfer.id,
          action: 'ALERT',
          before: {
            device: beforeDevice,
            request: transfer,
          },
          after: {
            attemptedStaffId: transfer.staffId,
            linkedDeviceId: sharedDeviceOwner.deviceId,
            linkedStaffId: sharedDeviceOwner.staffId,
            linkedStaffName: sharedDeviceOwner.fullName,
            result: SHARED_ATTENDANCE_DEVICE_RESULT,
          },
          actor: { email: actorEmail, id: user.id },
          reason: 'attendance-device-transfer-shared-device-block',
        });

        await releaseClaim(transfer.id);
        return NextResponse.json({
          error: SHARED_ATTENDANCE_DEVICE_MESSAGE,
          result: SHARED_ATTENDANCE_DEVICE_RESULT,
        }, { status: 409 });
      }

      if (!transfer.clerkSessionId) {
        await writeAuditEvent({
          entityType: 'staff_device_transfer',
          entityId: transfer.id,
          action: 'ALERT',
          before: {
            device: beforeDevice,
            request: transfer,
          },
          after: {
            result: 'TRANSFER_SESSION_REQUIRED',
            staffName: member?.fullName || null,
          },
          actor: { email: actorEmail, id: user.id },
          reason: 'attendance-device-transfer-session-required',
        });

        await releaseClaim(transfer.id);
        return NextResponse.json({
          error: 'The new device login is no longer active. Ask the staff member to sign in on the new device and request transfer again.',
          result: 'TRANSFER_SESSION_REQUIRED',
        }, { status: 409 });
      }

      const oldTrustedSessionId = beforeDevice?.clerkSessionId && beforeDevice.clerkSessionId !== transfer.clerkSessionId
        ? beforeDevice.clerkSessionId
        : null;
      sessionRevocation = oldTrustedSessionId
        ? await revokeStaffLoginSessionById({
          expectedUserId: beforeDevice?.userId || transfer.userId,
          sessionId: oldTrustedSessionId,
        })
        : await revokeStaffLoginSessionsExcept({
          deviceUserId: beforeDevice?.userId || transfer.userId,
          keepSessionId: transfer.clerkSessionId,
          staffEmail: member?.email,
        });
      revokedSessions = sessionRevocation.revokedSessions;
      if (sessionRevocation.status === 'keep_session_not_active') {
        await writeAuditEvent({
          entityType: 'staff_device_transfer',
          entityId: transfer.id,
          action: 'ALERT',
          before: {
            device: beforeDevice,
            request: transfer,
          },
          after: {
            result: 'TRANSFER_SESSION_NOT_ACTIVE',
            sessionRevocation,
            staffName: member?.fullName || null,
          },
          actor: { email: actorEmail, id: user.id },
          reason: 'attendance-device-transfer-session-not-active',
        });

        await releaseClaim(transfer.id);
        return NextResponse.json({
          error: 'The new device login is no longer active. Ask the staff member to sign in on the new device and request transfer again.',
          result: 'TRANSFER_SESSION_NOT_ACTIVE',
          sessionRevocation,
        }, { status: 409 });
      }

      // Requests can come from anywhere: the device counts as verified at the office only when the
      // request's own location reading was.
      const verifiedAtOffice = transfer.verificationResult === 'LOCATION_VERIFIED';
      const deviceValues = {
        clerkSessionId: transfer.clerkSessionId,
        deviceHash: transfer.deviceHash,
        deviceLabel: transfer.deviceLabel,
        lastDistanceMeters: verifiedAtOffice ? transfer.distanceMeters : null,
        lastSeenAt: now,
        lastSeenIp: transfer.networkIp,
        lastVerificationMethod: verifiedAtOffice ? 'office_location_transfer' : 'admin_approved_transfer',
        lastVerifiedAt: verifiedAtOffice ? now : null,
        registeredIp: transfer.networkIp,
        staffId: transfer.staffId,
        updatedAt: now,
        userAgent: transfer.userAgent,
        userId: transfer.userId,
      };

      const [upsertedDevice] = await db.insert(staffDevice)
        .values(deviceValues)
        .onConflictDoUpdate({
          target: staffDevice.staffId,
          set: deviceValues,
        })
        .returning();

      nextDevice = upsertedDevice || nextDevice;
      claimedId = null; // The device has moved; the approval stands even if a later step fails.
      disabledPushSubscriptions = await disableActivePushSubscriptionsForStaff(transfer.staffId, now);

      // The person now has their device: their other pending requests (other phones) are closed.
      const closed = await db.update(deviceTransferRequest)
        .set({ reviewedAt: now, reviewedByEmail: actorEmail, reviewedByUserId: user.id, status: 'rejected', updatedAt: now })
        .where(and(
          eq(deviceTransferRequest.staffId, transfer.staffId),
          eq(deviceTransferRequest.status, 'pending'),
          ne(deviceTransferRequest.id, transfer.id),
        ))
        .returning({ id: deviceTransferRequest.id });
      closedOtherRequests = closed.length;
    }
    claimedId = null;

    await writeAuditEvent({
      entityType: 'staff_device_transfer',
      entityId: transfer.id,
      action: action === 'approve' ? 'APPROVE' : 'REJECT',
      before: {
        device: beforeDevice,
        request: transfer,
      },
      after: {
        closedOtherRequests,
        disabledPushSubscriptions,
        device: nextDevice,
        request: reviewedRequest,
        revokedSessions,
        sessionRevocation,
        staffName: member?.fullName || null,
      },
      actor: { email: actorEmail, id: user.id },
      reason: 'attendance-device-transfer-review',
    });

    publishRealtime('attendance', 'invalidate', { reason: 'attendance-device-transfer-review' });
    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-device-transfer-review' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'attendance-device-transfer-review' });
    publishRealtime('notifications', 'invalidate', { reason: 'attendance-device-transfer-review' });

    return NextResponse.json({
      disabledPushSubscriptions,
      device: nextDevice,
      revokedSessions,
      request: reviewedRequest,
      sessionRevocation,
      success: true,
    });
  } catch (error) {
    // Nothing was approved: put the request back so it can be reviewed again.
    if (claimedId) await releaseClaim(claimedId).catch((releaseError) => console.error('Failed to release transfer review:', releaseError));

    if (isStaffSessionRevocationError(error)) {
      console.error('Failed to revoke old trusted-device login session during device transfer approval:', error);
      return NextResponse.json({
        error: 'Could not revoke the old trusted-device login session. Try again before approving the device transfer.',
        result: 'SESSION_REVOCATION_FAILED',
        revokedSessions: error.revokedSessions,
      }, { status: 502 });
    }

    console.error('Failed to review device transfer:', error);
    return NextResponse.json({ error: 'Failed to review device transfer' }, { status: 500 });
  }
}
