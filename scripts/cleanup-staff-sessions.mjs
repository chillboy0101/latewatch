import { createClerkClient } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');
const staffEmailArg = process.argv.find((arg) => arg.startsWith('--staff-email='));
const staffEmailFilter = staffEmailArg ? staffEmailArg.slice('--staff-email='.length).trim().toLowerCase() : null;

if (process.argv.includes('--help')) {
  console.log('Usage: npm run clerk:sessions:cleanup -- [--apply] [--staff-email=email@example.com]');
  console.log('Dry run by default. Add --apply to revoke every active Clerk session except each trusted attendance-device session.');
  process.exit(0);
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error('CLERK_SECRET_KEY is required in .env or .env.local');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const sql = neon(process.env.DATABASE_URL);

function maskSessionId(value) {
  if (!value) return null;
  return `${String(value).slice(0, 8)}...`;
}

async function getActiveSessions(userId) {
  const sessions = [];
  const limit = 100;
  let offset = 0;
  let totalCount = 0;

  do {
    const page = await clerk.sessions.getSessionList({
      limit,
      offset,
      status: 'active',
      userId,
    });
    sessions.push(...page.data);
    totalCount = page.totalCount;
    offset += page.data.length;
  } while (sessions.length < totalCount && offset > 0);

  return sessions;
}

async function findUserId(staffMember) {
  if (staffMember.userId) return staffMember.userId;
  if (!staffMember.email) return null;

  const users = await clerk.users.getUserList({
    emailAddress: [staffMember.email],
    limit: 1,
  });
  return users.data[0]?.id || null;
}

const staffRows = await sql`
  select
    s.id,
    s.full_name as "staffName",
    lower(trim(s.email)) as email,
    sd.user_id as "userId",
    sd.clerk_session_id as "trustedSessionId"
  from staff s
  left join staff_device sd on sd.staff_id = s.id
  where coalesce(s.active, true) = true
    and coalesce(s.archived, false) = false
    and s.email is not null
    and trim(s.email) <> ''
    and (${staffEmailFilter}::text is null or lower(trim(s.email)) = ${staffEmailFilter})
  order by s.full_name asc
`;

const summary = {
  apply: applyChanges,
  checkedStaff: 0,
  matchedClerkUsers: 0,
  revokedSessions: 0,
  skippedMissingTrustedSession: 0,
  skippedNoClerkUser: 0,
  staffWithExtraSessions: 0,
  staffWithOnlyTrustedSession: 0,
  wouldRevokeSessions: 0,
};

const details = [];

console.log(`${applyChanges ? 'Applying' : 'Dry run'} trusted attendance-device Clerk session cleanup...`);
if (staffEmailFilter) {
  console.log(`Staff email filter: ${staffEmailFilter}`);
}

for (const staffMember of staffRows) {
  summary.checkedStaff += 1;

  if (!staffMember.trustedSessionId) {
    summary.skippedMissingTrustedSession += 1;
    details.push({
      email: staffMember.email,
      staffName: staffMember.staffName,
      status: 'skipped_missing_trusted_session',
    });
    continue;
  }

  const userId = await findUserId(staffMember);
  if (!userId) {
    summary.skippedNoClerkUser += 1;
    details.push({
      email: staffMember.email,
      staffName: staffMember.staffName,
      status: 'skipped_no_clerk_user',
    });
    continue;
  }

  summary.matchedClerkUsers += 1;
  const sessions = await getActiveSessions(userId);
  const keepSessionIsActive = sessions.some((session) => session.id === staffMember.trustedSessionId);
  if (!keepSessionIsActive) {
    details.push({
      activeSessions: sessions.length,
      email: staffMember.email,
      staffName: staffMember.staffName,
      status: 'skipped_trusted_session_not_active',
      trustedSessionId: maskSessionId(staffMember.trustedSessionId),
    });
    continue;
  }

  const sessionsToRevoke = sessions.filter((session) => session.id !== staffMember.trustedSessionId);
  if (sessionsToRevoke.length === 0) {
    summary.staffWithOnlyTrustedSession += 1;
    details.push({
      email: staffMember.email,
      keptSessionId: maskSessionId(staffMember.trustedSessionId),
      staffName: staffMember.staffName,
      status: 'only_trusted_session_active',
    });
    continue;
  }

  summary.staffWithExtraSessions += 1;
  summary.wouldRevokeSessions += sessionsToRevoke.length;

  let revokedForStaff = 0;
  if (applyChanges) {
    for (const session of sessionsToRevoke) {
      await clerk.sessions.revokeSession(session.id);
      revokedForStaff += 1;
      summary.revokedSessions += 1;
    }
  }

  details.push({
    email: staffMember.email,
    keptSessionId: maskSessionId(staffMember.trustedSessionId),
    revokedSessions: revokedForStaff,
    staffName: staffMember.staffName,
    status: applyChanges ? 'revoked_extra_sessions' : 'would_revoke_extra_sessions',
    wouldRevokeSessionIds: sessionsToRevoke.map((session) => maskSessionId(session.id)),
  });
}

console.log(JSON.stringify({ details, summary }, null, 2));

if (!applyChanges && summary.wouldRevokeSessions > 0) {
  console.log('Dry run only. Run with --apply to revoke the extra sessions listed above.');
}
