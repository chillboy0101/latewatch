import { normalizeStaffEmail } from './staff-normalize';

export type LatewatchStaffType = 'main' | 'monitoring_only' | 'nss';

export type ClerkStaffMetadataInput = {
  email: string | null | undefined;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  staffId: string;
  staffName: string;
};

export const CLERK_PRIVATE_STAFF_METADATA_KEYS = [
  'latewatchStaffEmail',
  'latewatchStaffId',
  'latewatchStaffName',
  'latewatchStaffType',
  'latewatchIsNssPersonnel',
  'latewatchIsAttendanceOnly',
] as const;

export const CLERK_PUBLIC_STAFF_METADATA_KEYS = [
  'latewatchStaffId',
  'latewatchStaffType',
] as const;

export function getLatewatchStaffType(input: Pick<ClerkStaffMetadataInput, 'isAttendanceOnly' | 'isNssPersonnel'>): LatewatchStaffType {
  if (input.isAttendanceOnly === true) return 'monitoring_only';
  if (input.isNssPersonnel === true) return 'nss';
  return 'main';
}

export function clerkStaffPrivateMetadata(input: ClerkStaffMetadataInput) {
  const isAttendanceOnly = input.isAttendanceOnly === true;
  const isNssPersonnel = isAttendanceOnly ? false : input.isNssPersonnel === true;

  return {
    latewatchStaffEmail: normalizeStaffEmail(input.email),
    latewatchStaffId: input.staffId,
    latewatchStaffName: input.staffName,
    latewatchStaffType: getLatewatchStaffType({ isAttendanceOnly, isNssPersonnel }),
    latewatchIsNssPersonnel: isNssPersonnel,
    latewatchIsAttendanceOnly: isAttendanceOnly,
  };
}

export function clerkStaffPublicMetadata(input: ClerkStaffMetadataInput) {
  const privateMetadata = clerkStaffPrivateMetadata(input);

  return {
    latewatchStaffId: privateMetadata.latewatchStaffId,
    latewatchStaffType: privateMetadata.latewatchStaffType,
  };
}
