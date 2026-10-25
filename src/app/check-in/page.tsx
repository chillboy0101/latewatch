'use client';

import { UserButton, useClerk, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowLeft, BellRing, Check, CheckCircle2, ChevronRight, History, Loader2, LogOut, MapPin, MoreHorizontal, Printer, ReceiptText, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerNested, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { formatDisplayDateTime, formatShortDisplayDate } from '@/lib/date-format';
import { type LocationValidationResult, validateAttendanceLocation } from '@/lib/geo-location';
import type { OfficeBoundary } from '@/lib/office-boundary';
import { CLEAR_READING_METERS, CLEAR_READING_WAIT_MS, pickReading, rememberReading } from '@/lib/location-readings';
import { RECEIPT_NOTIFICATION_AUTO_DISMISS_MS, type LatenessPaymentReceiptNotification } from '@/lib/lateness-payment-receipt-notifications';
import { useSwipeToDismiss } from '@/lib/use-swipe-to-dismiss';
import { ReceiptDetailView, useReceiptDetail } from '@/components/receipts/receipt-detail-view';
import { pushSubscriptionErrorMessage, vapidPublicKeyToUint8Array } from '@/lib/push-client';
import {
  getEnabledReminderToggleConfirmation,
  type ReminderToggleConfirmation,
} from '@/lib/push-reminder-toggle-confirmation';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';
import { ModePicker } from '@/components/theme/mode-picker';
import { ThemePicker } from '@/components/theme/theme-picker';
import { cn } from '@/lib/utils';
import { CHOICE_SIZE, CHOICE_TEXT } from '@/components/layout/portal-ui';

interface CheckInStatus {
  attendance: {
    id: string;
    checkInAt: string;
    checkInTime: string;
    computedAmount: string;
    reason: string | null;
    signOutAt: string | null;
    signOutTime: string | null;
    signOutNetworkIp: string | null;
    status: 'present' | 'late';
  } | null;
  date: string;
  holidayName: string | null;
  isHoliday: boolean;
  isAfterWorkdayEnd: boolean;
  isOfficeNetwork: boolean;
  isWeekend: boolean;
  locationConfigured: boolean;
  locationPolicy: {
    boundary?: OfficeBoundary | null;
    formattedAddress?: string | null;
    id?: string;
    latitude: string;
    locationKind?: string | null;
    longitude: string;
    maxAccuracyMeters: number;
    name?: string;
    radiusMeters: number;
    scheduleEndDate?: string | null;
    scheduleStartDate?: string | null;
  } | null;
  networkConfigured: boolean;
  officeCodeRequired: boolean;
  device: {
    lastSeenAt: string | null;
    registered: boolean;
    registeredAt: string | null;
    trusted: boolean;
  } | null;
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
  staff: {
    id: string;
    fullName: string;
    email: string | null;
  } | null;
  transferRequest: {
    id: string;
    requestedAt: string | null;
    status: string;
  } | null;
  time: string;
  noSignOutAlertLabel: string;
  signOutStartLabel: string;
  workdayEndLabel: string;
  workdayStartLabel: string;
}

type PenaltyPaymentStatus = 'paid' | 'partially_paid' | 'unpaid' | 'pardoned' | 'partially_pardoned';

interface PushReminderStatus {
  configured: boolean;
  publicKey: string | null;
  subscription: {
    disabledAt: string | null;
    endpoint: string;
    signInEnabled: boolean;
    signOutEnabled: boolean;
    /** Reminders are switched on but the last one sent to this phone was rejected. */
    failing?: boolean;
  } | null;
}

interface PenaltyHistoryEntry {
  arrivalTime: string | null;
  date: string;
  entryId: string;
  outstandingAmount: string;
  pardonedAmount: string;
  paidAmount: string;
  penaltyAmount: string;
  reason: string | null;
  status: PenaltyPaymentStatus;
}

interface PenaltyReceiptSummary {
  amount: string;
  note: string | null;
  paymentId: string;
  receiptNumber: string;
  recordedAt: string | null;
  recordedByEmail: string | null;
  weekEnd: string;
  weekStart: string;
}

interface PenaltyHistoryWeek {
  endDate: string;
  entries: PenaltyHistoryEntry[];
  outstandingBalance: string;
  paidAmount: string;
  receipts: PenaltyReceiptSummary[];
  startDate: string;
  status: PenaltyPaymentStatus;
  totalPenalty: string;
}

interface PenaltyHistoryResponse {
  currentWeek: PenaltyHistoryWeek;
  receipts: PenaltyReceiptSummary[];
  staff: {
    email: string | null;
    fullName: string;
    id: string;
  };
  weeks: PenaltyHistoryWeek[];
}

type LocationEvidence = {
  accuracy: number;
  latitude: number;
  longitude: number;
  timestamp: string;
};

type LiveLocation =
  | { blocking: false; message: string; state: 'idle' }
  | { blocking: false; distanceMeters: number | null; message: string; state: 'inside' }
  | { blocking: false; message: string; state: 'checking' }
  | { blocking: true; distanceMeters?: number | null; message: string; state: 'error' | 'outside' | 'weak' };
type AttendanceAction = 'check_in' | 'sign_out';
type BrowserNotificationPermission = NotificationPermission | 'unsupported';
type LocalCatchUpReminderType = 'sign_in' | 'sign_out';
type DeviceTransferReviewStatus = 'approved' | 'rejected';

const CHECK_IN_FEEDBACK_DISMISS_MS = 4_000;
const LOCAL_CATCH_UP_REMINDER_STORAGE_PREFIX = 'latewatch.local-reminder.v1';
const DEVICE_TRANSFER_REVIEW_STORAGE_PREFIX = 'latewatch.device-transfer-review.v1';
const SIGN_IN_REMINDER_START_MINUTE = 8 * 60 + 15;
// Sign-in closes at 4:30 PM, so the sign-in nudge stops there too.
const SIGN_IN_REMINDER_END_MINUTE = 16 * 60 + 30;
const SIGN_OUT_REMINDER_START_MINUTE = 16 * 60 + 30;
const SIGN_OUT_REMINDER_END_MINUTE = 24 * 60;

function canSignOut(status: CheckInStatus | null) {
  return Boolean(status?.attendance && !status.attendance.signOutTime && status.time?.slice(0, 5) >= '16:30');
}

function attendanceReasonIncludes(status: CheckInStatus | null, text: string) {
  return status?.attendance?.reason?.toUpperCase().includes(text) === true;
}

function hasNoSignOutPenalty(status: CheckInStatus | null) {
  return Boolean(
    status?.attendance &&
    !status.attendance.signOutTime &&
    Number(status.attendance.computedAmount || 0) > 0 &&
    attendanceReasonIncludes(status, 'DID NOT SIGN OUT'),
  );
}

function hasLateCheckInPenalty(status: CheckInStatus | null) {
  if (!status?.attendance || status.attendance.signOutTime) return false;
  if (attendanceReasonIncludes(status, "DIDN'T COME BEFORE")) return true;

  return status.attendance.status === 'late' && !hasNoSignOutPenalty(status);
}

function statusCopy(status: CheckInStatus | null) {
  if (!status) return 'Checking your attendance status';
  if (!status.locationConfigured) return 'Office location not configured';
  if (!status.staff) return 'Profile not matched';
  if (status.device?.registered && !status.device.trusted) return 'Registered device required';
  if (status.permission?.permissionType === 'absence' && !status.attendance) return 'Excused today - check-in optional';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (status.attendance?.signOutTime) return 'Checked out';
  if (hasLateCheckInPenalty(status) && hasNoSignOutPenalty(status)) return 'Late + no sign-out recorded';
  if (hasNoSignOutPenalty(status)) return 'No sign-out recorded';
  if (hasLateCheckInPenalty(status)) return 'Late check-in recorded';
  // On time, or late with an approved permission (stored as "excused").
  if (status.attendance?.checkInTime) return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-ins closed';
  return 'Ready to check in';
}

function locationValue(status: CheckInStatus | null, liveLocation: LiveLocation) {
  if (!status?.locationConfigured) return 'Not set';

  if (liveLocation.state === 'checking') return 'Checking...';
  if (liveLocation.state === 'inside') {
    const distanceLabel = locationDistanceLabel(liveLocation.distanceMeters);

    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span>At office</span>
        {distanceLabel && (
          <>
            <span className="text-current/60">·</span>
            <span>{distanceLabel}</span>
          </>
        )}
      </span>
    );
  }
  if (liveLocation.state === 'outside') return 'Not at office';
  if (liveLocation.state === 'weak') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span>At office</span>
        <span className="text-current/60">·</span>
        <span>weak signal</span>
      </span>
    );
  }
  if (liveLocation.state === 'error') return 'Location needed';

  return (
    <span className="max-w-36 truncate">{status.locationPolicy?.name || 'Office set'}</span>
  );
}

