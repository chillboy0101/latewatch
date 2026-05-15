import { currentUser } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { staffDevice } from '@/db/schema';
import { getOrAutoLinkStaffByEmail, resolveClientIpInfo } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import { syncStaffEmailIdentity } from '@/lib/clerk-organization';
import { getDeviceTokenFromRequest, hashDeviceToken } from '@/lib/device-binding';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

function getUserFullName(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  return user.fullName
    || [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || null;
}

function getUserEmailAddresses(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const emails = [
    user.primaryEmailAddress?.emailAddress,
    ...user.emailAddresses.map((emailAddress) => emailAddress.emailAddress),
  ]
    .map((email) => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  return Array.from(new Set(emails));
}

async function resolveMemberForAutoSettings(input: {
  actorEmail: string;
  actorId: string;
  candidateEmails?: string[];
  fullName: string | null;
}) {
  const candidateEmails = Array.from(new Set([
    input.actorEmail,
    ...(input.candidateEmails || []),
  ].filter((email) => email && email !== 'unknown')));

  for (const email of candidateEmails) {
    const resolved = await getOrAutoLinkStaffByEmail({
      email,
      fullName: input.fullName,
    });

    if (!resolved.member) continue;

    if (resolved.autoLinked && resolved.before) {
      await writeAuditEvent({
        entityType: 'staff',
        entityId: resolved.member.id,
        action: 'UPDATE',
        before: resolved.before,
        after: {
          ...resolved.member,
          autoLinkedFromAttendance: true,
          matchedLoginEmail: email,
        },
        actor: { email: input.actorEmail, id: input.actorId },
        reason: 'attendance-auto-link',
      });

      await syncStaffEmailIdentity({
        actorUserId: input.actorId,
        email,
        staffId: resolved.member.id,
        staffName: resolved.member.fullName,
      });
    }

    return resolved.member;
  }

  return null;
}

function serializeDevice(device: typeof staffDevice.$inferSelect) {
  return {
    autoCheckInEnabled: Boolean(device.autoCheckInEnabled),
    autoSignOutEnabled: Boolean(device.autoSignOutEnabled),
    lastSeenAt: device.lastSeenAt,
    registered: true,
    registeredAt: device.registeredAt,
    trusted: true,
  };
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body?.autoCheckInEnabled !== 'boolean' || typeof body?.autoSignOutEnabled !== 'boolean') {
      return NextResponse.json({ error: 'Auto attendance settings must be true or false.' }, { status: 400 });
    }

    const actorEmails = getUserEmailAddresses(user);
    const actorEmail = actorEmails[0] || 'unknown';
    if (actorEmail === 'unknown') {
      return NextResponse.json({ error: 'Your login account does not have an email address.' }, { status: 403 });
    }

    const deviceToken = getDeviceTokenFromRequest(request, body);
    if (!deviceToken) {
      return NextResponse.json({ error: 'Trusted attendance device is required.' }, { status: 403 });
    }
    const trustedDeviceHash = hashDeviceToken(deviceToken);
    const currentIpInfo = await resolveClientIpInfo(request);
    const member = await resolveMemberForAutoSettings({
      actorEmail,
      actorId: user.id,
      candidateEmails: actorEmails,
      fullName: getUserFullName(user),
    });

    if (!member) {
      return NextResponse.json({ error: 'Your login could not be matched to an active staff profile.' }, { status: 403 });
    }

    const [device] = await db.select()
      .from(staffDevice)
      .where(and(
        eq(staffDevice.staffId, member.id),
        eq(staffDevice.deviceHash, trustedDeviceHash),
      ))
      .limit(1);

    if (!device) {
      return NextResponse.json({ error: 'Use your trusted attendance device to change auto settings.' }, { status: 403 });
    }

    const [updatedDevice] = await db.update(staffDevice)
      .set({
        autoCheckInEnabled: body.autoCheckInEnabled,
        autoSignOutEnabled: body.autoSignOutEnabled,
        lastSeenAt: new Date(),
        lastSeenIp: currentIpInfo.ip,
        updatedAt: new Date(),
        userId: user.id,
      })
      .where(eq(staffDevice.id, device.id))
      .returning();
    const changedDevice = updatedDevice || device;

    await writeAuditEvent({
      entityType: 'staff_device',
      entityId: device.id,
      action: 'UPDATE',
      before: {
        autoCheckInEnabled: device.autoCheckInEnabled,
        autoSignOutEnabled: device.autoSignOutEnabled,
        staffId: member.id,
      },
      after: {
        autoCheckInEnabled: changedDevice.autoCheckInEnabled,
        autoSignOutEnabled: changedDevice.autoSignOutEnabled,
        networkIp: currentIpInfo.ip,
        staffId: member.id,
        staffName: member.fullName,
      },
      actor: { email: actorEmail, id: user.id },
      reason: 'auto-attendance-settings',
    });

    publishRealtime('attendance', 'invalidate', { reason: 'auto-attendance-settings' });
    publishRealtime('audit-trail', 'invalidate', { reason: 'auto-attendance-settings' });

    return NextResponse.json({
      device: serializeDevice(changedDevice),
      success: true,
    });
  } catch (error) {
    console.error('Failed to update auto attendance settings:', error);
    return NextResponse.json({ error: 'Failed to update auto attendance settings' }, { status: 500 });
  }
}
