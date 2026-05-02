import { createClerkClient } from '@clerk/backend';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const email = argValue('--email');
const userId = argValue('--user') || argValue('--user-id');
const role = (argValue('--role') || 'admin').trim().toLowerCase();

if (!email && !userId) {
  console.error('Usage: npm run clerk:role -- --email person@example.com --role admin');
  console.error('   or: npm run clerk:role -- --user user_xxxxx --role admin');
  process.exit(1);
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error('CLERK_SECRET_KEY is required in .env or .env.local');
  process.exit(1);
}

const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function findUser() {
  if (userId) return await client.users.getUser(userId);

  const result = await client.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });

  return result.data[0] || null;
}

const user = await findUser();

if (!user) {
  console.error(`No Clerk user found for ${email || userId}`);
  process.exit(1);
}

const privateMetadata = {
  ...user.privateMetadata,
  role,
};
const publicMetadata = {
  ...user.publicMetadata,
  role,
};

const updated = await client.users.updateUserMetadata(user.id, {
  privateMetadata,
  publicMetadata,
});

const primaryEmail = updated.primaryEmailAddress?.emailAddress
  || updated.emailAddresses[0]?.emailAddress
  || 'unknown';

console.log(`Updated ${primaryEmail} (${updated.id}) to role "${role}".`);
