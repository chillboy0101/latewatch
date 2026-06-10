import 'server-only';

import { and, asc, desc, inArray, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditEvent, deviceTransferRequest, pushSubscription, staff, staffDevice } from '@/db/schema';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nestedRecord(value: JsonRecord | null, key: string) {
  return asRecord(value?.[key]);
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function auditMatchesStaff(event: { afterJson: unknown; beforeJson: unknown; entityId: string; entityType: string }, staffId: string) {
  if (event.entityType === 'staff_device' && event.entityId === staffId) return true;

  const after = asRecord(event.afterJson);
  const before = asRecord(event.beforeJson);
  const afterRequest = nestedRecord(after, 'request');
  const beforeRequest = nestedRecord(before, 'request');

  return after?.staffId === staffId
    || before?.staffId === staffId
    || after?.attemptedStaffId === staffId
    || before?.attemptedStaffId === staffId
    || afterRequest?.staffId === staffId
    || beforeRequest?.staffId === staffId;
}

function revokedSessionsFromAudit(event: { afterJson: unknown } | null) {
  const after = asRecord(event?.afterJson);
  return numberValue(after?.revokedSessions);
}

export async function getDeviceSessionHealth() {
  const staffRows = await db.select({
    department: staff.department,
    email: staff.email,
    fullName: staff.fullName,
    id: staff.id,
    isAttendanceOnly: staff.isAttendanceOnly,
    unit: staff.unit,
  })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.archived, false)))
    .orderBy(asc(staff.displayOrder), asc(staff.fullName));

  const staffIds = staffRows.map((member) => member.id);
  if (staffIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      rows: [],
      summary: {
        activeReminderDevices: 0,
        attention: 0,
        pendingTransfers: 0,
        registeredDevices: 0,
        sessionTrackedDevices: 0,
        staff: 0,
      },
    };
  }

  const [deviceRows, subscriptionRows, transferRows, auditRows] = await Promise.all([
    db.select({
      clerkSessionId: staffDevice.clerkSessionId,
      deviceLabel: staffDevice.deviceLabel,
      id: staffDevice.id,
      lastDistanceMeters: staffDevice.lastDistanceMeters,
      lastSeenAt: staffDevice.lastSeenAt,
      lastVerificationMethod: staffDevice.lastVerificationMethod,
      lastVerifiedAt: staffDevice.lastVerifiedAt,
      registeredAt: staffDevice.registeredAt,
      staffId: staffDevice.staffId,
      updatedAt: staffDevice.updatedAt,
    })
      .from(staffDevice)
      .where(inArray(staffDevice.staffId, staffIds)),
    db.select({
      disabledAt: pushSubscription.disabledAt,
      id: pushSubscription.id,
      signInEnabled: pushSubscription.signInEnabled,
      signOutEnabled: pushSubscription.signOutEnabled,
      staffId: pushSubscription.staffId,
      updatedAt: pushSubscription.updatedAt,
      userAgent: pushSubscription.userAgent,
    })
      .from(pushSubscription)
      .where(inArray(pushSubscription.staffId, staffIds)),
    db.select({
      id: deviceTransferRequest.id,
      requestedAt: deviceTransferRequest.requestedAt,
      reviewedAt: deviceTransferRequest.reviewedAt,
      staffId: deviceTransferRequest.staffId,
      status: deviceTransferRequest.status,
      userEmail: deviceTransferRequest.userEmail,
    })
      .from(deviceTransferRequest)
      .where(inArray(deviceTransferRequest.staffId, staffIds))
      .orderBy(desc(deviceTransferRequest.requestedAt)),
    db.select({
      action: auditEvent.action,
      afterJson: auditEvent.afterJson,
      beforeJson: auditEvent.beforeJson,
      entityId: auditEvent.entityId,
      entityType: auditEvent.entityType,
      reason: auditEvent.action,
      timestamp: auditEvent.timestamp,
    })
      .from(auditEvent)
      .where(inArray(auditEvent.entityType, ['staff_device', 'staff_device_transfer']))
      .orderBy(desc(auditEvent.timestamp))
      .limit(400),
  ]);

  const deviceByStaffId = new Map(deviceRows.map((device) => [device.staffId, device]));
  const subscriptionsByStaffId = new Map<string, typeof subscriptionRows>();
  const transfersByStaffId = new Map<string, typeof transferRows>();
  const auditsByStaffId = new Map<string, typeof auditRows>();

  for (const subscription of subscriptionRows) {
    const list = subscriptionsByStaffId.get(subscription.staffId) || [];
    list.push(subscription);
    subscriptionsByStaffId.set(subscription.staffId, list);
  }

  for (const transfer of transferRows) {
    const list = transfersByStaffId.get(transfer.staffId) || [];
    list.push(transfer);
    transfersByStaffId.set(transfer.staffId, list);
  }

  for (const member of staffRows) {
    auditsByStaffId.set(member.id, auditRows.filter((event) => auditMatchesStaff(event, member.id)));
  }

  const rows = staffRows.map((member) => {
    const device = deviceByStaffId.get(member.id) || null;
    const subscriptions = subscriptionsByStaffId.get(member.id) || [];
    const activeSubscriptions = subscriptions.filter((subscription) => !subscription.disabledAt);
    const disabledSubscriptions = subscriptions.filter((subscription) => subscription.disabledAt);
    const transfers = transfersByStaffId.get(member.id) || [];
    const pendingTransfers = transfers.filter((transfer) => transfer.status === 'pending');
    const latestTransfer = transfers[0] || null;
    const audits = auditsByStaffId.get(member.id) || [];
    const latestReset = audits.find((event) => event.entityType === 'staff_device' && event.action === 'DELETE') || null;
    const latestTransferReview = audits.find((event) => event.entityType === 'staff_device_transfer' && ['APPROVE', 'REJECT'].includes(event.action)) || null;
    const latestAlert = audits.find((event) => event.action === 'ALERT') || null;
    const sessionTracked = Boolean(device?.clerkSessionId);

    const attentionReasons: string[] = [];
    if (!device) attentionReasons.push('No trusted attendance device');
    if (device && !sessionTracked) attentionReasons.push('Trusted device has no stored Clerk session');
    if (pendingTransfers.length > 0) attentionReasons.push('Device transfer pending');
    if (activeSubscriptions.length > 1) attentionReasons.push('Multiple active reminder devices');
    if (latestAlert) attentionReasons.push('Recent device security alert');

    return {
      attention: attentionReasons.length > 0,
      attentionReasons,
      reminders: {
        activeSubscriptions: activeSubscriptions.length,
        disabledSubscriptions: disabledSubscriptions.length,
        lastUpdatedAt: isoDate(subscriptions.map((subscription) => subscription.updatedAt).sort((a, b) => Number(new Date(String(b))) - Number(new Date(String(a))))[0]),
        signInEnabled: activeSubscriptions.filter((subscription) => subscription.signInEnabled).length,
        signOutEnabled: activeSubscriptions.filter((subscription) => subscription.signOutEnabled).length,
      },
      security: {
        latestAlertAt: isoDate(latestAlert?.timestamp),
        latestResetAt: isoDate(latestReset?.timestamp),
        latestTransferReviewAt: isoDate(latestTransferReview?.timestamp),
        revokedSessions: revokedSessionsFromAudit(latestReset) + revokedSessionsFromAudit(latestTransferReview),
      },
      staff: member,
      transfer: {
        latestRequestedAt: isoDate(latestTransfer?.requestedAt),
        latestReviewedAt: isoDate(latestTransfer?.reviewedAt),
        latestStatus: latestTransfer?.status || null,
        pending: pendingTransfers.length,
        requestedByEmail: latestTransfer?.userEmail || null,
      },
      trustedDevice: device
        ? {
            deviceLabel: device.deviceLabel,
            id: device.id,
            lastDistanceMeters: device.lastDistanceMeters,
            lastSeenAt: isoDate(device.lastSeenAt),
            lastVerificationMethod: device.lastVerificationMethod,
            lastVerifiedAt: isoDate(device.lastVerifiedAt),
            registered: true,
            registeredAt: isoDate(device.registeredAt),
            sessionTracked,
            updatedAt: isoDate(device.updatedAt),
          }
        : {
            deviceLabel: null,
            id: null,
            lastDistanceMeters: null,
            lastSeenAt: null,
            lastVerificationMethod: null,
            lastVerifiedAt: null,
            registered: false,
            registeredAt: null,
            sessionTracked: false,
            updatedAt: null,
          },
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      activeReminderDevices: rows.reduce((total, row) => total + row.reminders.activeSubscriptions, 0),
      attention: rows.filter((row) => row.attention).length,
      pendingTransfers: rows.reduce((total, row) => total + row.transfer.pending, 0),
      registeredDevices: rows.filter((row) => row.trustedDevice.registered).length,
      sessionTrackedDevices: rows.filter((row) => row.trustedDevice.sessionTracked).length,
      staff: rows.length,
    },
  };
}
