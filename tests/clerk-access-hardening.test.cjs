/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const proxyPath = path.join(root, 'src/proxy.ts');
const authCardPath = path.join(root, 'src/components/auth/clerk-auth-card.tsx');
const signUpPagePath = path.join(root, 'src/app/(auth)/sign-up/[[...sign-up]]/page.tsx');

test('protected app routes require the configured LateWatch Clerk organization', () => {
  const proxy = fs.readFileSync(proxyPath, 'utf8');

  assert.match(proxy, /process\.env\.CLERK_ORGANIZATION_ID \|\| process\.env\.CLERK_ORG_ID/);
  assert.match(proxy, /CLERK_ORGANIZATION_ID is required for LateWatch organization-gated routes/);
  assert.match(proxy, /return activeOrgId === requiredOrgId/);
  assert.doesNotMatch(proxy, /return !requiredOrgId \|\| activeOrgId === requiredOrgId/);
});

test('organization admins are accepted by middleware and server route guards', () => {
  const proxy = fs.readFileSync(proxyPath, 'utf8');
  const roles = fs.readFileSync(path.join(root, 'src/lib/auth/roles.ts'), 'utf8');
  const roleConfig = fs.readFileSync(path.join(root, 'src/lib/auth/role-config.ts'), 'utf8');

  assert.match(roleConfig, /roleFromOrganizationClaims/);
  assert.match(roleConfig, /org:admin/);
  assert.match(proxy, /roleFromOrganizationClaims\(sessionClaims\)/);
  assert.match(roles, /roleFromOrganizationClaims\(session\.sessionClaims\)/);
  assert.match(roles, /if \(allowed\.has\('admin'\)/);
});

test('public sign-in no longer advertises the sign-up route', () => {
  const authCard = fs.readFileSync(authCardPath, 'utf8');
  const signInBlock = authCard.slice(authCard.indexOf('<SignIn'));

  assert.match(authCard, /footerAction: 'hidden'/);
  assert.doesNotMatch(signInBlock, /signUpUrl="\/sign-up"/);
  assert.match(signInBlock, /transferable=\{false\}/);
  assert.match(signInBlock, /withSignUp=\{false\}/);
});

test('sign-up page only renders Clerk sign-up when an invitation token is present', () => {
  const signUpPage = fs.readFileSync(signUpPagePath, 'utf8');

  assert.match(signUpPage, /const INVITATION_PARAM_NAMES = \[/);
  assert.match(signUpPage, /hasInvitationParam\(resolvedSearchParams\)/);
  assert.match(signUpPage, /canSignUp \? <ClerkAuthCard mode="sign-up" \/> : <InviteOnlySignUpCard \/>/);
});

test('access comes from the Staff list (verified email, not archived), not only the 20-seat organisation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const proxy = fs.readFileSync(path.join(__dirname, '..', 'src', 'proxy.ts'), 'utf8');
  const access = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'auth', 'staff-access.ts'), 'utf8');

  // Organisation members keep working; active staff and admins also get in.
  assert.match(proxy, /&& !hasRequiredOrganization\(session\.sessionClaims\)\s+&& !\(await hasActiveStaffAccess\(session\.userId\)\)\s+&& !\(await isAdminSession\(session\.userId, session\.sessionClaims\)\)/);
  // Only verified emails count, archived staff never pass, failed lookups are not cached.
  assert.match(access, /address\.verification\?\.status === 'verified'/);
  assert.match(access, /eq\(staff\.archived, false\)/);
  assert.match(access, /Never cache a failed lookup/);
});
