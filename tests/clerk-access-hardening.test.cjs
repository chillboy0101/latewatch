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
