import { neon } from '@neondatabase/serverless';
import { Rest } from 'ably';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('tsx/cjs');

const {
  planStaffPenaltyRecalculation,
} = require('../src/lib/staff-penalty-recalculation.ts');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const INCIDENT_DATE = '2026-07-06';
const SIGN_OUT_TIME = '16:30';
const REPAIR_REASON = 'system-blocked-sign-out-2026-07-06-manual-sign-out';
const INVALIDATION_CHANNELS = [
  'entries',
  'attendance',
  'payments',
  'dashboard',
  'audit-trail',
  'notifications',
];

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/repair-2026-07-06-sign-out.mjs -- [--apply]');
  console.log('Sets an actual 4:30pm sign-out for staff who checked in on 2026-07-06 but were blocked from signing out.');
  console.log('Runs a dry-run by default. Add --apply to write the sign-out times.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function getCurrentAccraClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Africa/Accra',
    year: 'numeric',
  }).formatToParts(new Date());
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || '00';
  const hour = valueFor('hour') === '24' ? '00' : valueFor('hour');

  return {
    dateKey: `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`,
    timeKey: `${hour}:${valueFor('minute')}`,
  };
}

async function writeAuditEvent({ action, after, before, entityId, entityType }) {
  await sql`
    insert into audit_event (
      entity_type,
      entity_id,
      action,
      before_json,
      after_json,
      actor_user_id,
      actor_email
    ) values (
      ${entityType},
      ${entityId},
      ${action},
      ${before ? JSON.stringify(before) : null}::jsonb,
      ${after ? JSON.stringify(after) : null}::jsonb,
      null,
      'system'
    )
  `;
}

async function publishInvalidation() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return false;

  const client = new Rest({ key });
  await Promise.all(INVALIDATION_CHANNELS.map((channel) =>
    client.channels.get(`latewatch:${channel}`).publish('invalidate', {
      reason: REPAIR_REASON,
    })
  ));
  return true;
}

async function fetchUnsignedOutRows() {
  return sql`
    select
      ar.id,
      ar.staff_id as "staffId",
      s.full_name as "staffName",
      coalesce(s.is_attendance_only, false) as "isAttendanceOnly",
      coalesce(s.is_nss_personnel, false) as "isNssPersonnel",
      ar.check_in_time as "checkInTime",
      ar.sign_out_time as "signOutTime",
      ar.computed_amount as "computedAmount",
      ar.reason,
      ar.status,
      ar.no_sign_out_waived as "noSignOutWaived"
    from attendance_record ar
    left join staff s on s.id = ar.staff_id
    where
      ar.date = ${INCIDENT_DATE}
      and ar.check_in_time is not null
      and ar.sign_out_time is null
  `;
}

async function fetchStaffLatenessRow(staffId) {
  const rows = await sql`
    select
      id,
      staff_id as "staffId",
      date,
      arrival_time as "arrivalTime",
      did_not_sign_out as "didNotSignOut",
      computed_amount as "computedAmount",
      reason
    from lateness_entry
    where staff_id = ${staffId} and date = ${INCIDENT_DATE}
  `;
  return rows;
}

async function fetchStaffPermissionRow(staffId) {
  const rows = await sql`
    select
      date,
      arrival_window as "arrivalWindow",
      expected_end_time as "expectedEndTime",
      expected_start_time as "expectedStartTime",
      permission_type as "permissionType",
      reason,
      status
    from attendance_permission
    where staff_id = ${staffId} and date = ${INCIDENT_DATE}
  `;
  return rows;
}

