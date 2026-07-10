import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('tsx/cjs');

const {
  computePenalty,
} = require('../src/lib/penalty-calculator.ts');
const {
  formatAbsencePermissionReason,
  getPermissionWindowBounds,
  isPermissionWindowActive,
} = require('../src/lib/attendance-permissions.ts');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const INCIDENT_DATE = '2026-07-09';
const REPAIR_REASON = 'repair-2026-07-09-missed-pardon-reconciliation';
const INVALIDATION_CHANNELS = [
  'entries',
  'attendance',
  'payments',
  'dashboard',
  'audit-trail',
  'notifications',
  'staff-penalty-history',
];

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/repair-2026-07-09-pardons.mjs -- [--apply]');
  console.log('Re-applies approved attendance pardons for 2026-07-09 that never reconciled lateness entries created without a matching attendance_record.');
  console.log('Runs a dry-run by default. Add --apply to write the corrections.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function normalizeTime(value) {
  const time = value?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function amountText(value) {
  return value.toFixed(2);
}

function approvedLateArrivalReason(permission) {
  const window = getPermissionWindowBounds(permission);
  return `Approved late arrival (${window.label}): ${permission.reason}`.trim();
}

function approvedAbsenceReason(permission) {
  return `Excused absence: ${formatAbsencePermissionReason(permission.reason)}`.trim();
}

function resolveNextAttendanceState({ arrivalTime, existingLateness, permission, isNssPersonnel }) {
  const didNotSignOut = existingLateness?.didNotSignOut === true;

  if (permission?.status === 'approved' && permission.permissionType === 'absence') {
    return {
      amount: 0,
      didNotSignOut: false,
      pardoned: true,
      reason: approvedAbsenceReason(permission),
      status: 'excused',
    };
  }

  const permissionClearsLatePenalty = Boolean(
    permission?.status === 'approved' &&
    permission.permissionType === 'late_arrival' &&
    arrivalTime &&
    isPermissionWindowActive(permission, arrivalTime),
  );

  if (permissionClearsLatePenalty && permission) {
    const signOutPenalty = didNotSignOut
      ? computePenalty({ arrivalTime: null, didNotSignOut: true, isNssPersonnel: isNssPersonnel === true, isHoliday: false })
      : { amount: 0, reason: '' };
    const pardonReason = approvedLateArrivalReason(permission);

    return {
      amount: signOutPenalty.amount,
      didNotSignOut,
      pardoned: true,
      reason: signOutPenalty.amount > 0 ? `${signOutPenalty.reason}; ${pardonReason}` : pardonReason,
      status: signOutPenalty.amount > 0 ? 'late' : 'present',
    };
  }

  const penalty = computePenalty({ arrivalTime, didNotSignOut, isNssPersonnel: isNssPersonnel === true, isHoliday: false });

  return {
    amount: penalty.amount,
    didNotSignOut,
    pardoned: false,
    reason: penalty.reason || null,
    status: penalty.amount > 0 ? 'late' : 'present',
  };
}

async function writeAuditEvent({ action, after, before, entityId, entityType }) {
  await sql`
    insert into audit_event (entity_type, entity_id, action, before_json, after_json, actor_user_id, actor_email)
    values (${entityType}, ${entityId}, ${action}, ${before ? JSON.stringify(before) : null}::jsonb, ${after ? JSON.stringify(after) : null}::jsonb, null, 'system')
  `;
}

async function publishInvalidation() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return false;

  const client = new Rest({ key });
  await Promise.all(INVALIDATION_CHANNELS.map((channel) =>
    client.channels.get(`latewatch:${channel}`).publish('invalidate', { reason: REPAIR_REASON })
  ));
  return true;
}

const permissions = await sql`
  select
    ap.id, ap.staff_id as "staffId", s.full_name as "staffName",
    coalesce(s.is_nss_personnel, false) as "isNssPersonnel",
    ap.permission_type as "permissionType", ap.reason, ap.status,
    ap.arrival_window as "arrivalWindow", ap.expected_start_time as "expectedStartTime",
    ap.expected_end_time as "expectedEndTime"
  from attendance_permission ap
  left join staff s on s.id = ap.staff_id
  where ap.date = ${INCIDENT_DATE} and ap.status = 'approved'
  order by s.full_name
`;

console.log(`${applyChanges ? 'Applying' : 'Dry run'} pardon reconciliation for ${INCIDENT_DATE}...`);
console.log(`Approved permissions found: ${permissions.length}`);

let changedCount = 0;