function attendanceButtonLabel(status: CheckInStatus | null, submitting: boolean, liveLocation: LiveLocation) {
  if (submitting) return status?.attendance && !status.attendance.signOutTime ? 'Checking out' : 'Checking in';
  if (status?.attendance?.signOutTime) return 'Already Checked Out';
  if (status?.device?.registered && !status.device.trusted) return 'Registered Device Required';
  if (status?.locationConfigured && liveLocation.blocking) {
    if (liveLocation.state === 'outside') return 'Outside Office';
    if (liveLocation.state === 'weak') return 'Improve GPS Accuracy';
    return 'Location Required';
  }
  if (status?.attendance) return canSignOut(status) ? 'Check Out' : `Check Out Opens ${status.signOutStartLabel.replace(' ', '\u00a0')}` /* keep "4:30 PM" on one line */;
  if (status?.isHoliday) return 'Closed - Holiday';
  if (status?.isWeekend) return 'Closed - Weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - After Hours';
  if (status && !status.locationConfigured) return 'Location Not Configured';
  if (status && !status.staff) return 'Profile Not Matched';
  if (status?.permission?.permissionType === 'absence') return 'Check In (Excused)';
  return 'Check In';
}

// The page's main action (check in / out, device transfer), as tall as the portal choice cards
// (86px) so it is easy to hit with a thumb.
function ActionButton({ busy, disabled, icon: Icon, label, onClick }: {
  busy: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <>
      <Button
        className={cn('w-full gap-2.5 whitespace-normal px-5 text-center font-semibold leading-tight active:brightness-95', CHOICE_SIZE, CHOICE_TEXT)}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {busy ? <Loader2 className="h-[22px] w-[22px] shrink-0 animate-spin" /> : <Icon className="h-[22px] w-[22px] shrink-0" />}
        {label}
      </Button>
      {/* Screen readers hear "Checking in…" while the request runs (the button itself is disabled). */}
      <span className="sr-only" role="status">{busy ? label : ''}</span>
    </>
  );
}

// Every status follows the theme colour.
function statusTone(status: CheckInStatus | null) {
  if (!status) return 'border-border bg-card text-muted-foreground';
  return 'border-primary/25 bg-primary/10 text-primary';
}

function getOrCreateDeviceToken() {
  const storageKey = 'latewatch.attendance.device.v1';
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const token = window.crypto?.randomUUID?.()
    || (window.crypto?.getRandomValues
      ? Array.from(window.crypto.getRandomValues(new Uint8Array(24)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

  window.localStorage.setItem(storageKey, token);
  return token;
}

function locationErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = Number((error as { code?: unknown }).code);
    if (code === 1) return 'Location permission is blocked. Allow location access and try again.';
    if (code === 2) return 'This device could not find its location. Turn on location services and try again.';
    if (code === 3) return 'Location detection took too long. Move to an open area and try again.';
  }

  return error instanceof Error ? error.message : 'Could not read this device location.';
}

async function showReminderToggleConfirmation(confirmation: ReminderToggleConfirmation) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.showNotification !== 'function') return;

    await registration.showNotification(confirmation.title, {
      badge: '/latewatch-logo.png',
      body: confirmation.body,
      data: {
        url: '/check-in',
      },
      icon: '/latewatch-logo.png',
      requireInteraction: false,
      tag: 'latewatch-reminder-toggle-confirmation',
    });
  } catch (error) {
    console.warn('Reminder confirmation could not display:', error);
  }
}

function minutesFromTimeKey(timeKey: string | null | undefined) {
  const [hour = '0', minute = '0'] = (timeKey || '').split(':');

  return Number(hour) * 60 + Number(minute);
}

function localCatchUpReminderStorageKey(status: CheckInStatus, reminderType: LocalCatchUpReminderType) {
  return `${LOCAL_CATCH_UP_REMINDER_STORAGE_PREFIX}:${status.staff?.id || 'unknown'}:${status.date}:${reminderType}`;
}

function getLocalCatchUpReminder(status: CheckInStatus | null, pushStatus: PushReminderStatus | null) {
  if (!status?.staff || status.isWeekend || status.isHoliday) return null;
  if (status.permission?.permissionType === 'absence') return null;
  if (!status.device?.registered || !status.device.trusted) return null;
  if (status.transferRequest?.status === 'pending') return null;

  const subscription = pushStatus?.subscription;
  if (!subscription || subscription.disabledAt) return null;

  const currentMinute = minutesFromTimeKey(status.time);

  if (
    subscription.signInEnabled &&
    !status.attendance &&
    currentMinute >= SIGN_IN_REMINDER_START_MINUTE &&
    currentMinute < SIGN_IN_REMINDER_END_MINUTE
  ) {
    return {
      body: 'Please sign in for today.',
      reminderType: 'sign_in' as const,
      tag: 'latewatch-local-sign-in-reminder',
      title: 'Time to sign in',
    };
  }

  if (
    subscription.signOutEnabled &&
    status.attendance?.checkInTime &&
    !status.attendance.signOutTime &&
    currentMinute >= SIGN_OUT_REMINDER_START_MINUTE &&
    currentMinute < SIGN_OUT_REMINDER_END_MINUTE
  ) {
    return {
      body: 'Please sign out for today.',
      reminderType: 'sign_out' as const,
      tag: 'latewatch-local-sign-out-reminder',
      title: 'Time to sign out',
    };
  }

  return null;
}

function deviceTransferReviewStorageKey(status: CheckInStatus, reviewStatus: DeviceTransferReviewStatus) {
  return `${DEVICE_TRANSFER_REVIEW_STORAGE_PREFIX}:${status.staff?.id || 'unknown'}:${status.transferRequest?.id || 'unknown'}:${reviewStatus}`;
}

function deviceTransferReviewCopy(reviewStatus: DeviceTransferReviewStatus) {
  if (reviewStatus === 'approved') {
    return {
      body: 'You can now use this browser for attendance. Enable reminders again on this device if needed.',
      title: 'Device transfer approved',
    };
  }

  return {
    body: 'Ask an admin if this device should be reviewed again.',
    title: 'Device transfer rejected',
  };
}

async function showDeviceTransferReviewNotification(reviewStatus: DeviceTransferReviewStatus) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.showNotification !== 'function') return;

    const copy = deviceTransferReviewCopy(reviewStatus);
    await registration.showNotification(copy.title, {
      badge: '/latewatch-logo.png',
      body: copy.body,
      data: {
        source: 'device_transfer_review',
        url: '/check-in',
      },
      icon: '/latewatch-logo.png',
      requireInteraction: true,
      tag: `latewatch-device-transfer-${reviewStatus}`,
    });
  } catch (error) {
    console.warn('Device transfer review notification could not display:', error);
  }
}

async function showLocalCatchUpReminder(reminder: NonNullable<ReturnType<typeof getLocalCatchUpReminder>>) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator)) return false;

  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.showNotification !== 'function') return false;

    const options = {
      badge: '/latewatch-logo.png',
      body: reminder.body,
      data: {
        reminderType: reminder.reminderType,
        source: 'local_catch_up',
        url: '/check-in',
      },
      icon: '/latewatch-logo.png',
      renotify: true,
      requireInteraction: true,
      tag: reminder.tag,
    } as NotificationOptions & { renotify: boolean };

    await registration.showNotification(reminder.title, options);

    return true;
  } catch (error) {
    console.warn('Local reminder catch-up could not display:', error);
    return false;
  }
}

function locationStateFromValidation(validation: LocationValidationResult): LiveLocation {
  if (validation.ok) {
    return {
      blocking: false,
      distanceMeters: validation.distanceMeters,
      message: 'At office.',
      state: 'inside',
    };
  }

  if (validation.result === 'OUTSIDE_OFFICE_LOCATION') {
    return { blocking: true, distanceMeters: validation.distanceMeters, message: validation.message, state: 'outside' };
  }

  if (validation.result === 'LOCATION_ACCURACY_WEAK') {
    return { blocking: true, distanceMeters: validation.distanceMeters, message: validation.message, state: 'weak' };
  }

  return { blocking: true, message: validation.message, state: 'error' };
}

function ghc(value: string | number | null | undefined) {
  return `GHC ${Number(value || 0).toFixed(2)}`;
}

