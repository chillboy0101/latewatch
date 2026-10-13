import 'server-only';

import { createClerkClient } from '@clerk/backend';
import {
  CLERK_PRIVATE_STAFF_METADATA_KEYS,
  CLERK_PUBLIC_STAFF_METADATA_KEYS,
  clerkStaffPrivateMetadata,
  clerkStaffPublicMetadata,
} from '@/lib/clerk-staff-metadata';
import { normalizeStaffEmail } from '@/lib/staff-normalize';
import { getSiteUrl } from '@/lib/site-metadata';

type ClerkClient = ReturnType<typeof createClerkClient>;
type ClerkUser = Awaited<ReturnType<ClerkClient['users']['getUser']>>;

type SyncStaffIdentityInput = {
  actorUserId?: string | null;
  email: string | null | undefined;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  staffId: string;
  staffName: string;
};

type UnlinkStaffIdentityInput = {
  email: string | null | undefined;
  /**
   * Archiving: free this person's organisation seat even when their Clerk account predates the
   * LateWatch metadata. The account is matched by the staff record's own email.
   */
  releaseSeat?: boolean;
  staffId: string;
};

let cachedOrganizationId: string | null | undefined;

function getClerkClient() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}


function getInvitationRedirectUrl() {
  const searchParams = new URLSearchParams({
    redirect_url: getSiteUrl('/check-in'),
  });

  return getSiteUrl(`/sign-up?${searchParams.toString()}`);
}

function asMetadata(metadata: unknown) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function staffMetadata(input: SyncStaffIdentityInput) {
  return clerkStaffPrivateMetadata(input);
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
      ...clerkStaffPublicMetadata(input),
    },
  });
}

// New staff are invited to the LateWatch app itself (sign-up stays invite-only). Unlike an
// organisation invitation this needs no organisation seat, so the free plan's 20-seat cap
// never blocks onboarding. Access is then granted by the Staff list (see auth/staff-access).
async function ensureAppInvitation(client: ClerkClient, input: SyncStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return 'no_email';

  const pending = await client.invitations.getInvitationList({ query: email, status: 'pending' })
    .then((result) => result.data.filter((invitation) => invitation.emailAddress.toLowerCase() === email))
    .catch(() => []);
  if (pending.length > 0) return 'invitation_exists';

  try {
    await client.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: 30,
      publicMetadata: clerkStaffPublicMetadata(input),
      redirectUrl: getInvitationRedirectUrl(),
    });
    return 'invitation_sent';
  } catch (error) {
    if (isConflict(error)) return 'invitation_exists';
    throw error;
  }
}

async function revokePendingAppInvitations(client: ClerkClient, email: string) {
  const pending = await client.invitations.getInvitationList({ query: email, status: 'pending' })
    .then((result) => result.data.filter((invitation) => invitation.emailAddress.toLowerCase() === email))
    .catch(() => []);
  await Promise.all(pending.map((invitation) => client.invitations.revokeInvitation(invitation.id).catch((error) => {
    if (!isConflict(error)) console.warn('Failed to revoke LateWatch app invitation:', error);
  })));
}

async function removeOwnedMetadata(client: ClerkClient, user: ClerkUser, staffId: string) {
  if (!ownsStaffRecord(user, staffId)) return;

  const privateMetadata = asMetadata(user.privateMetadata);
  const publicMetadata = asMetadata(user.publicMetadata);

  CLERK_PRIVATE_STAFF_METADATA_KEYS.forEach((key) => {
    delete privateMetadata[key];
  });
  CLERK_PUBLIC_STAFF_METADATA_KEYS.forEach((key) => {
    delete publicMetadata[key];
  });

  await client.users.updateUserMetadata(user.id, {
    privateMetadata,
    publicMetadata,
  });
}

async function removeOwnedPendingInvitations(client: ClerkClient, organizationId: string, email: string, staffId: string, anyForEmail = false) {
  const invitations = await client.organizations.getOrganizationInvitationList({
    organizationId,
    status: ['pending'],
    limit: 100,
  });

  const ownedInvitations = invitations.data.filter((invitation) => (
    invitation.emailAddress.toLowerCase() === email
    && (
      anyForEmail
      || asMetadata(invitation.privateMetadata).latewatchStaffId === staffId
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

async function removeOwnedMembership(client: ClerkClient, organizationId: string, user: ClerkUser, staffId: string, force = false) {
  if (!force && !ownsStaffRecord(user, staffId)) return false;

  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId,
    userId: [user.id],
    limit: 1,
  });

  if (memberships.data.length === 0) return false;

  return client.organizations.deleteOrganizationMembership({
    organizationId,
    userId: user.id,
  }).then(() => true).catch((error) => {
    if (!isConflict(error)) {
      console.warn('Failed to remove old Clerk organization membership:', error);
    }
    return false;
  });
}

export async function syncStaffEmailIdentity(input: SyncStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return { status: 'no_email' };

  const client = getClerkClient();
  if (!client) return { status: 'clerk_not_configured' };

  try {
    const user = await findUserByEmail(client, email);

    // Existing account: link it to the staff record. Access itself comes from the Staff list,
    // so no Clerk organisation is involved.
    if (user) {
      await updateUserStaffMetadata(client, user, { ...input, email });
      return { status: 'linked', userId: user.id };
    }

    return { status: await ensureAppInvitation(client, { ...input, email }) };
  } catch (error) {
    console.warn('Failed to sync staff email with Clerk:', error);
    return { status: 'sync_failed' };
  }
}

export async function unlinkStaffEmailIdentity(input: UnlinkStaffIdentityInput) {
  const email = normalizeStaffEmail(input.email);
  if (!email) return { status: 'no_email' };

  const client = getClerkClient();
  if (!client) return { status: 'clerk_not_configured' };

  try {
    const user = await findUserByEmail(client, email);
    await revokePendingAppInvitations(client, email);

    // Leftovers from the old organisation setup: clean up quietly if it still exists.
    let seatReleased = false;
    const organizationId = await resolveOrganizationId(client).catch(() => null);
    if (organizationId) {
      await removeOwnedPendingInvitations(client, organizationId, email, input.staffId, input.releaseSeat === true).catch(() => undefined);
      if (user) {
        seatReleased = await removeOwnedMembership(client, organizationId, user, input.staffId, input.releaseSeat === true).catch(() => false);
      }
    }

    if (user) {
      await removeOwnedMetadata(client, user, input.staffId);
    }

    return { organizationId, seatReleased, status: 'unlinked' };
  } catch (error) {
    console.warn('Failed to unlink old staff email from Clerk organization:', error);
    return { status: 'unlink_failed' };
  }
}
