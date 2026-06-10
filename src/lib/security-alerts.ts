import 'server-only';

import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { auditEvent, staff } from '@/db/schema';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function severityFor(input: { entityType: string; result: string | null }) {
  if (input.result === 'SHARED_ATTENDANCE_DEVICE') return 'critical';
  if (input.entityType === 'staff_device_transfer' && input.result?.startsWith('TRANSFER_SESSION')) return 'high';
  if (input.result === 'REGISTERED_DEVICE_REQUIRED') return 'high';
  if (input.result?.includes('LOCATION') || input.result?.includes('OFFICE')) return 'medium';
  return 'medium';
}

function titleFor(input: { entityType: string; result: string | null }) {
  if (input.result === 'SHARED_ATTENDANCE_DEVICE') return 'Shared device blocked';
  if (input.result === 'REGISTERED_DEVICE_REQUIRED') return 'Untrusted device blocked';
  if (input.result === 'TRANSFER_SESSION_REQUIRED') return 'Transfer approval blocked';
  if (input.result === 'TRANSFER_SESSION_NOT_ACTIVE') return 'Transfer session expired';
  if (input.entityType === 'attendance_attempt') return 'Attendance attempt blocked';
  return 'Security alert';
}

function messageFor(after: JsonRecord | null, result: string | null) {
  const attemptedName = stringValue(after?.attemptedStaffName);
  const linkedName = stringValue(after?.linkedStaffName);
  const userEmail = stringValue(after?.userEmail);

  if (result === 'SHARED_ATTENDANCE_DEVICE') {
    return linkedName && attemptedName
      ? `${attemptedName} tried to use a browser already linked to ${linkedName}.`
      : 'A browser already linked to another staff account was blocked.';
  }

  if (result === 'REGISTERED_DEVICE_REQUIRED') {
    return `${userEmail || 'A staff user'} tried to use an untrusted attendance device.`;
  }

  if (result?.startsWith('TRANSFER_SESSION')) {
    return 'A device transfer approval was stopped because the new trusted login session could not be verified.';
  }

  return `${userEmail || attemptedName || 'A staff user'} was blocked: ${String(result || 'review required').replace(/_/g, ' ').toLowerCase()}.`;
}

export async function getSecurityAlerts() {
  const events = await db.select({
    action: auditEvent.action,
    actorEmail: auditEvent.actorEmail,
    afterJson: auditEvent.afterJson,
    beforeJson: auditEvent.beforeJson,
    entityId: auditEvent.entityId,
    entityType: auditEvent.entityType,
    id: auditEvent.id,
    timestamp: auditEvent.timestamp,
  })
    .from(auditEvent)
    .where(eq(auditEvent.action, 'ALERT'))
    .orderBy(desc(auditEvent.timestamp))
    .limit(150);

  const alertStaffIds = Array.from(new Set(events.map((event) => {
    const after = asRecord(event.afterJson);
    return stringValue(after?.staffId)
      || stringValue(after?.attemptedStaffId)
      || (event.entityType === 'staff_device' ? event.entityId : '');
  }).filter(Boolean)));

  const staffRows = alertStaffIds.length > 0
    ? await db.select({
        fullName: staff.fullName,
        id: staff.id,
      })
        .from(staff)
        .where(inArray(staff.id, alertStaffIds))
    : [];

  const staffNameById = new Map(staffRows.map((member) => [member.id, member.fullName]));
  const now = Date.now();
  const rows = events.map((event) => {
    const after = asRecord(event.afterJson);
    const staffId = stringValue(after?.staffId)
      || stringValue(after?.attemptedStaffId)
      || (event.entityType === 'staff_device' ? event.entityId : null);
    const result = stringValue(after?.result);
    const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
    const severity = severityFor({ entityType: event.entityType, result });

    return {
      actorEmail: event.actorEmail,
      createdAt: timestamp.toISOString(),
      entityId: event.entityId,
      entityType: event.entityType,
      id: event.id,
      message: messageFor(after, result),
      result,
      severity,
      staffId,
      staffName: staffId ? staffNameById.get(staffId) || stringValue(after?.attemptedStaffName) : stringValue(after?.attemptedStaffName),
      title: titleFor({ entityType: event.entityType, result }),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      critical: rows.filter((row) => row.severity === 'critical').length,
      high: rows.filter((row) => row.severity === 'high').length,
      last24Hours: rows.filter((row) => now - new Date(row.createdAt).getTime() <= 24 * 60 * 60 * 1000).length,
      total: rows.length,
    },
  };
}