/** Every week with penalties, newest first; the current week is also listed in history.weeks. */
function penaltyWeeks(history: PenaltyHistoryResponse | null) {
  return [history?.currentWeek, ...(history?.weeks || [])]
    .filter((week): week is PenaltyHistoryWeek => Boolean(week))
    .filter((week, index, list) => list.findIndex((other) => other.startDate === week.startDate) === index)
    .filter((week) => week.entries.length > 0)
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
}

/** What the person still owes across every week (same figure in the menu and the sheet). */
function penaltyOwed(history: PenaltyHistoryResponse | null) {
  return penaltyWeeks(history).reduce((sum, week) => sum + Number(week.outstandingBalance || 0), 0);
}

function reminderSummary(signIn: boolean, signOut: boolean) {
  if (signIn && signOut) return 'On · 8:15 AM & 4:30 PM';
  if (signIn) return 'Sign-in only · 8:15 AM';
  if (signOut) return 'Sign-out only · 4:30 PM';
  return 'Off';
}

function MenuRow({
  icon,
  onClick,
  status,
  statusClassName,
  title,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  status: string;
  statusClassName?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3.5 px-3.5 py-3 text-left transition-colors hover:bg-foreground/5 active:bg-foreground/10"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">{title}</span>
          <span className={cn('block min-h-4 truncate text-xs text-muted-foreground', statusClassName)}>{status}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function validateLiveLocation(locationPolicy: CheckInStatus['locationPolicy'], evidence: LocationEvidence): LiveLocation {
  if (!locationPolicy) {
    return { blocking: false, message: 'Office location is not set yet.', state: 'idle' };
  }

  return locationStateFromValidation(validateAttendanceLocation({
    evidence,
    now: new Date(),
    office: {
      boundary: locationPolicy.boundary,
      latitude: locationPolicy.latitude,
      longitude: locationPolicy.longitude,
      maxAccuracyMeters: locationPolicy.maxAccuracyMeters,
      radiusMeters: locationPolicy.radiusMeters,
    },
  }));
}

function evidenceFromPosition(position: GeolocationPosition): LocationEvidence {
  return {
    accuracy: position.coords.accuracy,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

async function getCurrentLocationEvidence(): Promise<LocationEvidence> {
  if (!navigator.geolocation) {
    throw new Error('This device does not support location access.');
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
  });

  return evidenceFromPosition(position);
}

// The reading a check-in sends: the clear one the screen already has, at once. Only when the phone
// has nothing clear does it wait (up to 2 s) for a clear reading, then send the best it has.
async function locationForAction(readings: LocationEvidence[]): Promise<LocationEvidence> {
  const ready = pickReading(readings);
  if (ready && ready.accuracy <= CLEAR_READING_METERS) return ready;
  if (!navigator.geolocation) return getCurrentLocationEvidence();

  let askFailed = false;
  navigator.geolocation.getCurrentPosition(
    (position) => rememberReading(readings, evidenceFromPosition(position)),
    () => {
      askFailed = true;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: CLEAR_READING_WAIT_MS },
  );
  const deadline = Date.now() + CLEAR_READING_WAIT_MS;
  while (Date.now() < deadline && !(askFailed && readings.length === 0)) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    const next = pickReading(readings);
    if (next && next.accuracy <= CLEAR_READING_METERS) return next;
  }
  return pickReading(readings) || getCurrentLocationEvidence();
}

export default function CheckInPage() {
  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [penaltyHistory, setPenaltyHistory] = useState<PenaltyHistoryResponse | null>(null);
  const [penaltyHistoryError, setPenaltyHistoryError] = useState<string | null>(null);
  const [penaltyHistoryLoading, setPenaltyHistoryLoading] = useState(false);
  const [penaltyHistoryOpen, setPenaltyHistoryOpen] = useState(false);
  const [receiptNotifications, setReceiptNotifications] = useState<LatenessPaymentReceiptNotification[]>([]);
  const [receiptHistory, setReceiptHistory] = useState<LatenessPaymentReceiptNotification[]>([]);
  const [hiddenToastIds, setHiddenToastIds] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [receiptsDialogOpen, setReceiptsDialogOpen] = useState(false);
  const [remindersDialogOpen, setRemindersDialogOpen] = useState(false);
  const [pushReminderStatus, setPushReminderStatus] = useState<PushReminderStatus | null>(null);
  const [pushReminderLoading, setPushReminderLoading] = useState(false);
  const [savingPushReminder, setSavingPushReminder] = useState(false);
  const [savingReminderKey, setSavingReminderKey] = useState<'signIn' | 'signOut' | 'all' | null>(null);
  // Suppresses the reminder nudge toast for the rest of this session after the
  // user manually turns all reminders off — resets on next app open (page load).
  const [reminderNudgeSuppressed, setReminderNudgeSuppressed] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>('default');
  const [liveLocation, setLiveLocation] = useState<LiveLocation>({
    blocking: false,
    message: 'Waiting for location.',
    state: 'idle',
  });
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const [forcedSessionNotice, setForcedSessionNotice] = useState<string | null>(null);
  // This phone's readings from the last minute (see lib/location-readings).
  const readingsRef = useRef<LocationEvidence[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    setDeviceToken(getOrCreateDeviceToken());
  }, []);

  useEffect(() => {
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  useEffect(() => {
    if (!message) return;

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, CHECK_IN_FEEDBACK_DISMISS_MS);

    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (notificationPermission !== 'granted' || !status) return;

    const reminder = getLocalCatchUpReminder(status, pushReminderStatus);
    if (!reminder) return;

    const storageKey = localCatchUpReminderStorageKey(status, reminder.reminderType);
    if (window.localStorage.getItem(storageKey)) return;

    let cancelled = false;
    window.localStorage.setItem(storageKey, 'pending');

    (async () => {
      const displayed = await showLocalCatchUpReminder(reminder);
      if (displayed && !cancelled) {
        window.localStorage.setItem(storageKey, new Date().toISOString());
      } else if (!displayed && !cancelled) {
        window.localStorage.removeItem(storageKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notificationPermission, pushReminderStatus, status]);

  useEffect(() => {
    if (!status) return;

    const reviewStatus = status?.transferRequest?.status;
    if (reviewStatus !== 'approved' && reviewStatus !== 'rejected') return;

    const storageKey = deviceTransferReviewStorageKey(status, reviewStatus);
    if (window.localStorage.getItem(storageKey)) return;

    window.localStorage.setItem(storageKey, new Date().toISOString());
    setMessage({
      type: reviewStatus === 'approved' ? 'success' : 'error',
      text: reviewStatus === 'approved'
        ? 'Device transfer approved. You can use this browser for attendance now.'
        : 'Device transfer rejected. Ask an admin if this device should be reviewed again.',
    });
    void showDeviceTransferReviewNotification(reviewStatus);
  }, [status]);

  const handleSessionInvalidated = useCallback(() => {
    const text = 'Your device was reset or transferred. Sign in again on the trusted device.';
    setForcedSessionNotice(text);
    setMessage(null);
    window.setTimeout(() => {
      void signOut({ redirectUrl: '/sign-in' });
    }, 1600);
  }, [signOut]);

  const fetchStatus = useCallback(async (options?: { preserveMessage?: boolean; silent?: boolean }) => {
    if (!deviceToken) return;
    if (!options?.silent) setLoading(true);
    if (!options?.preserveMessage) setMessage(null);

    try {
      const response = await fetch('/api/attendance/check-in', {
        cache: 'no-store',
        headers: { 'x-latewatch-device': deviceToken },
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.redirected || response.status === 401 || (!contentType.includes('application/json') && response.url.includes('/sign-in'))) {
        handleSessionInvalidated();
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load check-in status');
      }
      if (!contentType.includes('application/json')) {
        throw new Error('Could not load check-in status');
      }
      setStatus(await response.json());
    } catch (error) {
      console.warn('Check-in status could not load:', error);
      if (!options?.silent) {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load check-in status' });
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [deviceToken, handleSessionInvalidated]);

  const fetchPushReminderStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!isLoaded || !user) return;
    if (!options?.silent) setPushReminderLoading(true);

    try {
      const response = await fetch('/api/attendance/check-in/push-subscription', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load reminder settings');
      setPushReminderStatus(body);
    } catch (error) {
      console.warn('Reminder settings could not load:', error);
      if (!options?.silent) {
        setPushReminderStatus(null);
      }
    } finally {
      if (!options?.silent) setPushReminderLoading(false);
    }
  }, [isLoaded, user]);

  useEffect(() => {
    void fetchPushReminderStatus();
  }, [fetchPushReminderStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const fetchPenaltyHistory = useCallback(async () => {
    setPenaltyHistoryLoading(true);
    setPenaltyHistoryError(null);

    try {
      const response = await fetch('/api/attendance/check-in/penalty-history', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Penalty history failed (${response.status})`);
      setPenaltyHistory(body);
    } catch (error) {
      console.warn('Penalty history could not load:', error);
      setPenaltyHistory(null);
      setPenaltyHistoryError(error instanceof Error ? error.message : 'Could not load penalty history');
    } finally {
      setPenaltyHistoryLoading(false);
    }
  }, []);

  function openPenaltyHistory() {
    setPenaltyHistoryOpen(true);
    void fetchPenaltyHistory();
  }

  const fetchReceiptNotifications = useCallback(async () => {
    if (!isLoaded || !user) return;

    try {
      const response = await fetch('/api/attendance/check-in/receipt-notifications', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Receipt notifications failed (${response.status})`);
      setReceiptNotifications(Array.isArray(body.notifications) ? body.notifications : []);
      setReceiptHistory(Array.isArray(body.receipts) ? body.receipts : []);
    } catch (error) {
      console.warn('Receipt notifications could not load:', error);
    }
  }, [isLoaded, user]);

  const dismissReceiptNotification = useCallback(async (id: string) => {
    setReceiptNotifications((current) => current.filter((notification) => notification.id !== id));
    // Seen now: the receipts list drops its "New" badge straight away.
    setReceiptHistory((current) => current.map((receipt) => (receipt.id === id ? { ...receipt, read: true } : receipt)));

    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', ids: [id] }),
      });
    } catch (error) {
      console.warn('Receipt notification could not be dismissed:', error);
    }
  }, []);

  const openReceiptNotification = useCallback((notification: LatenessPaymentReceiptNotification) => {
    void dismissReceiptNotification(notification.id);
    router.push(notification.href);
  }, [dismissReceiptNotification, router]);

  // Hide a receipt's transient toast without dismissing it — it stays in the
  // ⋮ menu until the user views or dismisses it there.
  const hideReceiptToast = useCallback((id: string) => {
    setHiddenToastIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    void fetchReceiptNotifications();
  }, [fetchReceiptNotifications]);

  useEffect(() => {
    if (!isLoaded || !user) return;

    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'staff-penalty-history',
        events: ['invalidate'],
        onEvent: () => {
          void fetchReceiptNotifications();
        },
      });

      if (mounted) {
        cleanup = unsubscribe;
      } else {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchReceiptNotifications, isLoaded, user]);

  // Register the service worker on load so its static-asset cache is active for
  // every visitor (not only those who enable reminders), speeding up repeat and
  // PWA-open loads.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Returning from a receipt page (Back → /check-in?receipts=1) reopens the ⋮
  // menu and the receipts drawer, then strips the param so it doesn't re-fire.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('receipts') === '1') {
      setMenuOpen(true);
      setReceiptsDialogOpen(true);
      window.history.replaceState({}, '', '/check-in');
    }
  }, []);

  useEffect(() => {
    if (!deviceToken || !isLoaded || !user) return;

    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['attendance', 'notifications'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: () => {
              void fetchStatus({ preserveMessage: true, silent: true });
              void fetchPushReminderStatus({ silent: true });
            },
          }),
        ),
      );

      if (mounted) {
        cleanups = unsubscribers;
      } else {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      }
    })();

    return () => {
      mounted = false;
      cleanups.forEach((unsubscribe) => unsubscribe());
    };
  }, [deviceToken, fetchPushReminderStatus, fetchStatus, isLoaded, user]);

  useEffect(() => {
    if (!deviceToken) return;

    const interval = window.setInterval(() => {
      void fetchStatus({ preserveMessage: true, silent: true });
    }, 30000);

    return () => window.clearInterval(interval);
  }, [deviceToken, fetchStatus]);

  const getPushReminderPublicKey = useCallback(async () => {
    if (pushReminderStatus?.publicKey) return pushReminderStatus.publicKey;

    const response = await fetch('/api/attendance/check-in/push-subscription', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load reminder setup.');

    setPushReminderStatus(body);
    if (body?.publicKey) return body.publicKey as string;

    throw new Error('Reminder setup could not load. Refresh this page and try again.');
  }, [pushReminderStatus?.publicKey]);

  const locationConfigured = Boolean(status?.locationConfigured);
  const locationPolicy = status?.locationPolicy || null;

  useEffect(() => {
    if (!locationConfigured || !locationPolicy || !navigator.geolocation) {
      setLiveLocation(locationConfigured
        ? {
            blocking: true,
            message: 'This browser does not support location tracking.',
            state: 'error',
          }
        : {
            blocking: false,
            message: 'Office location is not set yet.',
            state: 'idle',
          });
      return;
    }

    let active = true;
    setLiveLocation({ blocking: false, message: 'Checking live location...', state: 'checking' });

    const onPosition = (position: GeolocationPosition) => {
      if (!active) return;
      const evidence = evidenceFromPosition(position);
      rememberReading(readingsRef.current, evidence);
      // A momentary vague reading does not undo a clear one from a few seconds before.
      setLiveLocation(validateLiveLocation(locationPolicy, pickReading(readingsRef.current) || evidence));
    };
    const onError = (error: GeolocationPositionError) => {
      if (!active) return;
      setLiveLocation({ blocking: true, message: locationErrorMessage(error), state: 'error' });
    };
    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, options);
    const watchId = navigator.geolocation.watchPosition(onPosition, onError, options);

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [locationConfigured, locationPolicy]);

  const submitAttendance = useCallback(async (options?: { action?: AttendanceAction }) => {
    const action = options?.action || (status?.attendance && !status.attendance.signOutTime ? 'sign_out' : 'check_in');
    setCheckingIn(true);
    setMessage(null);

    try {
      const location = await locationForAction(readingsRef.current);
      const response = await fetch('/api/attendance/check-in', {
        body: JSON.stringify({
          action,
          deviceLabel: navigator.userAgent,
          deviceToken,
          location,
        }),
        headers: {
          'Content-Type': 'application/json',
          ...(deviceToken ? { 'x-latewatch-device': deviceToken } : {}),
        },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Check-in failed');

      setStatus(body);
      setMessage({
        type: 'success',
        text: body.signedOut
          ? 'You have checked out for today.'
          : body.alreadySignedOut
            ? 'You already checked out today.'
            : body.alreadyCheckedIn
              ? 'You already checked in today.'
              : 'You have checked in for today.',
      });
    } catch (error) {
      console.warn('Attendance action could not complete:', error);
      const errorMessage = locationErrorMessage(error);
      await fetchStatus();
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setCheckingIn(false);
    }
  }, [deviceToken, fetchStatus, status]);

  const updatePushReminderSettings = useCallback(async (next: {
    signInEnabled: boolean;
    signOutEnabled: boolean;
  }, source: 'signIn' | 'signOut' | 'all' = 'all', options?: { refresh?: boolean; silent?: boolean }) => {
    // silent: a background repair, so no spinners or messages.
    const silent = options?.silent === true;
    if (!silent) {
      setSavingPushReminder(true);
      setSavingReminderKey(source);
      setMessage(null);
    }

    try {
      if (!deviceToken) {
        throw new Error('Transfer this device before changing reminder notifications.');
      }

      const currentEndpoint = pushReminderStatus?.subscription?.endpoint || null;
      const previousReminderState = {
        signInEnabled: Boolean(pushReminderStatus?.subscription?.signInEnabled && !pushReminderStatus.subscription.disabledAt),
        signOutEnabled: Boolean(pushReminderStatus?.subscription?.signOutEnabled && !pushReminderStatus.subscription.disabledAt),
      };

      if (!next.signInEnabled && !next.signOutEnabled) {
        const registration = await navigator.serviceWorker?.getRegistration('/sw.js');
        const browserSubscription = await registration?.pushManager.getSubscription();
        await browserSubscription?.unsubscribe();

        const response = await fetch('/api/attendance/check-in/push-subscription', {
          body: JSON.stringify({ deviceToken, endpoint: currentEndpoint }),
          headers: {
            'Content-Type': 'application/json',
            'x-latewatch-device': deviceToken,
          },
          method: 'DELETE',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not disable reminders');
        setPushReminderStatus(body);
        setReminderNudgeSuppressed(true);
        setMessage({ type: 'success', text: 'Reminder notifications disabled.' });
        return;
      }

      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotificationPermission('unsupported');
        throw new Error('This browser does not support phone notifications.');
      }

      const publicKey = await getPushReminderPublicKey();

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        throw new Error('Notification permission is blocked for this browser.');
      }

      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      let existingSubscription = await registration.pushManager.getSubscription();
      // A rejected registration is replaced with a fresh one so reminders start arriving again.
      if (options?.refresh && existingSubscription) {
        await existingSubscription.unsubscribe().catch(() => false);
        existingSubscription = null;
      }
      const browserSubscription = existingSubscription || await registration.pushManager.subscribe({
        applicationServerKey: vapidPublicKeyToUint8Array(publicKey),
        userVisibleOnly: true,
      });

      const response = await fetch('/api/attendance/check-in/push-subscription', {
        body: JSON.stringify({
          deviceToken,
          signInEnabled: next.signInEnabled,
          signOutEnabled: next.signOutEnabled,
          subscription: browserSubscription.toJSON(),
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-latewatch-device': deviceToken,
        },
        method: 'PUT',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update reminders');

      setPushReminderStatus(body);
      if (silent) return;
      const enabledReminderConfirmation = getEnabledReminderToggleConfirmation(previousReminderState, next);
      if (enabledReminderConfirmation) {
        void showReminderToggleConfirmation(enabledReminderConfirmation);
      }
      setMessage({ type: 'success', text: 'Reminder notifications updated.' });
    } catch (error) {
      const errorMessage = pushSubscriptionErrorMessage(error);
      console.warn('Reminder settings could not update:', errorMessage);
      if (!silent) setMessage({ type: 'error', text: errorMessage });
      await fetchPushReminderStatus({ silent: true });
    } finally {
      if (!silent) {
        setSavingPushReminder(false);
        setSavingReminderKey(null);
      }
    }
  }, [deviceToken, fetchPushReminderStatus, getPushReminderPublicKey, pushReminderStatus]);

  // Reminders are on but this phone's notification registration has expired, been replaced by
  // the browser, or was rejected on the last send: re-register it quietly, once per visit, so
  // reminders keep arriving without the person doing anything.
  const reminderRepairAttemptedRef = useRef(false);
  useEffect(() => {
    const subscription = pushReminderStatus?.subscription;
    if (reminderRepairAttemptedRef.current || !deviceToken || !subscription || subscription.disabledAt) return;
    if (!subscription.signInEnabled && !subscription.signOutEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    reminderRepairAttemptedRef.current = true;

    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => undefined);
      const browserSubscription = await registration?.pushManager.getSubscription().catch(() => null);
      const failing = subscription.failing === true;
      if (!failing && browserSubscription?.endpoint === subscription.endpoint) return;
      await updatePushReminderSettings(
        { signInEnabled: subscription.signInEnabled, signOutEnabled: subscription.signOutEnabled },
        'all',
        { refresh: failing, silent: true },
      );
    })();
  }, [deviceToken, pushReminderStatus, updatePushReminderSettings]);

  async function requestDeviceTransfer() {
    if (!deviceToken) {
      setMessage({
        type: 'error',
        text: 'This browser could not be identified. Refresh the page and try again.',
      });
      return;
    }

    setRequestingTransfer(true);
    setMessage(null);

    try {
      const location = await locationForAction(readingsRef.current);
      const response = await fetch('/api/attendance/check-in', {
        body: JSON.stringify({
          action: 'request_device_transfer',
          deviceLabel: navigator.userAgent,
          deviceToken,
          location,
          source: 'staff_portal',
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-latewatch-device': deviceToken,
        },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not request device transfer');

      setStatus(body);
      setMessage({ type: 'success', text: 'Device transfer request sent. Ask an admin to approve it.' });
    } catch (error) {
      console.warn('Device transfer request could not complete:', error);
      const errorMessage = locationErrorMessage(error);
      await fetchStatus();
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setRequestingTransfer(false);
    }
  }

  const canCheckIn = Boolean(
    status?.locationConfigured &&
    status.staff &&
    (!status.device?.registered || status.device.trusted) &&
    !status.isHoliday &&
    !status.isWeekend &&
    !status.isAfterWorkdayEnd &&
    !status.attendance,
  );
  const canSubmitSignOut = Boolean(
    status?.locationConfigured &&
    status.staff &&
    (!status.device?.registered || status.device.trusted) &&
    !status.isHoliday &&
    !status.isWeekend &&
    status.attendance &&
    !status.attendance.signOutTime &&
    canSignOut(status),
  );
  const accessNotSetUp = Boolean(status && !status.staff);
  const locationBlocksAction = Boolean(status?.locationConfigured && liveLocation.blocking);
  // A registered but untrusted phone gets the device-transfer button instead of check-in.
  const needsTransfer = Boolean(status?.device?.registered && !status.device.trusted);
  const signInReminderEnabled = Boolean(pushReminderStatus?.subscription?.signInEnabled && !pushReminderStatus.subscription.disabledAt);
  const signOutReminderEnabled = Boolean(pushReminderStatus?.subscription?.signOutEnabled && !pushReminderStatus.subscription.disabledAt);
  const owedNow = penaltyOwed(penaltyHistory);
  const reminderControlsLocked = Boolean(!status?.device?.registered || !status.device.trusted);
  const transferRequestPending = status?.transferRequest?.status === 'pending';

  return (
    <main className="flex h-dvh flex-col overflow-hidden overscroll-none bg-background text-foreground sunray">
      <div className="mx-auto flex h-full w-full max-w-xl flex-col px-3 py-3 sm:px-6 sm:py-4">
        <header className="flex h-12 shrink-0 items-center justify-between sm:h-14">
          <Button
            asChild
            type="button"
            variant="glass"
            size="sm"
            className="h-10 gap-2 rounded-full px-4"
            title="Back to portal chooser"
          >
            <Link href="/">
              <ArrowLeft className="h-5 w-5" />
              <span>Portals</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <ThemePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" iconClassName="h-5 w-5" />

            <ModePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" />
            <Drawer
              open={menuOpen}
              onOpenChange={(next) => {
                setMenuOpen(next);
                // Fresh numbers for the "You owe" line each time the menu opens.
                if (next) void fetchPenaltyHistory();
              }}
            >
              <DrawerTrigger asChild>
                <Button
                  type="button"
                  variant="glass"
                  size="icon"
                  className="relative h-10 w-10 rounded-full"
                  aria-label="More"
                  title="More"
                >
                  <MoreHorizontal className="h-5 w-5" />
                  {receiptNotifications.length > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                  )}
                </Button>
              </DrawerTrigger>
              <DrawerContent className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
                <DrawerTitle className="sr-only">
                  Notifications &amp; settings
                </DrawerTitle>
                <DrawerDescription className="sr-only">
                  Open payment receipts, penalty history, or reminder settings.
                </DrawerDescription>
                <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
                  <MenuRow
                    icon={<ReceiptText className="h-5 w-5" />}
                    title="Payment receipts"
                    onClick={() => setReceiptsDialogOpen(true)}
                    status={receiptNotifications.length > 0 ? `${receiptNotifications.length} new` : 'All seen'}
                    statusClassName={receiptNotifications.length > 0 ? 'font-medium text-primary' : undefined}
                  />
                  <MenuRow
                    icon={<History className="h-5 w-5" />}
                    title="Penalty history"
                    onClick={openPenaltyHistory}
                    status={penaltyHistory ? (owedNow > 0 ? `You owe ${ghc(owedNow)}` : 'Nothing owed') : ''}
                    statusClassName={penaltyHistory ? (owedNow > 0 ? 'text-warning' : 'text-success') : undefined}
                  />
                  <MenuRow
                    icon={<BellRing className="h-5 w-5" />}
                    title="Reminders"
                    onClick={() => setRemindersDialogOpen(true)}
                    status={reminderSummary(signInReminderEnabled, signOutReminderEnabled)}
                    statusClassName={!signInReminderEnabled && !signOutReminderEnabled ? 'text-warning' : undefined}
                  />
                </ul>
              </DrawerContent>

              <PenaltyHistoryDialog
                history={penaltyHistory}
                loading={penaltyHistoryLoading}
                error={penaltyHistoryError}
                onOpenChange={setPenaltyHistoryOpen}
                open={penaltyHistoryOpen}
              />

              <ReceiptsDialog
                notifications={receiptHistory}
                onMarkRead={dismissReceiptNotification}
                onOpenChange={setReceiptsDialogOpen}
                open={receiptsDialogOpen}
              />

              <RemindersDialog
                disabled={!status?.staff || reminderControlsLocked || pushReminderLoading || savingPushReminder}
                signInLoading={pushReminderLoading || savingReminderKey === 'all' || savingReminderKey === 'signIn'}
                signOutLoading={pushReminderLoading || savingReminderKey === 'all' || savingReminderKey === 'signOut'}
                notificationPermission={notificationPermission}
                onOpenChange={setRemindersDialogOpen}
                onToggleCheckIn={() => {
                  void updatePushReminderSettings({
                    signInEnabled: !signInReminderEnabled,
                    signOutEnabled: signOutReminderEnabled,
                  }, 'signIn');
                }}
                onToggleSignOut={() => {
                  void updatePushReminderSettings({
                    signInEnabled: signInReminderEnabled,
                    signOutEnabled: !signOutReminderEnabled,
                  }, 'signOut');
                }}
                open={remindersDialogOpen}
                signInEnabled={signInReminderEnabled}
                signOutEnabled={signOutReminderEnabled}
              />
            </Drawer>
            <UserButton
              appearance={{ elements: { userButtonAvatarBox: 'h-10 w-10 ring-1 ring-border/40' } }}
            />
          </div>
        </header>

        <ReceiptNotificationStack
          notifications={receiptNotifications.filter((notification) => !hiddenToastIds.has(notification.id))}
          onHide={hideReceiptToast}
          onOpen={openReceiptNotification}
        />

        <StatusMessageToast message={message} onDismiss={clearMessage} />

        <div className="flex min-h-0 flex-1 py-3 sm:py-4">
          <Card className="flex h-full w-full flex-col overflow-hidden rounded-2xl">
            {loading || !isLoaded ? (
              <div className="flex h-full items-center justify-center p-4">
                <LoadingBuffer variant="section" label="Loading check-in" description="Verifying your account and location." />
              </div>
            ) : accessNotSetUp ? (
              <div className="flex h-full items-center justify-center">
                <AccessNotSetUp
                  email={user?.primaryEmailAddress?.emailAddress || null}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-5">
                {/* The status card and the details card share the space 6:5, so the page has the same
                    proportions on every phone. The status card is a size container: where container
                    units are supported its badge, text and spacing scale with its height (cqh); older
                    browsers keep the fixed sizes. min-h-48 fits the smallest scaled content, so on very
                    short screens the column scrolls instead of the content spilling out of the card. */}
                <div className={cn('min-h-48 flex-[6] rounded-2xl border [container-type:size]', statusTone(status))}>
                  <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center supports-[height:1cqh]:gap-[clamp(0.5rem,5.5cqh,1.75rem)] supports-[height:1cqh]:p-[clamp(0.75rem,6cqh,2rem)]">
                    {/* A soft halo around one badge: soft fill before, solid with a bold tick once checked in. */}
                    <div className="relative flex size-24 shrink-0 items-center justify-center supports-[height:1cqh]:size-[clamp(3.5rem,25.5cqh,7rem)]">
                      <span aria-hidden className="absolute inset-0 rounded-full bg-current opacity-15" />
                      {status?.attendance ? (
                        <span className="relative flex size-[76%] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/25">
                          <Check className="size-[50%]" strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="relative flex size-[76%] items-center justify-center rounded-full bg-current/20 ring-1 ring-current/30">
                          {canCheckIn ? <ShieldCheck className="size-[50%]" /> : <AlertTriangle className="size-[50%]" />}
                        </span>
                      )}
                    </div>
                    {/* Status, name and location sit at one even spacing. */}
                    <div className="flex max-w-full flex-col items-center gap-4 supports-[height:1cqh]:gap-[clamp(0.375rem,4.3cqh,1.25rem)]">
                      <h2 className="text-2xl font-bold text-balance leading-tight supports-[height:1cqh]:text-[clamp(1.0625rem,6.5cqh,1.875rem)]">{statusCopy(status)}</h2>
                      {status?.staff?.fullName && (
                        <p className="max-w-full truncate text-lg font-semibold leading-tight supports-[height:1cqh]:text-[clamp(0.9375rem,4.9cqh,1.25rem)]">{status.staff.fullName}</p>
                      )}
                      <LocationStatusChip status={status} liveLocation={liveLocation} />
                    </div>
                  </div>
                </div>

                {/* Rows share the card's height evenly; a penalty or a no-charge reason adds a third row.
                    The card never shrinks below its rows, so a long reason scrolls the column instead
                    of running past the border. */}
                <div className="flex flex-[5] flex-col rounded-2xl border border-border bg-card px-4 sm:px-5">
                  <div className="flex min-h-12 flex-1 items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Checked in at</span>
                    <span className="font-mono text-xl font-semibold tabular-nums">{status?.attendance ? status.attendance.checkInTime.slice(0, 5) : '-'}</span>
                  </div>
                  <div className="flex min-h-12 flex-1 items-center justify-between gap-3 border-t border-border">
                    <span className="text-sm text-muted-foreground">Checked out at</span>
                    <span className="font-mono text-xl font-semibold tabular-nums">{status?.attendance?.signOutTime ? status.attendance.signOutTime.slice(0, 5) : '-'}</span>
                  </div>
                  {status?.attendance && Number(status.attendance.computedAmount || 0) > 0 && (
                    <div className="flex min-h-12 flex-1 items-center justify-between gap-3 border-t border-border">
                      <span className="text-sm text-muted-foreground">Penalty</span>
                      <span className="font-mono text-lg font-semibold text-warning tabular-nums">GHC {Number(status.attendance.computedAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {status?.attendance && Number(status.attendance.computedAmount || 0) === 0 && status.attendance.reason && (
                    <div className="flex flex-1 items-center border-t border-border py-3 text-sm text-muted-foreground">
                      {status.attendance.reason}
                    </div>
                  )}
                </div>

                <ReminderPrompt
                  eligible={
                    Boolean(deviceToken)
                    && pushReminderStatus !== null
                    && !reminderNudgeSuppressed
                    && notificationPermission !== 'unsupported'
                    && !reminderControlsLocked
                  }
                  remindersOff={!signInReminderEnabled && !signOutReminderEnabled}
                  failing={pushReminderStatus?.subscription?.failing === true}
                  saving={savingPushReminder}
                  today={status?.date || null}
                  onCustomize={() => { setMenuOpen(true); setRemindersDialogOpen(true); }}
                  onTurnOn={(refresh) => {
                    // A phone that stopped working gets back the reminders the person had chosen;
                    // reminders that were off are all turned on.
                    const chosen = pushReminderStatus?.subscription;
                    const keepChoice = refresh && Boolean(chosen?.signInEnabled || chosen?.signOutEnabled);
                    void updatePushReminderSettings(keepChoice
                      ? { signInEnabled: chosen?.signInEnabled === true, signOutEnabled: chosen?.signOutEnabled === true }
                      : { signInEnabled: true, signOutEnabled: true }, 'all', { refresh });
                  }}
                />

                {forcedSessionNotice && (
                  <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    {forcedSessionNotice}
                  </div>
                )}
                </div>

                <div className="shrink-0 border-t border-border/60 p-3 pt-4 sm:p-4 sm:pt-5">
                  {needsTransfer ? (
                    <ActionButton
                      busy={requestingTransfer}
                      disabled={requestingTransfer || transferRequestPending}
                      icon={ShieldCheck}
                      label={requestingTransfer
                        ? 'Checking location...'
                        : transferRequestPending
                          ? 'Transfer Request Pending'
                          : 'Request Device Transfer'}
                      onClick={requestDeviceTransfer}
                    />
                  ) : (
                    <ActionButton
                      busy={checkingIn}
                      disabled={(!canCheckIn && !canSubmitSignOut) || checkingIn || locationBlocksAction}
                      icon={status?.attendance && !status.attendance.signOutTime ? LogOut : ShieldCheck}
                      label={attendanceButtonLabel(status, checkingIn, liveLocation)}
                      onClick={() => void submitAttendance()}
                    />
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

function PenaltyHistoryDialog({
  error,
  history,
  loading,
  onOpenChange,
  open,
}: {
  error: string | null;
  history: PenaltyHistoryResponse | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const currentWeek = history?.currentWeek || null;
  const weeks = penaltyWeeks(history);
  const owed = penaltyOwed(history);

  return (
    <DrawerNested open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[calc(100dvh-env(safe-area-inset-top)-1rem)] sm:h-[85dvh]">
        <DrawerHeader className="text-center">
          <DrawerTitle>Penalty history</DrawerTitle>
          <DrawerDescription className="sr-only">What you owe and each penalty day.</DrawerDescription>
        </DrawerHeader>

        {loading && !history ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
            <LoadingBuffer variant="section" label="Loading penalty history" />
          </div>
        ) : error && !history ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6">
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          </div>
        ) : weeks.length > 0 ? (
          <div data-vaul-no-drag className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
            <div className="rounded-2xl border border-border bg-background px-4 py-4">
              {owed > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">You owe</p>
                  <p className="mt-0.5 font-mono text-3xl font-semibold tabular-nums text-warning">{ghc(owed)}</p>
                </>
              ) : (
                <p className="flex items-center gap-2 text-lg font-semibold text-success">
                  <CheckCircle2 className="h-5 w-5" />
                  Nothing owed
                </p>
              )}
            </div>

            {weeks.map((week) => (
              <section key={week.startDate}>
                <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{week.startDate === currentWeek?.startDate ? 'This week' : `${formatShortDisplayDate(week.startDate)} – ${formatShortDisplayDate(week.endDate)}`}</span>
                  <span className="font-mono normal-case tracking-normal">{ghc(week.totalPenalty)}</span>
                </div>
                <PenaltyHistoryEntries entries={week.entries} />
              </section>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <History className="h-6 w-6" />
            </span>
            <p className="mt-3 text-base font-semibold text-foreground">No penalties yet</p>
          </div>
        )}
      </DrawerContent>
    </DrawerNested>
  );
}

function locationDistanceLabel(distanceMeters: number | null | undefined) {
  return typeof distanceMeters === 'number' && Number.isFinite(distanceMeters)
    ? `~${Math.round(distanceMeters)}m`
    : null;
}

function locationIcon(liveLocation: LiveLocation) {
  if (liveLocation.state === 'checking') return <Loader2 className="h-4 w-4 animate-spin" />;
  if (liveLocation.state === 'outside' || liveLocation.state === 'error') return <XCircle className="h-4 w-4" />;
  if (liveLocation.state === 'weak') return <AlertTriangle className="h-4 w-4" />;
  return <MapPin className="h-4 w-4" />;
}

function penaltyDayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', weekday: 'short' }).format(new Date(year, month - 1, day));
}

// Penalty reasons are stored in the lateness book's wording ("DIDN'T COME BEFORE 8:30AM ...");
// show them short and plain.
function penaltyReasonLabel(entry: PenaltyHistoryEntry) {
  const reason = (entry.reason || '').toUpperCase();
  const time = entry.arrivalTime?.slice(0, 5);
  const late = time ? `Late · ${time}` : 'Late';
  if (reason.includes("DIDN'T SIGN IN")) return 'No sign-in';
  if (reason.includes("DIDN'T COME BEFORE") && reason.includes('DID NOT SIGN OUT')) return `${late} + no sign-out`;
  if (reason.includes("DIDN'T COME BEFORE")) return late;
  if (reason.includes('DID NOT SIGN OUT')) return 'No sign-out';
  if (reason.startsWith('LATE')) return late;
  if (!entry.reason) return time ? late : 'Penalty';
  return entry.reason.charAt(0).toUpperCase() + entry.reason.slice(1).toLowerCase();
}

function penaltyStatus(entry: PenaltyHistoryEntry) {
  if (entry.status === 'paid') return { className: 'text-success', label: 'Paid' };
  if (entry.status === 'pardoned') return { className: 'text-success', label: 'Pardoned' };
  if (entry.status === 'unpaid') return { className: 'text-danger', label: 'Unpaid' };
  return { className: 'text-warning', label: `${ghc(entry.outstandingAmount)} left` };
}

function PenaltyHistoryEntries({ entries }: { entries: PenaltyHistoryEntry[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
      {entries.map((entry) => {
        const status = penaltyStatus(entry);
        return (
          <li key={entry.entryId} className="flex items-center justify-between gap-3 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{penaltyDayLabel(entry.date)}</p>
              <p className="truncate text-xs text-muted-foreground">{penaltyReasonLabel(entry)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm font-semibold tabular-nums">{ghc(entry.penaltyAmount)}</p>
              <p className={cn('text-xs font-medium', status.className)}>{status.label}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AccessNotSetUp({ email }: { email: string | null }) {
  return (
    <div className="space-y-4 p-4 text-center sm:p-6">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-warning/25 bg-warning/10 text-warning">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">Access not set up</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          This account is not linked to an active staff profile. Ask an admin to add or update your staff email before using attendance.
        </p>
      </div>
      {email && (
        <div className="mx-auto max-w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span className="block text-xs font-medium uppercase text-muted-foreground">Signed in as</span>
          <span className="mt-1 block truncate font-medium">{email}</span>
        </div>
      )}
      <Button asChild variant="outline" className="w-full sm:w-auto">
        <Link href="/">Back to portal</Link>
      </Button>
    </div>
  );
}

function StatusMessageToast({
  message,
  onDismiss,
}: {
  message: { type: 'error' | 'success'; text: string } | null;
  onDismiss: () => void;
}) {
  const { swipeHandlers, swipeStyle } = useSwipeToDismiss(onDismiss);

  // Auto-dismiss ~4s after a new message. `onDismiss` is stable (useCallback in
  // the parent), so the timer resets only when the message changes.
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;
  const success = message.type === 'success';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[100] flex justify-center px-4 sm:inset-x-auto sm:right-4 sm:justify-end">
      <div
        {...swipeHandlers}
        style={swipeStyle}
        className={cn(
          'pointer-events-auto relative flex w-full max-w-sm select-none items-start gap-3 overflow-hidden rounded-xl border bg-card/90 p-3.5 shadow-lg ring-1 backdrop-blur-md animate-in fade-in-0 slide-in-from-top-2 duration-300 ease-out',
          success ? 'border-success/30 ring-success/15' : 'border-danger/30 ring-danger/15',
        )}
        role="status"
      >
        <span className={cn('mt-0.5 shrink-0', success ? 'text-success' : 'text-danger')}>
          {success ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{message.text}</p>
      </div>
    </div>
  );
}

function ReceiptNotificationStack({
  notifications,
  onHide,
  onOpen,
}: {
  notifications: LatenessPaymentReceiptNotification[];
  onHide: (id: string) => void;
  onOpen: (notification: LatenessPaymentReceiptNotification) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end sm:w-96">
      {notifications.map((notification) => (
        <ReceiptNotificationToast
          key={notification.id}
          notification={notification}
          onHide={onHide}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ReceiptNotificationToast({
  notification,
  onHide,
  onOpen,
}: {
  notification: LatenessPaymentReceiptNotification;
  onHide: (id: string) => void;
  onOpen: (notification: LatenessPaymentReceiptNotification) => void;
}) {
  const { swipeHandlers, swipeStyle } = useSwipeToDismiss(() => onHide(notification.id));

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onHide(notification.id);
    }, RECEIPT_NOTIFICATION_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeout);
  }, [notification.id, onHide]);

  return (
    <div
      {...swipeHandlers}
      style={swipeStyle}
      className="pointer-events-auto w-full max-w-sm select-none overflow-hidden rounded-xl border border-border bg-card/90 shadow-lg ring-1 ring-border/60 backdrop-blur-md"
      role="status"
    >
      <div className="flex gap-3 p-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ReceiptText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">Payment receipt ready</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              GHC {Number(notification.amount || 0).toFixed(2)} recorded for {formatDisplayDateTime(notification.recordedAt)}.
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="truncate font-mono text-[11px] font-semibold text-muted-foreground">
              {notification.receiptNumber}
            </span>
            <Button
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => onOpen(notification)}
              size="sm"
              type="button"
            >
              View receipt
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptsDialog({
  notifications,
  onMarkRead,
  onOpenChange,
  open,
}: {
  notifications: LatenessPaymentReceiptNotification[];
  onMarkRead: (id: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBuilding, setPdfBuilding] = useState(false);
  const detail = useReceiptDetail(selectedId ?? '');

  // Pre-build the receipt PDF once the detail loads, so the Print button can share
  // it synchronously inside the click gesture (iOS requires that for navigator.share).
  useEffect(() => {
    let cancelled = false;
    setPdfFile(null);
    if (!detail.receipt) return;

    setPdfBuilding(true);
    (async () => {
      try {
        const { buildReceiptPdfBlob, getReceiptPdfFileName } = await import('@/lib/receipt-pdf');
        const blob = await buildReceiptPdfBlob(detail.receipt!);
        if (cancelled) return;
        setPdfFile(new File([blob], getReceiptPdfFileName(detail.receipt!), { type: 'application/pdf' }));
      } catch (error) {
        if (!cancelled) console.warn('Receipt PDF could not be prepared:', error);
      } finally {
        if (!cancelled) setPdfBuilding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail.receipt]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  };

  const selectReceipt = (notification: LatenessPaymentReceiptNotification) => {
    setSelectedId(notification.paymentId);
    if (!notification.read) void onMarkRead(notification.id);
  };

  const printReceipt = () => {
    if (!pdfFile) return;
    const shareData = { files: [pdfFile], title: pdfFile.name };
    if (typeof navigator !== 'undefined' && navigator.canShare?.(shareData)) {
      // iOS / Android share sheet → Print or Save to Files, without leaving the app.
      void navigator.share(shareData).catch(() => {});
      return;
    }
    // Desktop fallback: download the PDF (opens in the browser's PDF viewer to print).
    const url = URL.createObjectURL(pdfFile);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = pdfFile.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <DrawerNested open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="h-[calc(100dvh-env(safe-area-inset-top)-1rem)] sm:h-[85dvh]">
        {selectedId ? (
          <>
            <DrawerHeader>
              {/* Back on the left, title centred (like the other sheets), Print on the right. */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <button
                  type="button"
                  aria-label="Back to receipts"
                  onClick={() => setSelectedId(null)}
                  className="-ml-1 flex h-10 w-10 items-center justify-center justify-self-start rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <DrawerTitle className="text-center">Receipt</DrawerTitle>
                <div className="justify-self-end">
                  {detail.receipt && (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-2"
                      onClick={printReceipt}
                      disabled={!pdfFile}
                    >
                      {pdfBuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      Print
                    </Button>
                  )}
                </div>
              </div>
              <DrawerDescription className="sr-only">Receipt details.</DrawerDescription>
            </DrawerHeader>
            <div data-vaul-no-drag className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
              <ReceiptDetailView receipt={detail.receipt} loading={detail.loading} error={detail.error} />
            </div>
          </>
        ) : (
          <>
            <DrawerHeader className="text-center">
              <DrawerTitle>Payment receipts</DrawerTitle>
              <DrawerDescription className="sr-only">Receipts for payments recorded on your account.</DrawerDescription>
            </DrawerHeader>
            {notifications.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ReceiptText className="h-6 w-6" />
                </span>
                <p className="mt-3 text-base font-semibold text-foreground">No receipts yet</p>
              </div>
            ) : (
              <div data-vaul-no-drag className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
                  {notifications.map((notification) => (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => selectReceipt(notification)}
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-foreground/5 active:bg-foreground/10"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{ghc(notification.amount)}</p>
                            {!notification.read && (
                              <span className="flex h-5 items-center rounded-full bg-primary px-2 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                                New
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {formatDisplayDateTime(notification.recordedAt)} · <span className="font-mono">{notification.receiptNumber}</span>
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DrawerContent>
    </DrawerNested>
  );
}

function RemindersDialog({
  disabled,
  signInLoading,
  signOutLoading,
  notificationPermission,
  onOpenChange,
  onToggleCheckIn,
  onToggleSignOut,
  open,
  signInEnabled,
  signOutEnabled,
}: {
  disabled: boolean;
  signInLoading: boolean;
  signOutLoading: boolean;
  notificationPermission: BrowserNotificationPermission;
  onOpenChange: (open: boolean) => void;
  onToggleCheckIn: () => void;
  onToggleSignOut: () => void;
  open: boolean;
  signInEnabled: boolean;
  signOutEnabled: boolean;
}) {
  return (
    <DrawerNested open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="text-center">
          <DrawerTitle>Reminders</DrawerTitle>
          <DrawerDescription>Works even when LateWatch is closed.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <ReminderNotificationPanel
            disabled={disabled}
            signInLoading={signInLoading}
            signOutLoading={signOutLoading}
            notificationPermission={notificationPermission}
            signInEnabled={signInEnabled}
            signOutEnabled={signOutEnabled}
            onToggleCheckIn={onToggleCheckIn}
            onToggleSignOut={onToggleSignOut}
          />
        </div>
      </DrawerContent>
    </DrawerNested>
  );
}

const REMINDER_NUDGE_OPTOUT_KEY = 'latewatch-reminder-nudge-optout';
const REMINDER_PROMPT_SEEN_KEY = 'latewatch-reminder-prompt-seen';

// The one reminders pop-up. It appears when both reminders are off, or when they are on but
// can no longer reach this phone, and at most once a day on a device. "Don't remind me" stops
// the "turn on" prompt for good on this device; a failing subscription still gets the daily
// "stopped working" prompt because that person wants reminders.
function ReminderPrompt({
  eligible,
  failing,
  onCustomize,
  onTurnOn,
  remindersOff,
  saving,
  today,
}: {
  eligible: boolean;
  failing: boolean;
  onCustomize: () => void;
  onTurnOn: (refresh: boolean) => void;
  remindersOff: boolean;
  saving: boolean;
  today: string | null;
}) {
  const [closed, setClosed] = useState(false);
  const show = eligible && Boolean(today) && (failing || remindersOff);
  // Read once when it would first appear: already seen today, or opted out of the "turn on" prompt.
  const hidden = useMemo(() => {
    if (!show) return true;
    try {
      if (localStorage.getItem(REMINDER_PROMPT_SEEN_KEY) === today) return true;
      return !failing && localStorage.getItem(REMINDER_NUDGE_OPTOUT_KEY) === '1';
    } catch {
      return false;
    }
  }, [failing, show, today]);
  const open = show && !hidden && !closed;

  // Mark today as seen as soon as it appears, so it shows at most once a day.
  useEffect(() => {
    if (!open || !today) return;
    try {
      localStorage.setItem(REMINDER_PROMPT_SEEN_KEY, today);
    } catch {
      // Storage blocked: it may show again next visit, which is harmless.
    }
  }, [open, today]);

  const optOut = useCallback(() => {
    try {
      localStorage.setItem(REMINDER_NUDGE_OPTOUT_KEY, '1');
    } catch {
      // Ignore storage failures; closing below still hides it for this visit.
    }
    setClosed(true);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reminder-prompt-title">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <BellRing className="h-5 w-5" />
        </div>
        <h3 id="reminder-prompt-title" className="mt-4 text-base font-semibold">
          {failing ? 'Your reminders stopped working' : 'Turn on your reminders'}
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {failing
            ? 'Reminders can’t reach this phone any more. Turn them back on to get a nudge at 8:15 AM to sign in and 4:30 PM to sign out.'
            : 'Get a nudge at 8:15 AM to sign in and 4:30 PM to sign out, even when the app is closed.'}
        </p>
        <div className="mt-5 grid gap-2">
          <Button
            className="h-11 gap-2"
            disabled={saving}
            onClick={() => {
              onTurnOn(failing);
              setClosed(true);
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Turn on reminders
          </Button>
          <Button
            variant="outline"
            className="h-11 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => { onCustomize(); setClosed(true); }}
          >
            Choose reminders
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setClosed(true)}>
            Not now
          </Button>
          {!failing && (
            <button
              type="button"
              onClick={optOut}
              className="mx-auto inline-flex h-9 items-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              Don&apos;t remind me again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReminderNotificationPanel({
  disabled,
  signInLoading,
  signOutLoading,
  notificationPermission,
  onToggleCheckIn,
  onToggleSignOut,
  signInEnabled,
  signOutEnabled,
}: {
  disabled: boolean;
  signInLoading: boolean;
  signOutLoading: boolean;
  notificationPermission: BrowserNotificationPermission;
  onToggleCheckIn: () => void;
  onToggleSignOut: () => void;
  signInEnabled: boolean;
  signOutEnabled: boolean;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
      <ReminderNotificationToggle
        disabled={disabled || notificationPermission === 'unsupported'}
        enabled={signInEnabled}
        label="Sign-in reminder"
        loading={signInLoading}
        onToggle={onToggleCheckIn}
        time="8:15 AM"
      />
      <ReminderNotificationToggle
        disabled={disabled || notificationPermission === 'unsupported'}
        enabled={signOutEnabled}
        label="Sign-out reminder"
        loading={signOutLoading}
        onToggle={onToggleSignOut}
        time="4:30 PM"
      />
    </div>
  );
}

function ReminderNotificationToggle({
  disabled,
  enabled,
  label,
  loading,
  onToggle,
  time,
}: {
  disabled: boolean;
  enabled: boolean;
  label: string;
  loading: boolean;
  onToggle: () => void;
  time: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled || loading}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{time}</span>
      </span>
      {loading ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span
            className={cn(
              'absolute h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
              enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </span>
      )}
    </button>
  );
}

function LocationStatusChip({
  liveLocation,
  status,
}: {
  liveLocation: LiveLocation;
  status: CheckInStatus | null;
}) {
  // Every location state follows the theme colour.
  return (
    <div className="inline-flex h-9 min-w-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 text-sm font-semibold text-primary">
      <span className="shrink-0">{locationIcon(liveLocation)}</span>
      <span className="flex min-w-0 items-center truncate">{locationValue(status, liveLocation)}</span>
    </div>
  );
}
