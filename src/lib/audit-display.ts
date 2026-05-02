import {
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditOperation,
} from '@/lib/audit-taxonomy';

export type AuditDisplayPayload = Record<string, unknown> | null;

export interface AuditDisplayRecord {
  action: string;
  actorEmail: string;
  actorUserId?: string | null;
  afterJson: unknown;
  beforeJson: unknown;
  entityId: string;
  entityType: string;
  id: string;
  timestamp?: Date | string | null;
}

export interface AuditFieldChange {
  after: string;
  before: string;
  field: string;
  label: string;
}

const LOW_VALUE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'archived', 'archivedAt']);

function toPayload(value: unknown): AuditDisplayPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function getAuditPayloads(record: Pick<AuditDisplayRecord, 'afterJson' | 'beforeJson'>) {
  return {
    after: toPayload(record.afterJson),
    before: toPayload(record.beforeJson),
  };
}

export function formatAuditFieldLabel(field: string) {
  if (field === 'active') return 'Status';
  if (field === 'archived') return 'Staff Status';
  if (field === 'allowedIp') return 'Office IP';
  if (field === 'alternatePhone') return 'Family Phone';
  if (field === 'contactName') return 'Contact Name';
  if (field === 'networkIp') return 'Network IP';
  if (field === 'phone') return 'Staff Phone';
  if (field === 'staffId') return 'Staff ID';
  if (field === 'staffName') return 'Staff';
  if (field === 'updatedByEmail') return 'Updated By';
  if (field === 'updatedByUserId') return 'Updated By ID';

  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length === 0 ? 'None' : `${value.length} item${value.length === 1 ? '' : 's'}`;

  if (typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    if (typeof payload.fullName === 'string') return payload.fullName;
    if (typeof payload.name === 'string') return payload.name;
    return JSON.stringify(payload);
  }

  return String(value);
}

function formatAuditFieldValue(field: string, value: unknown): string {
  if (field === 'active') {
    if (value === true) return 'Active';
    if (value === false) return 'Inactive';
  }

  if (field === 'archived') {
    if (value === true) return 'Former';
    if (value === false) return 'Current';
  }

  return formatAuditValue(value);
}

export function getAuditTargetName(record: Pick<AuditDisplayRecord, 'afterJson' | 'beforeJson' | 'entityId' | 'entityType'>) {
  const { after, before } = getAuditPayloads(record);
  const payload = after || before;

  if (!payload) return record.entityId;

  if (record.entityType === 'staff') {
    return formatAuditValue(payload.fullName) || record.entityId;
  }

  if (record.entityType === 'entry') {
    const staffValue = payload.staff;
    if (staffValue && typeof staffValue === 'object' && !Array.isArray(staffValue)) {
      const staffPayload = staffValue as Record<string, unknown>;
      if (staffPayload.fullName) return `${formatAuditValue(staffPayload.fullName)} on ${formatAuditValue(payload.date)}`;
    }
    return payload.date ? `Entry on ${formatAuditValue(payload.date)}` : record.entityId;
  }

  if (record.entityType === 'entry_submission') {
    return payload.date ? `Entries for ${formatAuditValue(payload.date)}` : record.entityId;
  }

  if (record.entityType === 'attendance') {
    const staffValue = payload.staff;
    if (staffValue && typeof staffValue === 'object' && !Array.isArray(staffValue)) {
      const staffPayload = staffValue as Record<string, unknown>;
      if (staffPayload.fullName) return `${formatAuditValue(staffPayload.fullName)} on ${formatAuditValue(payload.date)}`;
    }
    return payload.date ? `Check-in for ${formatAuditValue(payload.date)}` : record.entityId;
  }

  if (record.entityType === 'attendance_attempt') {
    return payload.userEmail ? `${formatAuditValue(payload.userEmail)} on ${formatAuditValue(payload.date)}` : record.entityId;
  }

  if (record.entityType === 'emergency_contact') {
    if (payload.contactName) {
      const staffName = formatAuditValue(payload.staffName);
      return staffName && staffName !== '-'
        ? `${formatAuditValue(payload.contactName)} for ${staffName}`
        : formatAuditValue(payload.contactName);
    }
    return formatAuditValue(payload.phone) || record.entityId;
  }

  if (record.entityType === 'calendar') {
    return payload.holidayNote
      ? `${formatAuditValue(payload.holidayNote)} (${formatAuditValue(payload.date)})`
      : formatAuditValue(payload.date) || record.entityId;
  }

  if (record.entityType === 'export') {
    if (payload.weekStart) return `${formatAuditValue(payload.weekStart)} to ${formatAuditValue(payload.weekEnd)}`;
    if (payload.month && payload.year) return `${formatAuditValue(payload.month)}/${formatAuditValue(payload.year)}`;
  }

  if (record.entityType === 'notification') {
    if (payload.action) return formatAuditValue(payload.action);
    if (payload.count) return `${formatAuditValue(payload.count)} notification${Number(payload.count) === 1 ? '' : 's'}`;
  }

  if (record.entityType === 'office_network') {
    const name = formatAuditValue(payload.name) || 'Office WiFi';
    const ip = formatAuditValue(payload.allowedIp);
    return ip && ip !== '-' ? `${name} (${ip})` : name;
  }

  return record.entityId;
}

