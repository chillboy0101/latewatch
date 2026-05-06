/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

let pendingInvitations = [];
const calls = {
  createdInvitations: [],
  revokedInvitations: [],
};

const fakeClient = {
  organizations: {
    createOrganizationInvitation: async (params) => {
      calls.createdInvitations.push(params);
      pendingInvitations.push({
        emailAddress: params.emailAddress,
        id: `inv_${calls.createdInvitations.length}`,
        privateMetadata: params.privateMetadata || {},
        publicMetadata: params.publicMetadata || {},
      });
      return pendingInvitations[pendingInvitations.length - 1];
    },
    createOrganizationMembership: async () => null,
    getOrganizationInvitationList: async () => ({ data: pendingInvitations }),
    getOrganizationList: async () => ({ data: [{ id: 'org_test' }] }),
    getOrganizationMembershipList: async () => ({ data: [] }),
    revokeOrganizationInvitation: async (params) => {
      calls.revokedInvitations.push(params);
      pendingInvitations = pendingInvitations.filter((invitation) => invitation.id !== params.invitationId);
      return {};
    },
  },
  users: {
    getUserList: async () => ({ data: [] }),
    updateUserMetadata: async () => null,
  },
};

Module._load = function patchedLoad(request, ...args) {
  if (request === 'server-only') return {};
  if (request === '@clerk/backend') {
    return {
      createClerkClient: () => fakeClient,
    };
  }

  return originalLoad.call(this, request, ...args);
};

require('tsx/cjs');

const { syncStaffEmailIdentity } = require('../src/lib/clerk-organization.ts');

function resetClerkFixture() {
  calls.createdInvitations = [];
  calls.revokedInvitations = [];
  pendingInvitations = [];
  process.env.CLERK_SECRET_KEY = 'sk_test';
  process.env.CLERK_ORGANIZATION_ID = 'org_test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://latewatch.example';
}

test('staff sync sends Clerk invitations to the invite-aware sign-up page', async () => {
  resetClerkFixture();

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'new.staff@example.com',
    staffId: 'staff_1',
    staffName: 'New Staff',
  });

  assert.equal(result.status, 'invitation_sent');
  assert.equal(calls.createdInvitations.length, 1);
  assert.equal(
    calls.createdInvitations[0].redirectUrl,
    'https://latewatch.example/sign-up?redirect_url=https%3A%2F%2Flatewatch.example%2Fcheck-in',
  );
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchInvitationFlowVersion, 'sign-up-ticket-v1');
});

test('staff sync resends stale pending invitations created with the old check-in redirect', async () => {
  resetClerkFixture();
  pendingInvitations = [{
    emailAddress: 'old.staff@example.com',
    id: 'inv_old',
    privateMetadata: {
      latewatchStaffId: 'staff_2',
    },
    publicMetadata: {
      latewatchStaffId: 'staff_2',
    },
  }];

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'old.staff@example.com',
    staffId: 'staff_2',
    staffName: 'Old Staff',
  });

  assert.equal(result.status, 'invitation_sent');
  assert.deepEqual(calls.revokedInvitations, [{ invitationId: 'inv_old', organizationId: 'org_test' }]);
  assert.equal(calls.createdInvitations.length, 1);
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchInvitationFlowVersion, 'sign-up-ticket-v1');
});

test('staff sync keeps current pending invitations instead of sending duplicates', async () => {
  resetClerkFixture();
  pendingInvitations = [{
    emailAddress: 'current.staff@example.com',
    id: 'inv_current',
    privateMetadata: {
      latewatchInvitationFlowVersion: 'sign-up-ticket-v1',
      latewatchStaffId: 'staff_3',
    },
    publicMetadata: {
      latewatchStaffId: 'staff_3',
    },
  }];

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'current.staff@example.com',
    staffId: 'staff_3',
    staffName: 'Current Staff',
  });

  assert.equal(result.status, 'invitation_exists');
  assert.equal(calls.revokedInvitations.length, 0);
  assert.equal(calls.createdInvitations.length, 0);
});
