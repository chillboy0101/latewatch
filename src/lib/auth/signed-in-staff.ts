import 'server-only';

import type { currentUser } from '@clerk/nextjs/server';
import { getStaffByEmail } from '@/lib/attendance';

type SignedInUser = Pick<NonNullable<Awaited<ReturnType<typeof currentUser>>>, 'emailAddresses' | 'primaryEmailAddressId'>;

/**
 * The email addresses this login has proven it owns, primary first. Unverified addresses are
 * ignored: anyone can add one to their account, so they never say who someone is.
 */
export function verifiedEmailAddresses(user: SignedInUser) {
  const verified = user.emailAddresses.filter((address) => address.verification?.status === 'verified');
  const primaryFirst = [
    ...verified.filter((address) => address.id === user.primaryEmailAddressId),
    ...verified.filter((address) => address.id !== user.primaryEmailAddressId),
  ];
  return [...new Set(primaryFirst.map((address) => address.emailAddress.trim().toLowerCase()).filter(Boolean))];
}

/** The current staff member whose email is exactly one of these addresses (checked in order). */
export async function findStaffForEmails(emails: string[]) {
  for (const email of emails) {
    const member = await getStaffByEmail(email);
    if (member) return member;
  }
  return null;
}

/** The staff member signed in on this request, from their verified email addresses only. */
export async function getSignedInStaff(user: SignedInUser) {
  return findStaffForEmails(verifiedEmailAddresses(user));
}
