import 'server-only';

import { createClerkClient } from '@clerk/backend';
import { normalizeStaffEmail } from '@/lib/staff-normalize';

type ClerkClient = ReturnType<typeof createClerkClient>;
type ClerkUser = Awaited<ReturnType<ClerkClient['users']['getUser']>>;
type OrganizationMembershipRole = Parameters<ClerkClient['organizations']['createOrganizationMembership']>[0]['role'];

type SyncStaffIdentityInput = {
  actorUserId?: string | null;
  email: string | null | undefined;
  staffId: string;
  staffName: string;
};

type UnlinkStaffIdentityInput = {
  email: string | null | undefined;
  staffId: string;
};

let cachedOrganizationId: string | null | undefined;

function getClerkClient() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

function getMemberRole() {
  return (process.env.CLERK_ORGANIZATION_MEMBER_ROLE || 'org:member') as OrganizationMembershipRole;
}

function getRedirectUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://latewatch.vercel.app';
  return `${configuredUrl.replace(/\/+$/, '')}/check-in`;
}

function asMetadata(metadata: unknown) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function staffMetadata(input: SyncStaffIdentityInput) {
  return {
    latewatchStaffEmail: normalizeStaffEmail(input.email),
    latewatchStaffId: input.staffId,
    latewatchStaffName: input.staffName,
  };
}

function ownsStaffRecord(user: ClerkUser, staffId: string) {
  return asMetadata(user.privateMetadata).latewatchStaffId === staffId
    || asMetadata(user.publicMetadata).latewatchStaffId === staffId;
}

function isConflict(error: unknown) {
  const details = error as { errors?: Array<{ code?: string; message?: string }>; message?: string; status?: number };
  const text = [
    details.message,
    ...(details.errors || []).flatMap((item) => [item.code, item.message]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return details.status === 409
    || text.includes('already')
    || text.includes('duplicate')
    || text.includes('conflict');
}

async function resolveOrganizationId(client: ClerkClient) {
  const configured = process.env.CLERK_ORGANIZATION_ID || process.env.CLERK_ORG_ID;
  if (configured?.trim()) return configured.trim();

  if (cachedOrganizationId !== undefined) return cachedOrganizationId;

  try {
    const organizations = await client.organizations.getOrganizationList({ limit: 2 });
    cachedOrganizationId = organizations.data.length === 1
      ? organizations.data[0].id
      : null;
  } catch (error) {
    console.warn('Failed to resolve Clerk organization:', error);
    cachedOrganizationId = null;
  }

  return cachedOrganizationId;
}

async function findUserByEmail(client: ClerkClient, email: string) {
  const users = await client.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });

  return users.data[0] || null;
}

async function updateUserStaffMetadata(client: ClerkClient, user: ClerkUser, input: SyncStaffIdentityInput) {
  await client.users.updateUserMetadata(user.id, {
    privateMetadata: {
      ...asMetadata(user.privateMetadata),
      ...staffMetadata(input),
    },
    publicMetadata: {
      ...asMetadata(user.publicMetadata),
      latewatchStaffId: input.staffId,
    },
  });
}

async function ensureMembership(client: ClerkClient, organizationId: string, userId: string) {
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId,
    userId: [userId],
    limit: 1,
  });

  if (memberships.data.length > 0) return 'already_member';

  try {
    await client.organizations.createOrganizationMembership({
      organizationId,
      role: getMemberRole(),
      userId,
    });
    return 'member_added';
  } catch (error) {
    if (isConflict(error)) return 'already_member';
    throw error;
  }
}

async function ensureInvitation(client: ClerkClient, organizationId: string, input: SyncStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return 'no_email';

  try {
    const invitations = await client.organizations.getOrganizationInvitationList({
      organizationId,
      status: ['pending'],
      limit: 100,
    });

    const existingInvitation = invitations.data.find(
      (invitation) => invitation.emailAddress.toLowerCase() === email,
    );

    if (existingInvitation) return 'invitation_exists';
  } catch (error) {
    console.warn('Failed to check existing Clerk organization invitations:', error);
  }

  try {
    await client.organizations.createOrganizationInvitation({
      emailAddress: email,
      expiresInDays: 30,
      inviterUserId: input.actorUserId || undefined,
      organizationId,
      privateMetadata: staffMetadata(input),
      publicMetadata: {
        latewatchStaffId: input.staffId,
      },
      redirectUrl: getRedirectUrl(),
      role: getMemberRole(),
    });
    return 'invitation_sent';
  } catch (error) {
    if (isConflict(error)) return 'invitation_exists';
    throw error;
  }
}

