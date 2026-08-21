import { createClerkClient } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const GEORGE_ID = '8900f55a-1e74-48a8-89b7-e9c3a19e749c';
const GEORGE_LEAVE_ID = 'fd4b5c26-9ea9-4e1b-95c2-18a697e92340';
const MICHAEL_ID = 'a592b244-42ff-4efb-98dc-ef331f79a05c';
const MICHAEL_LEAVE_ID = '4686e308-2e37-4a36-8870-9997066e7428';
const MICHAEL_INACTIVE_START = '2026-07-08';
const applyChanges = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function getTargetState() {
  return sql.query(`
    select s.id, s.full_name as "fullName", s.email,
      coalesce(s.active, true) as active, coalesce(s.archived, false) as archived,
      slp.id as "leaveId", slp.start_date as "leaveStartDate", slp.end_date as "leaveEndDate",
      slp.leave_type as "leaveType", sip.id as "inactivePeriodId",
      sip.start_date as "inactiveStartDate", sip.reactivated_on as "reactivatedOn"
    from staff s
    left join staff_leave_period slp on slp.staff_id = s.id and slp.end_date is null
    left join staff_inactive_period sip on sip.staff_id = s.id and sip.reactivated_on is null
    where s.id in ('${GEORGE_ID}', '${MICHAEL_ID}')
    order by s.full_name
  `);
}

async function revokeMichaelSessions(email) {
  if (!process.env.CLERK_SECRET_KEY || !email) return { revokedSessions: 0, status: 'not_configured_or_unlinked' };
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const users = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = users.data[0];
  if (!user) return { revokedSessions: 0, status: 'no_clerk_user' };
  const sessions = await clerk.sessions.getSessionList({ limit: 100, status: 'active', userId: user.id });
  let revokedSessions = 0;
  for (const session of sessions.data) {
    await clerk.sessions.revokeSession(session.id);
    revokedSessions += 1;
  }
  return { revokedSessions, status: revokedSessions ? 'revoked' : 'no_active_sessions' };
}

const targetState = await getTargetState();
const george = targetState.find((row) => row.id === GEORGE_ID);
const michael = targetState.find((row) => row.id === MICHAEL_ID);
if (!george || !michael) {
  console.error('George or Michael could not be found; no changes made.');
  process.exit(1);
}
const georgeNeedsReconciliation = !(george.active && george.leaveId === GEORGE_LEAVE_ID && george.leaveEndDate === null);
const michaelNeedsReconciliation = !(!michael.active && michael.inactivePeriodId && !michael.leaveId);

const unresolved = await sql`
  select s.id, s.full_name as "fullName"
  from staff s
  where coalesce(s.active, true) = false and coalesce(s.archived, false) = false
    and s.id <> ${MICHAEL_ID}
    and not exists (
      select 1 from staff_leave_period slp where slp.staff_id = s.id
        and slp.start_date <= current_date and (slp.end_date is null or slp.end_date >= current_date)
    )
    and not exists (
      select 1 from staff_inactive_period sip where sip.staff_id = s.id and sip.reactivated_on is null
    )
  order by s.full_name
`;

console.log(`${applyChanges ? 'Applying' : 'Dry run'} staff leave/inactive reconciliation`);
console.log(`George: ${georgeNeedsReconciliation ? 'set active with open Other leave from 2026-05-01' : 'already reconciled'}`);
console.log(`Michael: ${michaelNeedsReconciliation ? 'convert open leave to inactive from 2026-07-08' : 'already reconciled'}`);
console.log(`Unmatched legacy inactive records left unchanged: ${unresolved.length}`);
unresolved.forEach((row) => console.log(`  REVIEW INACTIVE ${row.fullName} (${row.id})`));

if (!applyChanges) {
  console.log('No changes made. Re-run with --apply after reviewing this report.');
  process.exit(0);
}

