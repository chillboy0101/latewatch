import { createClerkClient } from '@clerk/backend';
import { NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import { writeAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Temporary maintenance endpoint (admin only): moves everyone out of the legacy Clerk
// organisation now that access comes from the Staff list. GET lists; POST removes.
// Accounts, logins and all LateWatch data are untouched; only organisation memberships and
// pending organisation invitations are removed.

function clerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const organizationId = (process.env.CLERK_ORGANIZATION_ID || process.env.CLERK_ORG_ID || '').trim();
  if (!secretKey || !organizationId) return null;
  return { client: createClerkClient({ secretKey }), organizationId };
}

async function snapshot() {
  const ctx = clerk();
  if (!ctx) return null;
  const [memberships, invitations] = await Promise.all([
    ctx.client.organizations.getOrganizationMembershipList({ organizationId: ctx.organizationId, limit: 100 }),
    ctx.client.organizations.getOrganizationInvitationList({ organizationId: ctx.organizationId, status: ['pending'], limit: 100 }),
  ]);
  return {
    ctx,
    invitations: invitations.data.map((invitation) => ({ email: invitation.emailAddress, id: invitation.id })),
    members: memberships.data.map((membership) => ({
      identifier: membership.publicUserData?.identifier || null,
      role: membership.role,
      userId: membership.publicUserData?.userId || null,
    })),
  };
}

export async function GET() {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  const state = await snapshot();
  if (!state) return NextResponse.json({ error: 'Clerk organisation is not configured' }, { status: 400 });
  return NextResponse.json({ invitations: state.invitations, members: state.members }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST() {
  const authError = await enforceRole(['admin']);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  const state = await snapshot();
  if (!state) return NextResponse.json({ error: 'Clerk organisation is not configured' }, { status: 400 });

  const removed: string[] = [];
  const failed: string[] = [];
  for (const member of state.members) {
    if (!member.userId) continue;
    try {
      await state.ctx.client.organizations.deleteOrganizationMembership({ organizationId: state.ctx.organizationId, userId: member.userId });
      removed.push(member.identifier || member.userId);
    } catch (error) {
      console.error('Failed to remove organisation membership:', error);
      failed.push(member.identifier || member.userId);
    }
  }
  const revoked: string[] = [];
  for (const invitation of state.invitations) {
    try {
      await state.ctx.client.organizations.revokeOrganizationInvitation({ organizationId: state.ctx.organizationId, invitationId: invitation.id });
      revoked.push(invitation.email);
    } catch (error) {
      console.error('Failed to revoke organisation invitation:', error);
      failed.push(invitation.email);
    }
  }

  await writeAuditEvent({
    entityType: 'staff',
    entityId: 'clerk-organization',
    action: 'UPDATE',
    before: { members: state.members.map((member) => member.identifier), pendingInvitations: state.invitations.map((invitation) => invitation.email) },
    after: { failed, removedMembers: removed, revokedInvitations: revoked },
    reason: 'clerk-organization-retired',
  });

  const after = await snapshot();
  return NextResponse.json({ failed, remainingMembers: after?.members.length ?? null, removed, revoked });
}