export function getAuditSummary(record: Pick<AuditDisplayRecord, 'action' | 'afterJson' | 'beforeJson' | 'entityId' | 'entityType'>) {
  const { after, before } = getAuditPayloads(record);
  const operation = getAuditOperation(record.action, record.entityType, before, after);
  const target = getAuditTargetName(record);

  if (operation === 'CREATE') return `Created ${getAuditEntityLabel(record.entityType).toLowerCase()} "${target}"`;
  if (operation === 'UPDATE') return `Updated ${getAuditEntityLabel(record.entityType).toLowerCase()} "${target}"`;
  if (operation === 'DELETE') return `Deleted ${getAuditEntityLabel(record.entityType).toLowerCase()} "${target}"`;
  if (operation === 'ACTIVATE') return `Activated "${target}"`;
  if (operation === 'DEACTIVATE') return `Deactivated "${target}"`;
  if (operation === 'ARCHIVE') return `Archived "${target}" as former staff`;
  if (operation === 'RESTORE') return `Restored "${target}" to active staff`;
  if (operation === 'GENERATE') return `Generated ${getAuditEntityLabel(record.entityType).toLowerCase()} "${target}"`;
  if (operation === 'SYNC') {
    const added = Number(after?.totalAdded || 0);
    const updated = Number(after?.totalUpdated || 0);
    const skipped = Number(after?.totalSkipped || 0);
    return `Synced holidays: ${added} added, ${updated} updated, ${skipped} skipped`;
  }
  if (record.entityType === 'notification') {
    const count = Number(after?.count || 0);
    return count > 0 ? `${getAuditActionLabel(operation)} ${count} notification${count === 1 ? '' : 's'}` : 'Notification state changed';
  }

  return `${getAuditActionLabel(operation)} ${getAuditEntityLabel(record.entityType).toLowerCase()}`;
}

export function getAuditFieldChanges(record: Pick<AuditDisplayRecord, 'afterJson' | 'beforeJson'>): AuditFieldChange[] {
  const { after, before } = getAuditPayloads(record);
  if (!before || !after) return [];

  if (typeof before.archived === 'boolean' && typeof after.archived === 'boolean' && before.archived !== after.archived) {
    return [{
      field: 'archived',
      label: 'Staff Status',
      before: formatAuditFieldValue('archived', before.archived),
      after: formatAuditFieldValue('archived', after.archived),
    }];
  }

  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => !LOW_VALUE_FIELDS.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      label: formatAuditFieldLabel(field),
      before: formatAuditFieldValue(field, before[field]),
      after: formatAuditFieldValue(field, after[field]),
    }));
}

export function getAuditRecordedValues(record: Pick<AuditDisplayRecord, 'afterJson' | 'beforeJson'>) {
  const { after, before } = getAuditPayloads(record);
  const payload = after || before;
  if (!payload) return [];

  return Object.entries(payload)
    .filter(([field]) => !LOW_VALUE_FIELDS.has(field))
    .slice(0, 8)
    .map(([field, value]) => ({
      field,
      label: formatAuditFieldLabel(field),
      value: formatAuditFieldValue(field, value),
    }));
}

export function getAuditActivityLabel(record: Pick<AuditDisplayRecord, 'action' | 'afterJson' | 'beforeJson' | 'entityType'>) {
  const { after, before } = getAuditPayloads(record);
  const operation = getAuditOperation(record.action, record.entityType, before, after);
  return getAuditActionLabel(operation);
}
