/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

let pendingInvitations = [];
let pendingAppInvitations = [];
let existingUsers = [];
let membershipFull = false;
const calls = {
  createdAppInvitations: [],
  revokedAppInvitations: [],
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
    createOrganizationMembership: async () => {
      if (membershipFull) throw Object.assign(new Error('organization membership quota exceeded'), { status: 403 });
      return null;
    },
    deleteOrganizationMembership: async (params) => {
      calls.deletedMemberships.push(params);
      return {};
    },
    getOrganizationInvitationList: async () => ({ data: pendingInvitations }),
    getOrganizationList: async () => ({ data: [{ id: 'org_test' }] }),
    getOrganizationMembershipList: async () => ({ data: membershipFull ? [] : [{ id: 'membership_1' }] }),
    revokeOrganizationInvitation: async (params) => {
      calls.revokedInvitations.push(params);
      pendingInvitations = pendingInvitations.filter((invitation) => invitation.id !== params.invitationId);
      return {};
    },
  },
  invitations: {
    createInvitation: async (params) => {
      calls.createdAppInvitations.push(params);
      pendingAppInvitations.push({ emailAddress: params.emailAddress, id: `ainv_${calls.createdAppInvitations.length}` });
      return pendingAppInvitations[pendingAppInvitations.length - 1];
    },
    getInvitationList: async () => ({ data: pendingAppInvitations }),
    revokeInvitation: async (invitationId) => {
      calls.revokedAppInvitations.push(invitationId);
      pendingAppInvitations = pendingAppInvitations.filter((invitation) => invitation.id !== invitationId);
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
  calls.createdAppInvitations = [];
  calls.revokedAppInvitations = [];
  pendingAppInvitations = [];
  membershipFull = false;
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

test('staff sync invites new staff to the app (no organisation seat needed) via the invite-aware sign-up page', async () => {
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
  assert.equal(calls.createdInvitations.length, 0, 'no organisation invitation (would need a seat)');
  assert.equal(calls.createdAppInvitations.length, 1);
  assert.equal(
    calls.createdAppInvitations[0].redirectUrl,
    'https://latewatch.example/sign-up?redirect_url=https%3A%2F%2Flatewatch.example%2Fcheck-in',
  );
  assert.equal(calls.createdAppInvitations[0].emailAddress, 'new.staff@example.com');
  assert.equal(calls.createdAppInvitations[0].publicMetadata.latewatchStaffId, 'staff_1');
  assert.equal(calls.createdAppInvitations[0].publicMetadata.latewatchStaffType, 'main');
});

test('staff sync keeps a pending app invitation instead of sending a duplicate', async () => {
  resetClerkFixture();
  pendingAppInvitations = [{ emailAddress: 'current.staff@example.com', id: 'ainv_current' }];

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'current.staff@example.com',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    staffId: 'staff_3',
    staffName: 'Current Staff',
  });

  assert.equal(result.status, 'invitation_exists');
  assert.equal(calls.createdAppInvitations.length, 0);
});

test('existing accounts are linked without any organisation membership', async () => {
  resetClerkFixture();
  existingUsers = [{ emailAddress: 'late.joiner@example.com', id: 'user_late', privateMetadata: {}, publicMetadata: {} }];

  const result = await syncStaffEmailIdentity({
    actorUserId: 'user_admin',
    email: 'late.joiner@example.com',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    staffId: 'staff_late',
    staffName: 'Late Joiner',
  });

  assert.equal(result.status, 'linked');
  assert.equal(calls.updatedMetadata.length, 1, 'staff metadata is linked');
  assert.equal(calls.createdInvitations.length, 0);
});

test('archiving revokes pending app invitations for that email', async () => {
  resetClerkFixture();
  pendingAppInvitations = [{ emailAddress: 'leaver@example.com', id: 'ainv_leaver' }];

  const result = await unlinkStaffEmailIdentity({ email: 'leaver@example.com', releaseSeat: true, staffId: 'staff_leaver' });

  assert.equal(result.status, 'unlinked');
  assert.deepEqual(calls.revokedAppInvitations, ['ainv_leaver']);
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

  assert.equal(result.status, 'linked');
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
  assert.equal(calls.createdAppInvitations[0].publicMetadata.latewatchStaffType, 'monitoring_only');
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
