/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

let pendingInvitations = [];
let existingUsers = [];
const calls = {
  createdInvitations: [],
  deletedMemberships: [],
  revokedInvitations: [],
  updatedMetadata: [],
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
    deleteOrganizationMembership: async (params) => {
      calls.deletedMemberships.push(params);
      return {};
    },
    getOrganizationInvitationList: async () => ({ data: pendingInvitations }),
    getOrganizationList: async () => ({ data: [{ id: 'org_test' }] }),
    getOrganizationMembershipList: async () => ({ data: [{ id: 'membership_1' }] }),
    revokeOrganizationInvitation: async (params) => {
      calls.revokedInvitations.push(params);
      pendingInvitations = pendingInvitations.filter((invitation) => invitation.id !== params.invitationId);
      return {};
    },
  },
  users: {
    getUserList: async (params) => ({
      data: existingUsers.filter((user) => (
        params.emailAddress || []
      ).some((email) => user.emailAddress.toLowerCase() === email.toLowerCase())),
    }),
    updateUserMetadata: async (userId, metadata) => {
      calls.updatedMetadata.push({ userId, metadata });
      const user = existingUsers.find((candidate) => candidate.id === userId);
      if (user) {
        user.privateMetadata = metadata.privateMetadata || {};
        user.publicMetadata = metadata.publicMetadata || {};
      }
      return user || null;
    },
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

const { syncStaffEmailIdentity, unlinkStaffEmailIdentity } = require('../src/lib/clerk-organization.ts');

function resetClerkFixture() {
  calls.createdInvitations = [];
  calls.deletedMemberships = [];
  calls.revokedInvitations = [];
  calls.updatedMetadata = [];
  pendingInvitations = [];
  existingUsers = [];
  process.env.CLERK_SECRET_KEY = 'sk_test';
  process.env.CLERK_ORGANIZATION_ID = 'org_test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://latewatch.example';
}

test('staff sync sends Clerk invitations to the invite-aware sign-up page', async () => {
  resetClerkFixture();

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'new.staff@example.com',
    isAttendanceOnly: false,
    isNssPersonnel: false,
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
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchStaffType, 'main');
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchIsAttendanceOnly, false);
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchIsNssPersonnel, false);
  assert.equal(calls.createdInvitations[0].publicMetadata.latewatchStaffId, 'staff_1');
  assert.equal(calls.createdInvitations[0].publicMetadata.latewatchStaffType, 'main');
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
    isAttendanceOnly: false,
    isNssPersonnel: false,
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
    isAttendanceOnly: false,
    isNssPersonnel: false,
    staffId: 'staff_3',
    staffName: 'Current Staff',
  });

  assert.equal(result.status, 'invitation_exists');
  assert.equal(calls.revokedInvitations.length, 0);
  assert.equal(calls.createdInvitations.length, 0);
});

test('staff sync stores NSS staff type metadata on existing Clerk users', async () => {
  resetClerkFixture();
  existingUsers = [{
    emailAddress: 'nss.staff@example.com',
    id: 'user_nss',
    privateMetadata: { role: 'staff' },
    publicMetadata: {},
  }];

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'nss.staff@example.com',
    isAttendanceOnly: false,
    isNssPersonnel: true,
    staffId: 'staff_nss',
    staffName: 'NSS Staff',
  });

  assert.equal(result.status, 'already_member');
  assert.equal(calls.updatedMetadata.length, 1);
  assert.deepEqual(calls.updatedMetadata[0].metadata.privateMetadata, {
    role: 'staff',
    latewatchStaffEmail: 'nss.staff@example.com',
    latewatchStaffId: 'staff_nss',
    latewatchStaffName: 'NSS Staff',
    latewatchStaffType: 'nss',
    latewatchIsAttendanceOnly: false,
    latewatchIsNssPersonnel: true,
  });
  assert.equal(calls.updatedMetadata[0].metadata.publicMetadata.latewatchStaffId, 'staff_nss');
  assert.equal(calls.updatedMetadata[0].metadata.publicMetadata.latewatchStaffType, 'nss');
});

test('staff sync stores monitoring-only staff type metadata on invitations', async () => {
  resetClerkFixture();

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'monitor@example.com',
    isAttendanceOnly: true,
    isNssPersonnel: true,
    staffId: 'staff_monitor',
    staffName: 'Monitoring Staff',
  });

  assert.equal(result.status, 'invitation_sent');
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchStaffType, 'monitoring_only');
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchIsAttendanceOnly, true);
  assert.equal(calls.createdInvitations[0].privateMetadata.latewatchIsNssPersonnel, false);
  assert.equal(calls.createdInvitations[0].publicMetadata.latewatchStaffType, 'monitoring_only');
});

test('staff unlink removes Clerk staff type metadata keys', async () => {
  resetClerkFixture();
  existingUsers = [{
    emailAddress: 'old.staff@example.com',
    id: 'user_old',
    privateMetadata: {
      role: 'staff',
      latewatchStaffEmail: 'old.staff@example.com',
      latewatchStaffId: 'staff_old',
      latewatchStaffName: 'Old Staff',
      latewatchStaffType: 'nss',
      latewatchIsAttendanceOnly: false,
      latewatchIsNssPersonnel: true,
    },
    publicMetadata: {
      latewatchStaffId: 'staff_old',
      latewatchStaffType: 'nss',
    },
  }];

  const result = await unlinkStaffEmailIdentity({
    email: 'old.staff@example.com',
    staffId: 'staff_old',
  });

  assert.equal(result.status, 'unlinked');
  assert.equal(calls.updatedMetadata.length, 1);
  assert.deepEqual(calls.updatedMetadata[0].metadata.privateMetadata, { role: 'staff' });
  assert.deepEqual(calls.updatedMetadata[0].metadata.publicMetadata, {});
});