async function removeOwnedMetadata(client: ClerkClient, user: ClerkUser, staffId: string) {
  if (!ownsStaffRecord(user, staffId)) return;

  const privateMetadata = asMetadata(user.privateMetadata);
  const publicMetadata = asMetadata(user.publicMetadata);

  delete privateMetadata.latewatchStaffEmail;
  delete privateMetadata.latewatchStaffId;
  delete privateMetadata.latewatchStaffName;
  delete publicMetadata.latewatchStaffId;

  await client.users.updateUserMetadata(user.id, {
    privateMetadata,
    publicMetadata,
  });
}

async function removeOwnedPendingInvitations(client: ClerkClient, organizationId: string, email: string, staffId: string) {
  const invitations = await client.organizations.getOrganizationInvitationList({
    organizationId,
    status: ['pending'],
    limit: 100,
  });

  const ownedInvitations = invitations.data.filter((invitation) => (
    invitation.emailAddress.toLowerCase() === email
    && (
      asMetadata(invitation.privateMetadata).latewatchStaffId === staffId
      || asMetadata(invitation.publicMetadata).latewatchStaffId === staffId
    )
  ));

  await Promise.all(ownedInvitations.map((invitation) => (
    client.organizations.revokeOrganizationInvitation({
      invitationId: invitation.id,
      organizationId,
    }).catch((error) => {
      if (!isConflict(error)) {
        console.warn('Failed to revoke old Clerk organization invitation:', error);
      }
    })
  )));
}

async function removeOwnedMembership(client: ClerkClient, organizationId: string, user: ClerkUser, staffId: string) {
  if (!ownsStaffRecord(user, staffId)) return;

  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId,
    userId: [user.id],
    limit: 1,
  });

  if (memberships.data.length === 0) return;

  await client.organizations.deleteOrganizationMembership({
    organizationId,
    userId: user.id,
  }).catch((error) => {
    if (!isConflict(error)) {
      console.warn('Failed to remove old Clerk organization membership:', error);
    }
  });
}

export async function syncStaffEmailIdentity(input: SyncStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return { status: 'no_email' };

  const client = getClerkClient();
  if (!client) return { status: 'clerk_not_configured' };

  try {
    const [organizationId, user] = await Promise.all([
      resolveOrganizationId(client),
      findUserByEmail(client, email),
    ]);

    if (user) {
      await updateUserStaffMetadata(client, user, { ...input, email });
      const membershipStatus = organizationId
        ? await ensureMembership(client, organizationId, user.id)
        : 'organization_not_configured';

      return {
        organizationId,
        status: membershipStatus,
        userId: user.id,
      };
    }

    if (!organizationId) return { status: 'organization_not_configured' };

    return {
      organizationId,
      status: await ensureInvitation(client, organizationId, { ...input, email }),
    };
  } catch (error) {
    console.warn('Failed to sync staff email with Clerk organization:', error);
    return { status: 'sync_failed' };
  }
}

export async function unlinkStaffEmailIdentity(input: UnlinkStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return { status: 'no_email' };

  const client = getClerkClient();
  if (!client) return { status: 'clerk_not_configured' };

  try {
    const [organizationId, user] = await Promise.all([
      resolveOrganizationId(client),
      findUserByEmail(client, email),
    ]);

    if (organizationId) {
      await removeOwnedPendingInvitations(client, organizationId, email, input.staffId);
    }

    if (user) {
      if (organizationId) {
        await removeOwnedMembership(client, organizationId, user, input.staffId);
      }

      await removeOwnedMetadata(client, user, input.staffId);
    }

    return { organizationId, status: 'unlinked' };
  } catch (error) {
    console.warn('Failed to unlink old staff email from Clerk organization:', error);
    return { status: 'unlink_failed' };
  }
}