async function applyPlanForRow({ latenessRows, plan, row }) {
  const now = new Date();
  const signOutAt = new Date(`${INCIDENT_DATE}T${SIGN_OUT_TIME}:00.000Z`);
  const attendanceUpdate = plan.attendanceUpdates[0] || null;
  const before = row;

  const [updated] = await sql`
    update attendance_record
    set
      computed_amount = ${attendanceUpdate ? attendanceUpdate.computedAmount : row.computedAmount},
      reason = ${attendanceUpdate ? attendanceUpdate.reason : row.reason},
      status = ${attendanceUpdate ? attendanceUpdate.status : row.status},
      sign_out_at = ${signOutAt},
      sign_out_time = ${SIGN_OUT_TIME},
      sign_out_network_ip = 'manual_admin',
      sign_out_user_agent = ${REPAIR_REASON},
      no_sign_out_waived = false,
      no_sign_out_waived_at = null,
      no_sign_out_waived_by_email = null,
      no_sign_out_waived_by_user_id = null,
      no_sign_out_waived_reason = null,
      updated_at = ${now}
    where id = ${row.id}
    returning
      id,
      staff_id as "staffId",
      check_in_time as "checkInTime",
      sign_out_time as "signOutTime",
      sign_out_network_ip as "signOutNetworkIp",
      computed_amount as "computedAmount",
      reason,
      status
  `;

  await writeAuditEvent({
    action: 'UPDATE',
    after: { ...updated, repairReason: REPAIR_REASON, staffName: row.staffName },
    before,
    entityId: row.id,
    entityType: 'attendance',
  });

  const latenessById = new Map(latenessRows.map((entry) => [entry.id, entry]));

  for (const update of plan.latenessUpdates) {
    const latenessBefore = latenessById.get(update.id) || null;
    await sql`
      update lateness_entry
      set
        arrival_time = ${update.arrivalTime},
        computed_amount = ${update.computedAmount},
        did_not_sign_out = ${update.didNotSignOut},
        reason = ${update.reason},
        updated_at = ${now}
      where id = ${update.id}
    `;
    await writeAuditEvent({
      action: 'UPDATE',
      after: { ...update, repairReason: REPAIR_REASON },
      before: latenessBefore,
      entityId: update.id,
      entityType: 'entry',
    });
  }

  for (const deletion of plan.latenessDeletes) {
    const latenessBefore = latenessById.get(deletion.id) || null;
    await sql`delete from lateness_entry where id = ${deletion.id}`;
    await writeAuditEvent({
      action: 'DELETE',
      after: null,
      before: { ...latenessBefore, repairReason: REPAIR_REASON },
      entityId: deletion.id,
      entityType: 'entry',
    });
  }

  for (const values of plan.latenessCreates) {
    const [created] = await sql`
      insert into lateness_entry (
        staff_id, date, arrival_time, did_not_sign_out, computed_amount, reason, created_at, updated_at
      ) values (
        ${values.staffId}, ${values.date}, ${values.arrivalTime}, ${values.didNotSignOut},
        ${values.computedAmount}, ${values.reason}, ${now}, ${now}
      )
      returning id, staff_id as "staffId", date, arrival_time as "arrivalTime",
        did_not_sign_out as "didNotSignOut", computed_amount as "computedAmount", reason
    `;
    if (!created) continue;
    await writeAuditEvent({
      action: 'CREATE',
      after: { ...created, repairReason: REPAIR_REASON },
      before: null,
      entityId: created.id,
      entityType: 'entry',
    });
  }
}

console.log(`${applyChanges ? 'Applying' : 'Dry run'} 2026-07-06 sign-out correction (setting sign-out to ${SIGN_OUT_TIME})...`);

const rows = await fetchUnsignedOutRows();
console.log(`Staff checked in on ${INCIDENT_DATE} with no sign-out recorded: ${rows.length}`);

if (rows.length === 0) {
  console.log('Nothing to correct.');
  process.exit(0);
}

const clock = getCurrentAccraClock();

for (const row of rows) {
  const correctedAttendance = {
    checkInTime: row.checkInTime,
    computedAmount: row.computedAmount,
    date: INCIDENT_DATE,
    id: row.id,
    noSignOutWaived: false,
    reason: row.reason,
    signOutTime: SIGN_OUT_TIME,
    status: row.status,
  };
  const latenessRows = await fetchStaffLatenessRow(row.staffId);
  const permissionRows = await fetchStaffPermissionRow(row.staffId);
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [correctedAttendance],
    currentDateKey: clock.dateKey,
    currentTimeKey: clock.timeKey,
    isAttendanceOnly: row.isAttendanceOnly === true,
    isNssPersonnel: row.isNssPersonnel === true,
    latenessEntries: latenessRows,
    permissions: permissionRows,
    staffId: row.staffId,
  });
  const nextAmount = plan.attendanceUpdates[0]?.computedAmount ?? row.computedAmount;

  console.log(`- ${row.staffName || row.staffId}: check-in ${row.checkInTime} -> sign-out ${SIGN_OUT_TIME}, penalty ${row.computedAmount} -> ${nextAmount}`);

  if (applyChanges) {
    await applyPlanForRow({ latenessRows, plan, row });
  }
}

if (!applyChanges) {
  console.log('');
  console.log('No records were changed. Run with --apply to set sign-out to 4:30pm for these staff.');
} else {
  console.log('');
  console.log(`Set a ${SIGN_OUT_TIME} sign-out for ${rows.length} staff on ${INCIDENT_DATE}.`);
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, payments, dashboard, audit trail, and notifications.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
