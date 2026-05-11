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

if (process.argv.includes('--help')) {
  console.log('Usage: npm run penalties:recalculate -- [--apply]');
  console.log('Runs a dry-run by default. Add --apply to update regular staff records.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const AUDIT_REASON = 'regular-staff-penalty-threshold-recalculation';
const INVALIDATION_CHANNELS = ['entries', 'attendance', 'dashboard', 'audit-trail', 'notifications'];

function countPlan(plan) {
  return {
    attendanceUpdated: plan.attendanceUpdates.length,
    latenessCreated: plan.latenessCreates.length,
    latenessDeleted: plan.latenessDeletes.length,
    latenessUpdated: plan.latenessUpdates.length,
  };
}

function changedCount(counts) {
  return counts.attendanceUpdated
    + counts.latenessCreated
    + counts.latenessDeleted
    + counts.latenessUpdated;
}

function addCounts(total, counts) {
  total.attendanceUpdated += counts.attendanceUpdated;
  total.latenessCreated += counts.latenessCreated;
  total.latenessDeleted += counts.latenessDeleted;
  total.latenessUpdated += counts.latenessUpdated;
}

function auditAfter(before, next) {
  return {
    ...before,
    ...next,
    recalculationReason: AUDIT_REASON,
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
      reason: AUDIT_REASON,
    })
  ));
  return true;
}

async function applyPlan({ attendanceRows, latenessRows, plan }) {
  const attendanceById = new Map(attendanceRows.map((row) => [row.id, row]));
  const latenessById = new Map(latenessRows.map((row) => [row.id, row]));
  const now = new Date();

  for (const update of plan.attendanceUpdates) {
    const before = attendanceById.get(update.id) || null;
    await sql`
      update attendance_record
      set
        computed_amount = ${update.computedAmount},
        reason = ${update.reason},
        status = ${update.status},
        updated_at = ${now}
      where id = ${update.id}
    `;

    await writeAuditEvent({
      action: 'UPDATE',
      after: auditAfter(before, {
        computedAmount: update.computedAmount,
        reason: update.reason,
        status: update.status,
        updatedAt: now.toISOString(),
      }),
      before,
      entityId: update.id,
      entityType: 'attendance',
    });
  }

  for (const update of plan.latenessUpdates) {
    const before = latenessById.get(update.id) || null;
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
      after: auditAfter(before, {
        arrivalTime: update.arrivalTime,
        computedAmount: update.computedAmount,
        didNotSignOut: update.didNotSignOut,
        reason: update.reason,
        updatedAt: now.toISOString(),
      }),
      before,
      entityId: update.id,
      entityType: 'entry',
    });
  }

  for (const values of plan.latenessCreates) {
    const [created] = await sql`
      insert into lateness_entry (
        staff_id,
        date,
        arrival_time,
        did_not_sign_out,
        computed_amount,
        reason,
        created_at,
        updated_at
      ) values (
        ${values.staffId},
        ${values.date},
        ${values.arrivalTime},
        ${values.didNotSignOut},
        ${values.computedAmount},
        ${values.reason},
        ${now},
        ${now}
      )
      returning
        id,
        staff_id as "staffId",
        date,
        arrival_time as "arrivalTime",
        did_not_sign_out as "didNotSignOut",
        computed_amount as "computedAmount",
        reason,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    if (!created) continue;

    await writeAuditEvent({
      action: 'CREATE',
      after: auditAfter(created, {}),
      before: null,
      entityId: created.id,
      entityType: 'entry',
    });
  }

  for (const deletion of plan.latenessDeletes) {
    const before = latenessById.get(deletion.id) || null;
    await sql`delete from lateness_entry where id = ${deletion.id}`;

    await writeAuditEvent({
      action: 'DELETE',
      after: null,
      before: auditAfter(before, {}),
      entityId: deletion.id,
      entityType: 'entry',
    });
  }
}

const staffRows = await sql`
  select
    id,
    full_name as "fullName",
    is_attendance_only as "isAttendanceOnly",
    is_nss_personnel as "isNssPersonnel"
  from staff
  where
    coalesce(is_attendance_only, false) = false
    and coalesce(is_nss_personnel, false) = false
  order by full_name asc
`;

const total = {
  attendanceUpdated: 0,
  latenessCreated: 0,
  latenessDeleted: 0,
  latenessUpdated: 0,
};
let staffWithChanges = 0;

console.log(`${applyChanges ? 'Applying' : 'Dry run'} regular staff penalty recalculation...`);
console.log(`Regular staff scanned: ${staffRows.length}`);

for (const staffMember of staffRows) {
  const [attendanceRows, latenessRows, permissionRows] = await Promise.all([
    sql`
      select
        id,
        staff_id as "staffId",
        date,
        check_in_time as "checkInTime",
        computed_amount as "computedAmount",
        reason,
        status
      from attendance_record
      where staff_id = ${staffMember.id}
    `,
    sql`
      select
        id,
        staff_id as "staffId",
        date,
        arrival_time as "arrivalTime",
        did_not_sign_out as "didNotSignOut",
        computed_amount as "computedAmount",
        reason
      from lateness_entry
      where staff_id = ${staffMember.id}
    `,
    sql`
      select
        date,
        arrival_window as "arrivalWindow",
        expected_end_time as "expectedEndTime",
        expected_start_time as "expectedStartTime",
        permission_type as "permissionType",
        reason,
        status
      from attendance_permission
      where staff_id = ${staffMember.id}
    `,
  ]);

  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: attendanceRows,
    isAttendanceOnly: false,
    isNssPersonnel: false,
    latenessEntries: latenessRows,
    permissions: permissionRows,
    staffId: staffMember.id,
  });
  const counts = countPlan(plan);
  const changed = changedCount(counts);

  if (changed === 0) continue;

  staffWithChanges += 1;
  addCounts(total, counts);
  console.log(
    `- ${staffMember.fullName}: `
    + `${counts.attendanceUpdated} attendance updates, `
    + `${counts.latenessUpdated} lateness updates, `
    + `${counts.latenessCreated} lateness creates, `
    + `${counts.latenessDeleted} lateness deletes`,
  );

  if (applyChanges) {
    await applyPlan({ attendanceRows, latenessRows, plan });
  }
}

console.log('');
console.log(`Staff with changes: ${staffWithChanges}`);
console.log(`Attendance updates: ${total.attendanceUpdated}`);
console.log(`Lateness updates: ${total.latenessUpdated}`);
console.log(`Lateness creates: ${total.latenessCreated}`);
console.log(`Lateness deletes: ${total.latenessDeleted}`);

if (!applyChanges) {
  console.log('');
  console.log('No records were changed. Run with --apply to write these corrections.');
} else {
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, dashboard, audit trail, and notifications.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
