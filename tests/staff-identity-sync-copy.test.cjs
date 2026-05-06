/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

require('tsx/cjs');

const { getStaffIdentitySyncCopy } = require('../src/lib/staff-identity-sync-copy.ts');

test('staff identity copy explains when Clerk sends a fresh invitation email', () => {
  assert.deepEqual(getStaffIdentitySyncCopy({
    email: 'staff@example.com',
    staffName: 'Jane Staff',
    status: 'invitation_sent',
  }), {
    detail: 'Clerk created a fresh invitation for staff@example.com. Ask them to check inbox, spam, and promotions because development-instance emails may be filtered.',
    title: 'Jane Staff: Invitation email sent',
    tone: 'success',
  });
});

test('staff identity copy explains that pending invitations do not send another email', () => {
  assert.deepEqual(getStaffIdentitySyncCopy({
    email: 'staff@example.com',
    staffName: 'Jane Staff',
    status: 'invitation_exists',
  }), {
    detail: 'Clerk already has a pending invitation for staff@example.com, so clicking sync again will not send a second email.',
    title: 'Jane Staff: Invitation already pending',
    tone: 'warning',
  });
});

test('staff identity copy explains that existing Clerk users are linked without email', () => {
  assert.deepEqual(getStaffIdentitySyncCopy({
    email: 'staff@example.com',
    staffName: 'Jane Staff',
    status: 'member_added',
  }), {
    detail: 'staff@example.com already has a Clerk account, so no invitation email was sent. They can sign in with that account now.',
    title: 'Jane Staff: Existing account linked',
    tone: 'success',
  });
});
