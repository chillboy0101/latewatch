export type AuditPayloadLike = Record<string, unknown> | null | undefined;

export const CANONICAL_AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'GENERATE',
  'SYNC',
  'ACTIVATE',
  'DEACTIVATE',
  'ARCHIVE',
  'RESTORE',
  'DISMISS',
  'ALERT',
] as const;

export type CanonicalAuditAction = typeof CANONICAL_AUDIT_ACTIONS[number];

const ACTION_ALIASES: Record<string, CanonicalAuditAction> = {
  EXPORT: 'GENERATE',
};

const ACTION_LABELS: Record<CanonicalAuditAction, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  GENERATE: 'Generated',
  SYNC: 'Synced',
  ACTIVATE: 'Activated',
  DEACTIVATE: 'Deactivated',
  ARCHIVE: 'Archived',
  RESTORE: 'Restored',
  DISMISS: 'Dismissed',
  ALERT: 'Alert',
};

const ENTITY_LABELS: Record<string, string> = {
  attendance: 'Attendance Check-In',
  attendance_attempt: 'Attendance Attempt',
  attendance_general_pardon: 'Attendance General Pardon',
  attendance_permission: 'Attendance Permission',
  calendar: 'Holiday Calendar',
  emergency_contact: 'Emergency Contact',
  entry: 'Lateness Entry',
  entry_submission: 'Daily Entry Submission',
  export: 'Report Export',
  notification: 'Notification',
  office_network: 'Office Network',
  staff: 'Staff Member',
  staff_device: 'Staff Device',
  system: 'System',
};

function toPayload(value: unknown): AuditPayloadLike {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeAuditAction(action: string): CanonicalAuditAction | string {
  const upperAction = action.trim().toUpperCase();
  return ACTION_ALIASES[upperAction] || upperAction;
}

export function getAuditOperation(
  action: string,
  entityType?: string,
  before?: unknown,
  after?: unknown,
): CanonicalAuditAction | string {
  const normalizedAction = normalizeAuditAction(action);
  const beforePayload = toPayload(before);
  const afterPayload = toPayload(after);

  if (entityType === 'staff') {
    if (
      normalizedAction === 'UPDATE' &&
      typeof beforePayload?.archived === 'boolean' &&
      typeof afterPayload?.archived === 'boolean' &&
      beforePayload.archived !== afterPayload.archived
    ) {
      return afterPayload.archived ? 'ARCHIVE' : 'RESTORE';
    }

    if (
      normalizedAction === 'UPDATE' &&
      typeof beforePayload?.active === 'boolean' &&
      typeof afterPayload?.active === 'boolean' &&
      beforePayload.active !== afterPayload.active
    ) {
      return afterPayload.active ? 'ACTIVATE' : 'DEACTIVATE';
    }
  }

  return normalizedAction;
}

export function getAuditActionLabel(action: string) {
  const normalizedAction = normalizeAuditAction(action);
  if (normalizedAction in ACTION_LABELS) {
    return ACTION_LABELS[normalizedAction as CanonicalAuditAction];
  }

  return normalizedAction
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getAuditEntityLabel(entityType: string) {
  return ENTITY_LABELS[entityType] || entityType;
}

export function getAuditActionAliases(action: string) {
  const normalizedAction = normalizeAuditAction(action);

  if (normalizedAction === 'GENERATE') {
    return ['GENERATE', 'EXPORT'];
  }

  return [normalizedAction];
}