for (const permission of permissions) {
  const [attendance] = await sql`
    select id, check_in_time as "checkInTime", status, computed_amount as "computedAmount", reason
    from attendance_record where staff_id = ${permission.staffId} and date = ${INCIDENT_DATE}
  `;
  const [existingLateness] = await sql`
    select id, arrival_time as "arrivalTime", computed_amount as "computedAmount", reason, did_not_sign_out as "didNotSignOut"
    from lateness_entry where staff_id = ${permission.staffId} and date = ${INCIDENT_DATE}
  `;

  if (!attendance && !existingLateness) continue;

  const arrivalTime = normalizeTime(attendance?.checkInTime) ?? normalizeTime(existingLateness?.arrivalTime);
  const next = resolveNextAttendanceState({
    arrivalTime,
    existingLateness: existingLateness || null,
    permission,
    isNssPersonnel: permission.isNssPersonnel,
  });
  const nextAmount = amountText(next.amount);

  let rowChanged = false;

  if (attendance) {
    const attendanceCurrentAmount = amountText(Number(attendance.computedAmount || 0));
    if (attendance.status !== next.status || attendanceCurrentAmount !== nextAmount || (attendance.reason || null) !== (next.reason || null)) {
      rowChanged = true;
      console.log(`  [attendance] ${permission.staffName}: status ${attendance.status} -> ${next.status}, amount ${attendanceCurrentAmount} -> ${nextAmount}`);
      if (applyChanges) {
        const [updated] = await sql`
          update attendance_record set computed_amount = ${nextAmount}, reason = ${next.reason}, status = ${next.status}, updated_at = now()
          where id = ${attendance.id}
          returning id, staff_id as "staffId", check_in_time as "checkInTime", computed_amount as "computedAmount", reason, status
        `;
        await writeAuditEvent({
          action: 'UPDATE',
          after: { ...updated, permissionReason: REPAIR_REASON, staffName: permission.staffName },
          before: attendance,
          entityId: attendance.id,
          entityType: 'attendance',
        });
      }
    }
  }

  if (next.amount > 0) {
    if (existingLateness) {
      const existingAmount = amountText(Number(existingLateness.computedAmount || 0));
      if (existingAmount !== nextAmount || existingLateness.reason !== next.reason || existingLateness.didNotSignOut !== next.didNotSignOut) {
        rowChanged = true;
        console.log(`  [entry] ${permission.staffName}: amount ${existingAmount} -> ${nextAmount} (${next.reason})`);
        if (applyChanges) {
          const [updated] = await sql`
            update lateness_entry set arrival_time = ${arrivalTime}, computed_amount = ${nextAmount}, did_not_sign_out = ${next.didNotSignOut}, reason = ${next.reason || ''}, updated_at = now()
            where id = ${existingLateness.id}
            returning id, staff_id as "staffId", date, arrival_time as "arrivalTime", computed_amount as "computedAmount", reason, did_not_sign_out as "didNotSignOut"
          `;
          await writeAuditEvent({
            action: 'UPDATE',
            after: { ...updated, permissionReason: REPAIR_REASON, staffName: permission.staffName },
            before: existingLateness,
            entityId: existingLateness.id,
            entityType: 'entry',
          });
        }
      }
    } else {
      rowChanged = true;
      console.log(`  [entry] ${permission.staffName}: create amount ${nextAmount} (${next.reason})`);
      if (applyChanges) {
        const [created] = await sql`
          insert into lateness_entry (staff_id, date, arrival_time, did_not_sign_out, computed_amount, reason, created_at, updated_at)
          values (${permission.staffId}, ${INCIDENT_DATE}, ${arrivalTime}, ${next.didNotSignOut}, ${nextAmount}, ${next.reason || ''}, now(), now())
          returning id, staff_id as "staffId", date, arrival_time as "arrivalTime", computed_amount as "computedAmount", reason, did_not_sign_out as "didNotSignOut"
        `;
        await writeAuditEvent({
          action: 'CREATE',
          after: { ...created, permissionReason: REPAIR_REASON, staffName: permission.staffName },
          before: null,
          entityId: created.id,
          entityType: 'entry',
        });
      }
    }
  } else if (existingLateness) {
    rowChanged = true;
    console.log(`  [entry] ${permission.staffName}: pardoned, deleting entry (was ${amountText(Number(existingLateness.computedAmount || 0))})`);
    if (applyChanges) {
      await sql`delete from lateness_entry where id = ${existingLateness.id}`;
      await writeAuditEvent({
        action: 'DELETE',
        after: null,
        before: { ...existingLateness, permissionReason: REPAIR_REASON, staffName: permission.staffName },
        entityId: existingLateness.id,
        entityType: 'entry',
      });
    }
  }

  if (rowChanged) changedCount += 1;
}

console.log('');
if (changedCount === 0) {
  console.log('Nothing to correct — all approved pardons for this date already reconciled.');
} else if (!applyChanges) {
  console.log(`${changedCount} record(s) would be corrected. Run with --apply to write these changes.`);
} else {
  console.log(`Corrected ${changedCount} record(s) for ${INCIDENT_DATE}.`);
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, payments, dashboard, audit trail, notifications, and staff penalty history.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
