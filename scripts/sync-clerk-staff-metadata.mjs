import { createClerkClient } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
require('tsx/cjs');

const {
  clerkStaffPrivateMetadata,
  clerkStaffPublicMetadata,
} = require('../src/lib/clerk-staff-metadata.ts');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const applyChanges = process.argv.includes('--apply');

if (process.argv.includes('--help')) {
  console.log('Usage: npm run clerk:staff-metadata -- [--apply]');
  console.log('Dry run by default. Add --apply to update existing Clerk users.');
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

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasMetadataChanges(currentMetadata, nextMetadata) {
  const current = asRecord(currentMetadata);
  return Object.entries(nextMetadata).some(([key, value]) => current[key] !== value);
}

const staffRows = await sql`
  select
    id,
    full_name as "staffName",
    email,
    coalesce(is_attendance_only, false) as "isAttendanceOnly",
    coalesce(is_nss_personnel, false) as "isNssPersonnel"
  from staff
  where email is not null and trim(email) <> ''
  order by full_name asc
`;

console.log(`${applyChanges ? 'Applying' : 'Dry run'} Clerk staff metadata sync...`);
console.log(`Staff with emails scanned: ${staffRows.length}`);

let matched = 0;
let changed = 0;
let skipped = 0;

for (const staffMember of staffRows) {
  const email = String(staffMember.email || '').trim().toLowerCase();
  if (!email) continue;

  const users = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });
  const user = users.data[0] || null;

  if (!user) {
    skipped += 1;
    console.log(`- ${staffMember.staffName}: no existing Clerk user for ${email}; skipped`);
    continue;
  }

  matched += 1;

  const metadataInput = {
    email,
    isAttendanceOnly: staffMember.isAttendanceOnly === true,
    isNssPersonnel: staffMember.isNssPersonnel === true,
    staffId: staffMember.id,
    staffName: staffMember.staffName,
  };
  const nextPrivateMetadata = clerkStaffPrivateMetadata(metadataInput);
  const nextPublicMetadata = clerkStaffPublicMetadata(metadataInput);
  const needsUpdate = hasMetadataChanges(user.privateMetadata, nextPrivateMetadata)
    || hasMetadataChanges(user.publicMetadata, nextPublicMetadata);

  if (!needsUpdate) {
    console.log(`- ${staffMember.staffName}: already up to date`);
    continue;
  }

  changed += 1;
  const privateMetadata = {
    ...asRecord(user.privateMetadata),
    ...nextPrivateMetadata,
  };
  const publicMetadata = {
    ...asRecord(user.publicMetadata),
    ...nextPublicMetadata,
  };

  if (applyChanges) {
    await clerk.users.updateUserMetadata(user.id, {
      privateMetadata,
      publicMetadata,
    });
    console.log(`- ${staffMember.staffName}: updated ${email}`);
  } else {
    console.log(`- ${staffMember.staffName}: would update ${email}`);
  }
}

console.log('');
console.log(`Existing Clerk users matched: ${matched}`);
console.log(`Metadata updates ${applyChanges ? 'applied' : 'needed'}: ${changed}`);
console.log(`Staff skipped without existing Clerk user: ${skipped}`);

if (!applyChanges) {
  console.log('');
  console.log('No Clerk users were changed. Run with --apply to write these metadata updates.');
}
