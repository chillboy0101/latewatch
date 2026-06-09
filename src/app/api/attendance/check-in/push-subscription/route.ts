import { currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscription, staffDevice } from '@/db/schema';
import { getOrAutoLinkStaffByEmail } from '@/lib/attendance';
import { getDeviceTokenFromRequest, hashDeviceToken } from '@/lib/device-binding';
import { getVapidPublicKey, hasVapidConfig } from '@/lib/push-reminders';

export const dynamic = 'force-dynamic';
const UNTRUSTED_REMINDER_DEVICE_ERROR = 'Transfer this device before changing reminder notifications.';

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

function publicPayload(subscription: typeof pushSubscription.$inferSelect | null) {
  return {
    configured: hasVapidConfig(),
    publicKey: getVapidPublicKey(),
    subscription: subscription
      ? {
          disabledAt: subscription.disabledAt,
          endpoint: subscription.endpoint,
          signInEnabled: subscription.signInEnabled,
          signOutEnabled: subscription.signOutEnabled,
        }
      : null,
  };
}

async function getActivePushSubscription(staffId: string, userId: string) {
  const [subscription] = await db.select()
    .from(pushSubscription)
    .where(and(
      eq(pushSubscription.staffId, staffId),
      eq(pushSubscription.userId, userId),
      isNull(pushSubscription.disabledAt),
    ))
    .orderBy(desc(pushSubscription.updatedAt))
    .limit(1);

  return subscription || null;
}

async function requireTrustedAttendanceDevice(
  request: NextRequest,
  staffId: string,
  body?: Record<string, unknown>,
) {
  const deviceToken = getDeviceTokenFromRequest(request, body);
  if (!deviceToken) {
    return NextResponse.json({ error: UNTRUSTED_REMINDER_DEVICE_ERROR }, { status: 403 });
  }

  const deviceHash = hashDeviceToken(deviceToken);
  const [device] = await db.select()
    .from(staffDevice)
    .where(eq(staffDevice.staffId, staffId))
    .limit(1);

  if (!device || device.deviceHash !== deviceHash) {
    return NextResponse.json({ error: UNTRUSTED_REMINDER_DEVICE_ERROR }, { status: 403 });
  }

  return null;
}

async function disableOtherActivePushSubscriptions(input: {
  endpoint: string;
  staffId: string;
  userId: string;
  now: Date;
}) {
  const disabledRows = await db.update(pushSubscription)
    .set({
      disabledAt: input.now,
      signInEnabled: false,
      signOutEnabled: false,
      updatedAt: input.now,
    })
    .where(and(
      eq(pushSubscription.staffId, input.staffId),
      eq(pushSubscription.userId, input.userId),
      isNull(pushSubscription.disabledAt),
      ne(pushSubscription.endpoint, input.endpoint),
    ))
    .returning({ id: pushSubscription.id });

  return disabledRows.length;
}

async function resolveStaffForPush() {
  const user = await currentUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), staffMember: null, user: null };
  }

  const emails = getUserEmailAddresses(user);
  const email = emails[0] || null;
  if (!email) {
    return { error: NextResponse.json({ error: 'Signed-in email is required' }, { status: 400 }), staffMember: null, user };
  }

  for (const candidateEmail of emails) {
    const resolved = await getOrAutoLinkStaffByEmail({
      email: candidateEmail,
      fullName: getUserFullName(user),
    });

    if (resolved.member) {
      return { error: null, staffMember: resolved.member, user };
    }
  }

  return { error: NextResponse.json({ error: 'Active staff profile required' }, { status: 404 }), staffMember: null, user };
}

export async function GET() {
  const resolved = await resolveStaffForPush();
  if (resolved.error) return resolved.error;

  const subscription = await getActivePushSubscription(resolved.staffMember.id, resolved.user.id);

  return NextResponse.json(publicPayload(subscription || null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveStaffForPush();
  if (resolved.error) return resolved.error;

  const body = await request.json().catch(() => ({}));
  const trustedDeviceError = await requireTrustedAttendanceDevice(request, resolved.staffMember.id, body);
  if (trustedDeviceError) return trustedDeviceError;

  const browserSubscription = body?.subscription;
  const endpoint = typeof browserSubscription?.endpoint === 'string' ? browserSubscription.endpoint : '';
  const p256dh = typeof browserSubscription?.keys?.p256dh === 'string' ? browserSubscription.keys.p256dh : '';
  const auth = typeof browserSubscription?.keys?.auth === 'string' ? browserSubscription.keys.auth : '';

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'A valid push subscription is required' }, { status: 400 });
  }

  const now = new Date();
  await disableOtherActivePushSubscriptions({
    endpoint,
    now,
    staffId: resolved.staffMember.id,
    userId: resolved.user.id,
  });

  const values = {
    auth,
    disabledAt: null,
    endpoint,
    p256dh,
    signInEnabled: body?.signInEnabled !== false,
    signOutEnabled: body?.signOutEnabled !== false,
    staffId: resolved.staffMember.id,
    updatedAt: now,
    userAgent: request.headers.get('user-agent'),
    userId: resolved.user.id,
  };

  const [savedSubscription] = await db.insert(pushSubscription)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: values,
    })
    .returning();

  return NextResponse.json(publicPayload(savedSubscription || null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest) {
  const resolved = await resolveStaffForPush();
  if (resolved.error) return resolved.error;

  const body = await request.json().catch(() => ({}));
  const trustedDeviceError = await requireTrustedAttendanceDevice(request, resolved.staffMember.id, body);
  if (trustedDeviceError) return trustedDeviceError;

  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
  const now = new Date();

  await db.update(pushSubscription)
    .set({
      disabledAt: now,
      signInEnabled: false,
      signOutEnabled: false,
      updatedAt: now,
    })
    .where(and(
      eq(pushSubscription.staffId, resolved.staffMember.id),
      eq(pushSubscription.userId, resolved.user.id),
      endpoint ? eq(pushSubscription.endpoint, endpoint) : isNull(pushSubscription.disabledAt),
    ));

  return NextResponse.json(publicPayload(null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
