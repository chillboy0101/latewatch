export type StaffProfile = {
  email: string | null;
  fullName: string;
  id: string;
};

export type AttendanceRecord = {
  checkInAt: string;
  checkInTime: string;
  computedAmount: string;
  id: string;
  reason: string | null;
  signOutAt: string | null;
  signOutTime: string | null;
  status: 'present' | 'late';
};

export type AttendanceDevice = {
  lastSeenAt: string | null;
  registered: boolean;
  registeredAt: string | null;
  trusted: boolean;
};

export type DeviceTransferRequest = {
  id: string;
  requestedAt: string | null;
  status: string;
};

export type AttendanceStatus = {
  attendance: AttendanceRecord | null;
  date: string;
  device: AttendanceDevice | null;
  holidayName: string | null;
  isAfterWorkdayEnd: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  locationConfigured: boolean;
  locationPolicy: {
    latitude: string;
    longitude: string;
    maxAccuracyMeters: number;
    radiusMeters: number;
  } | null;
  noSignOutAlertLabel: string;
  permission: {
    arrivalWindow: string | null;
    date: string;
    expectedEndTime: string | null;
    expectedStartTime: string | null;
    id: string;
    permissionType: string;
    reason: string;
    status: string;
  } | null;
  signedOut?: boolean;
  staff: StaffProfile | null;
  success?: boolean;
  time: string;
  transferRequest: DeviceTransferRequest | null;
  workdayEndLabel: string;
  signOutStartLabel: string;
  workdayStartLabel: string;
};

export type LocationEvidence = {
  accuracy: number;
  latitude: number;
  longitude: number;
  mocked?: boolean;
  timestamp: string;
};