if (georgeNeedsReconciliation) {
  await sql`
    update staff_leave_period set leave_type = 'other', source = 'manual_backfill',
      updated_by_email = 'system', updated_at = now()
    where id = ${GEORGE_LEAVE_ID} and staff_id = ${GEORGE_ID}
  `;
  await sql`update staff set active = true, updated_at = now() where id = ${GEORGE_ID} and archived = false`;
  await sql`
    insert into audit_event (entity_type, entity_id, action, before_json, after_json, actor_email)
    values
      ('attendance_permission', ${GEORGE_LEAVE_ID}, 'UPDATE',
        ${JSON.stringify({ migration: 'legacy-open-leave' })}::jsonb,
        ${JSON.stringify({ endDate: null, leaveType: 'other', migration: 'open-ended-leave' })}::jsonb, 'system'),
      ('staff', ${GEORGE_ID}, 'ACTIVATE',
        ${JSON.stringify({ active: false, migration: 'legacy-leave' })}::jsonb,
        ${JSON.stringify({ active: true, leaveId: GEORGE_LEAVE_ID, migration: 'open-ended-leave' })}::jsonb, 'system')
  `;
}

let sessionResult = { revokedSessions: 0, status: 'not_needed' };
if (michaelNeedsReconciliation) {
  const paidMichaelRows = await sql`
    select count(*)::int as count
    from lateness_payment_allocation allocation
    inner join lateness_entry entry on entry.id = allocation.entry_id
    where entry.staff_id = ${MICHAEL_ID} and entry.date >= ${MICHAEL_INACTIVE_START}
  `;
  if (Number(paidMichaelRows[0]?.count || 0) > 0) {
    console.error('Michael has paid penalties in the inactive range; migration stopped before converting his leave.');
    process.exit(1);
  }

  if (michael.leaveId === MICHAEL_LEAVE_ID && !michael.inactivePeriodId) {
  await sql.query(`
    with removed_leave as (
      delete from staff_leave_period where id = '${MICHAEL_LEAVE_ID}' and staff_id = '${MICHAEL_ID}' returning staff_id
    )
    insert into staff_inactive_period (
      staff_id, start_date, reason_code, note, created_by_email, created_at, updated_at
    )
    select staff_id, date '${MICHAEL_INACTIVE_START}', 'temporarily_not_monitored',
      'Converted from legacy staff-status leave by administrator instruction.', 'system', now(), now()
    from removed_leave on conflict (staff_id, start_date) do nothing
  `);
  }
  await sql`update staff set active = false, updated_at = now() where id = ${MICHAEL_ID} and archived = false`;
  await sql`
  update push_subscription set disabled_at = coalesce(disabled_at, now()), sign_in_enabled = false,
    sign_out_enabled = false, updated_at = now()
  where staff_id = ${MICHAEL_ID} and disabled_at is null
  `;
  await sql`
  delete from lateness_entry entry where entry.staff_id = ${MICHAEL_ID}
    and entry.date >= ${MICHAEL_INACTIVE_START}
    and not exists (select 1 from lateness_payment_allocation allocation where allocation.entry_id = entry.id)
  `;
  await sql`
  update attendance_record set computed_amount = '0.00', reason = null,
    status = case when check_in_time is null then 'absent' else 'present' end, updated_at = now()
  where staff_id = ${MICHAEL_ID} and date >= ${MICHAEL_INACTIVE_START}
  `;
  try {
    sessionResult = await revokeMichaelSessions(michael.email);
  } catch (error) {
    sessionResult = { revokedSessions: 0, status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
  await sql`
    insert into audit_event (entity_type, entity_id, action, before_json, after_json, actor_email)
    values ('staff', ${MICHAEL_ID}, 'DEACTIVATE',
      ${JSON.stringify({ leaveId: MICHAEL_LEAVE_ID, migration: 'legacy-leave' })}::jsonb,
      ${JSON.stringify({ active: false, inactiveFrom: MICHAEL_INACTIVE_START, reasonCode: 'temporarily_not_monitored', sessionResult })}::jsonb, 'system')
  `;
}

const finalState = await getTargetState();
console.log('Reconciliation applied.');
console.log(JSON.stringify(finalState.map((row) => ({
  active: row.active,
  fullName: row.fullName,
  inactiveStartDate: row.inactiveStartDate,
  leaveEndDate: row.leaveEndDate,
  leaveStartDate: row.leaveStartDate,
})), null, 2));
console.log(`Michael Clerk access cleanup: ${sessionResult.status} (${sessionResult.revokedSessions || 0} sessions revoked).`);
