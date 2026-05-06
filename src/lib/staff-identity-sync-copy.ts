export type StaffIdentitySyncTone = 'error' | 'success' | 'warning';

export type StaffIdentitySyncCopy = {
  detail: string;
  title: string;
  tone: StaffIdentitySyncTone;
};

function displayEmail(value: string | null | undefined) {
  return value?.trim() || 'the staff email';
}

export function getStaffIdentitySyncCopy(input: {
  email?: string | null;
  fallbackMessage?: string | null;
  staffName: string;
  status?: string | null;
}): StaffIdentitySyncCopy {
  const email = displayEmail(input.email);

  switch (input.status) {
    case 'member_added':
      return {
        detail: `${email} already has a Clerk account, so no invitation email was sent. They can sign in with that account now.`,
        title: `${input.staffName}: Existing account linked`,
        tone: 'success',
      };
    case 'already_member':
      return {
        detail: `${email} already has access to LateWatch. Ask them to sign in instead of waiting for a new invitation email.`,
        title: `${input.staffName}: Login already active`,
        tone: 'success',
      };
    case 'invitation_sent':
      return {
        detail: `Clerk created a fresh invitation for ${email}. Ask them to check inbox, spam, and promotions because development-instance emails may be filtered.`,
        title: `${input.staffName}: Invitation email sent`,
        tone: 'success',
      };
    case 'invitation_exists':
      return {
        detail: `Clerk already has a pending invitation for ${email}, so clicking sync again will not send a second email.`,
        title: `${input.staffName}: Invitation already pending`,
        tone: 'warning',
      };
    case 'organization_not_configured':
      return {
        detail: 'Set the Clerk organization ID before syncing staff login access.',
        title: `${input.staffName}: Clerk organization missing`,
        tone: 'error',
      };
    case 'clerk_not_configured':
      return {
        detail: 'Set the Clerk keys before syncing staff login access.',
        title: `${input.staffName}: Clerk is not configured`,
        tone: 'error',
      };
    case 'sync_failed':
      return {
        detail: input.fallbackMessage || 'Clerk could not sync this staff login. Check the server logs or Clerk dashboard.',
        title: `${input.staffName}: Login sync failed`,
        tone: 'error',
      };
    default:
      return {
        detail: input.fallbackMessage || 'Login access was synced with Clerk.',
        title: `${input.staffName}: Login access synced`,
        tone: 'success',
      };
  }
}
