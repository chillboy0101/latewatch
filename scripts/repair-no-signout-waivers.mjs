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
const REPAIR_REASON = 'no-sign-out-waiver-repair';
const LEGACY_REASON = 'legacy_entries_fallback_sign_out';
const AUDIT_REASON = 'audit_confirmed_no_sign_out_cleared';
const INVALIDATION_CHANNELS = [
  'entries',
  'attendance',
  'payments',
  'dashboard',
  'audit-trail',
  'notifications',
];

if (process.argv.includes('--help')) {
  console.log('Usage: npm run no-signout:repair-waivers -- [--apply]');
  console.log('Runs a dry-run by default. Add --apply to store waivers and repair penalties.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function toDateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

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

function countPlan(plan) {
  return {
    attendanceUpdated: plan.attendanceUpdates.length,
    latenessCreated: plan.latenessCreates.length,
    latenessDeleted: plan.latenessDeletes.length,
    latenessUpdated: plan.latenessUpdates.length,
  };
}

function addCounts(total, counts) {
  total.attendanceUpdated += counts.attendanceUpdated;
  total.latenessCreated += counts.latenessCreated;
  total.latenessDeleted += counts.latenessDeleted;
  total.latenessUpdated += counts.latenessUpdated;
}

function normalizeRow(row, repairReason) {
  return {
    ...row,
    date: toDateKey(row.date),
    noSignOutWaived: true,
    noSignOutWaivedAt: new Date(),
    noSignOutWaivedByEmail: 'system',
    noSignOutWaivedByUserId: null,
    noSignOutWaivedReason: repairReason,
    signOutTime: null,
  };
}

function auditAfter(before, next) {
  return {
    ...before,
    ...next,
    repairReason: REPAIR_REASON,
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

async function assertWaiverColumnsPresent() {
  const [row] = await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_name = 'attendance_record'
        and column_name = 'no_sign_out_waived'
    ) as exists
  `;

  if (row?.exists === true) return;

  console.error('No-sign-out waiver columns are missing.');
  console.error('Run the migration in drizzle/0021_no_sign_out_waivers.sql before running this repair.');
  process.exit(1);
}

async function fetchLegacyRows() {
  return sql`
    select
      ar.id,
      ar.staff_id as "staffId",
      ar.date,
      ar.check_in_time as "checkInTime",
      ar.sign_out_time as "signOutTime",
      ar.sign_out_network_ip as "signOutNetworkIp",
      ar.computed_amount as "computedAmount",
      ar.reason,
      ar.status,
      ar.no_sign_out_waived as "noSignOutWaived",
      s.full_name as "staffName",
      coalesce(s.is_attendance_only, false) as "isAttendanceOnly",
      coalesce(s.is_nss_personnel, false) as "isNssPersonnel"
    from attendance_record ar
    left join staff s on s.id = ar.staff_id
    where
      ar.sign_out_time = '17:00'
      and ar.sign_out_network_ip = 'manual_admin'
      and coalesce(ar.no_sign_out_waived, false) = false
  `;
}

async function fetchAuditConfirmedRows() {
  return sql`
    select distinct on (ar.id)
      ar.id,
      ar.staff_id as "staffId",
      ar.date,
      ar.check_in_time as "checkInTime",
      ar.sign_out_time as "signOutTime",
      ar.sign_out_network_ip as "signOutNetworkIp",
      ar.computed_amount as "computedAmount",
      ar.reason,
      ar.status,
      ar.no_sign_out_waived as "noSignOutWaived",
      s.full_name as "staffName",
      coalesce(s.is_attendance_only, false) as "isAttendanceOnly",
      coalesce(s.is_nss_personnel, false) as "isNssPersonnel"
    from audit_event ae
    join attendance_record ar on ar.id::text = ae.entity_id
    left join staff s on s.id = ar.staff_id
    where
      ae.entity_type = 'attendance'
      and ae.action = 'UPDATE'
      and coalesce(ar.no_sign_out_waived, false) = false
      and ar.sign_out_time is null
      and (
        coalesce(ae.before_json->>'reason', '') ilike '%DID NOT SIGN OUT%'
        or coalesce(ae.before_json->>'didNotSignOut', '') = 'true'
        or coalesce(ae.before_json->>'computedAmount', '') in ('2', '2.00')
      )
      and (
        (
          coalesce(ae.after_json->>'computedAmount', '') in ('0', '0.00')
          or ae.after_json->>'reason' is null
          or coalesce(ae.after_json->>'reason', '') = ''
        )
        or (
          coalesce(ae.after_json->>'reason', '') not ilike '%DID NOT SIGN OUT%'
          and coalesce(ae.after_json->>'reason', '') <> ''
          and coalesce(ae.after_json->>'computedAmount', '') not in ('', '0', '0.00')
        )
      )
    order by ar.id, ae.timestamp desc
  `;
}

async function fetchAlreadyWaivedChargedRows() {
  return sql`
    select distinct on (ar.id)
      ar.id,
      ar.staff_id as "staffId",
      ar.date,
      ar.check_in_time as "checkInTime",
      ar.sign_out_time as "signOutTime",
      ar.sign_out_network_ip as "signOutNetworkIp",
      ar.computed_amount as "computedAmount",
      ar.reason,
      ar.status,
      ar.no_sign_out_waived as "noSignOutWaived",
      ar.no_sign_out_waived_reason as "noSignOutWaivedReason",
      s.full_name as "staffName",
      coalesce(s.is_attendance_only, false) as "isAttendanceOnly",
      coalesce(s.is_nss_personnel, false) as "isNssPersonnel"
    from attendance_record ar
    join lateness_entry le on le.staff_id = ar.staff_id and le.date = ar.date
    left join staff s on s.id = ar.staff_id
    where
      coalesce(ar.no_sign_out_waived, false) = true
      and le.did_not_sign_out = true
    order by ar.id, le.updated_at desc nulls last
  `;
}

async function fetchAmbiguousAuditCount() {
  const rows = await sql`
    select count(distinct ar.id)::int as count
    from audit_event ae
    join attendance_record ar on ar.id::text = ae.entity_id
    where
      ae.entity_type = 'attendance'
      and ae.action = 'UPDATE'
      and coalesce(ar.no_sign_out_waived, false) = false
      and ar.sign_out_time is not null
      and not (ar.sign_out_time = '17:00' and ar.sign_out_network_ip = 'manual_admin')
      and (
        coalesce(ae.before_json->>'reason', '') ilike '%DID NOT SIGN OUT%'
        or coalesce(ae.before_json->>'didNotSignOut', '') = 'true'
        or coalesce(ae.before_json->>'computedAmount', '') in ('2', '2.00')
      )
      and (
        coalesce(ae.after_json->>'computedAmount', '') in ('0', '0.00')
        or ae.after_json->>'reason' is null
        or coalesce(ae.after_json->>'reason', '') = ''
      )
  `;

  return Number(rows[0]?.count || 0);
}

async function fetchStaffLatenessRows(staffId, dates) {
  if (dates.size === 0) return [];

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
    where staff_id = ${staffId}
  `;

  return rows.filter((row) => dates.has(toDateKey(row.date)));
}

async function fetchStaffPermissions(staffId, dates) {
  if (dates.size === 0) return [];

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
    where staff_id = ${staffId}
  `;

  return rows.filter((row) => dates.has(toDateKey(row.date)));
}

async function applyWaiver(target) {
  const now = new Date();
  const before = target.row;
  const [updated] = await sql`
    update attendance_record
    set
      no_sign_out_waived = true,
      no_sign_out_waived_at = ${now},
      no_sign_out_waived_by_email = 'system',
      no_sign_out_waived_by_user_id = null,
      no_sign_out_waived_reason = ${target.reason},
      sign_out_accuracy_meters = null,
      sign_out_at = null,
      sign_out_distance_meters = null,
      sign_out_latitude = null,
      sign_out_location_at = null,
      sign_out_location_verified = false,
      sign_out_longitude = null,
      sign_out_network_ip = null,
      sign_out_office_location_id = null,
      sign_out_time = null,
      sign_out_user_agent = null,
      sign_out_verification_result = null,
      updated_at = ${now}
    where id = ${target.row.id}
    returning
      id,
      staff_id as "staffId",
      date,
      check_in_time as "checkInTime",
      sign_out_time as "signOutTime",
      computed_amount as "computedAmount",
      reason,
      status,
      no_sign_out_waived as "noSignOutWaived",
      no_sign_out_waived_at as "noSignOutWaivedAt",
      no_sign_out_waived_by_email as "noSignOutWaivedByEmail",
      no_sign_out_waived_by_user_id as "noSignOutWaivedByUserId",
      no_sign_out_waived_reason as "noSignOutWaivedReason"
  `;

  const after = {
    ...(updated || normalizeRow(target.row, target.reason)),
    staffName: target.row.staffName,
    isAttendanceOnly: target.row.isAttendanceOnly,
    isNssPersonnel: target.row.isNssPersonnel,
  };

  await writeAuditEvent({
    action: 'UPDATE',
    after: auditAfter(before, {
      noSignOutWaived: true,
      noSignOutWaivedAt: now.toISOString(),
      noSignOutWaivedByEmail: 'system',
      noSignOutWaivedByUserId: null,
      noSignOutWaivedReason: target.reason,
      signOutTime: null,
    }),
    before,
    entityId: target.row.id,
    entityType: 'attendance',
  });

  return after;
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

function buildTargets({ auditRows, cleanupRows, legacyRows }) {
  const targets = new Map();

  for (const row of legacyRows) {
    targets.set(row.id, {
      reason: LEGACY_REASON,
      row,
      source: 'legacy',
    });
  }

  for (const row of auditRows) {
    if (targets.has(row.id)) continue;
    targets.set(row.id, {
      reason: AUDIT_REASON,
      row,
      source: 'audit',
    });
  }

  for (const row of cleanupRows) {
    if (targets.has(row.id)) continue;
    targets.set(row.id, {
      alreadyWaived: true,
      reason: row.noSignOutWaivedReason || REPAIR_REASON,
      row,
      source: 'cleanup',
    });
  }

  return targets;
}

await assertWaiverColumnsPresent();

const [legacyRows, auditRows, cleanupRows, ambiguousSkipped] = await Promise.all([
  fetchLegacyRows(),
  fetchAuditConfirmedRows(),
  fetchAlreadyWaivedChargedRows(),
  fetchAmbiguousAuditCount(),
]);
const targets = buildTargets({ auditRows, cleanupRows, legacyRows });
const waiverTargets = [...targets.values()].filter((target) => target.alreadyWaived !== true);
const byStaff = new Map();

for (const target of targets.values()) {
  const list = byStaff.get(target.row.staffId) || [];
  list.push(target);
  byStaff.set(target.row.staffId, list);
}

const clock = getCurrentAccraClock();
const total = {
  attendanceUpdated: 0,
  latenessCreated: 0,
  latenessDeleted: 0,
  latenessUpdated: 0,
};
let staffWithChanges = 0;

console.log(`${applyChanges ? 'Applying' : 'Dry run'} no-sign-out waiver repair...`);
console.log(`Legacy fake sign-outs found: ${legacyRows.length}`);
console.log(`Audit-confirmed cleared no-sign-out rows found: ${auditRows.length}`);
console.log(`Already waived charged rows to clean: ${cleanupRows.length}`);
console.log(`Attendance rows to waive: ${waiverTargets.length}`);
console.log(`Ambiguous rows skipped: ${ambiguousSkipped}`);

for (const [staffId, staffTargets] of byStaff.entries()) {
  const dates = new Set(staffTargets.map((target) => toDateKey(target.row.date)));
  const latenessRows = await fetchStaffLatenessRows(staffId, dates);
  const permissionRows = await fetchStaffPermissions(staffId, dates);
  const staffInfo = staffTargets[0]?.row || {};
  const attendanceRows = staffTargets.map((target) => normalizeRow(target.row, target.reason));
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: attendanceRows,
    currentDateKey: clock.dateKey,
    currentTimeKey: clock.timeKey,
    isAttendanceOnly: staffInfo.isAttendanceOnly === true,
    isNssPersonnel: staffInfo.isNssPersonnel === true,
    latenessEntries: latenessRows,
    permissions: permissionRows,
    staffId,
  });
  const counts = countPlan(plan);

  if (
    counts.attendanceUpdated === 0 &&
    counts.latenessCreated === 0 &&
    counts.latenessDeleted === 0 &&
    counts.latenessUpdated === 0
  ) {
    if (applyChanges) {
      await Promise.all(staffTargets
        .filter((target) => target.alreadyWaived !== true)
        .map((target) => applyWaiver(target)));
    }
    continue;
  }

  staffWithChanges += 1;
  addCounts(total, counts);
  console.log(
    `- ${staffInfo.staffName || staffId}: `
    + `${staffTargets.length} waivers, `
    + `${counts.attendanceUpdated} attendance updates, `
    + `${counts.latenessUpdated} lateness updates, `
    + `${counts.latenessCreated} lateness creates, `
    + `${counts.latenessDeleted} lateness deletes`,
  );

  if (applyChanges) {
    const updatedAttendanceRows = [];
    for (const target of staffTargets) {
      updatedAttendanceRows.push(target.alreadyWaived === true
        ? normalizeRow(target.row, target.reason)
        : await applyWaiver(target));
    }
    await applyPlan({ attendanceRows: updatedAttendanceRows, latenessRows, plan });
  }
}

console.log('');
console.log(`Staff with penalty changes: ${staffWithChanges}`);
console.log(`Attendance updates: ${total.attendanceUpdated}`);
console.log(`Lateness updates: ${total.latenessUpdated}`);
console.log(`Lateness creates: ${total.latenessCreated}`);
console.log(`Lateness deletes: ${total.latenessDeleted}`);

if (!applyChanges) {
  console.log('');
  console.log('No records were changed. Run with --apply to write these waiver repairs.');
} else {
  await writeAuditEvent({
    action: 'SYNC',
    after: {
      ambiguousSkipped,
      alreadyWaivedChargedRowsCleaned: cleanupRows.length,
      attendanceRowsWaived: waiverTargets.length,
      auditConfirmedRowsFound: auditRows.length,
      legacyFakeSignOutsFound: legacyRows.length,
      totals: total,
    },
    before: null,
    entityId: 'no-sign-out-waiver-repair',
    entityType: 'system',
  });
  const published = await publishInvalidation();
  console.log(published
    ? 'Published live invalidation for entries, attendance, payments, dashboard, audit trail, and notifications.'
    : 'ABLY_API_KEY is not configured; refresh open pages manually to see applied corrections.');
}
