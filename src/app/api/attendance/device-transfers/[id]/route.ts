import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    let disabledPushSubscriptions = 0;
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

        return NextResponse.json({
          error: 'The new device login is no longer active. Ask the staff member to sign in on the new device and request transfer again.',
          result: 'TRANSFER_SESSION_NOT_ACTIVE',
          sessionRevocation,
        }, { status: 409 });
      }

      const deviceValues = {
        clerkSessionId: transfer.clerkSessionId,
        deviceHash: transfer.deviceHash,
        deviceLabel: transfer.deviceLabel,
        lastDistanceMeters: transfer.distanceMeters,
        lastSeenAt: now,
        lastSeenIp: transfer.networkIp,
        lastVerificationMethod: 'office_location_transfer',
        lastVerifiedAt: now,
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
      disabledPushSubscriptions = await disableActivePushSubscriptionsForStaff(transfer.staffId, now);
    }

    const [reviewedRequest] = await db.update(deviceTransferRequest)
      .set({
        reviewedAt: now,
        reviewedByEmail: actorEmail,
        reviewedByUserId: user.id,
        status: action === 'approve' ? 'approved' : 'rejected',
        updatedAt: now,
      })
      .where(eq(deviceTransferRequest.id, transfer.id))
      .returning();

    await writeAuditEvent({
      entityType: 'staff_device_transfer',
      entityId: transfer.id,
      action: action === 'approve' ? 'APPROVE' : 'REJECT',
      before: {
        device: beforeDevice,
        request: transfer,
      },
      after: {
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
