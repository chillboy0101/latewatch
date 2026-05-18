'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, LogOut, MapPin, Moon, ReceiptText, ShieldCheck, Sun, XCircle } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { getPermissionWindowBounds, isPermissionWindowOverdue } from '@/lib/attendance-permissions';
import { resolveAutoAttendanceAction } from '@/lib/auto-attendance';
import { type LocationValidationResult, validateAttendanceLocation } from '@/lib/geo-location';
import { applyThemePreference, getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';
import { cn } from '@/lib/utils';

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
    autoCheckInEnabled: boolean;
    autoSignOutEnabled: boolean;
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

type PenaltyPaymentStatus = 'paid' | 'partially_paid' | 'unpaid';

interface PenaltyHistoryEntry {
  arrivalTime: string | null;
  date: string;
  entryId: string;
  outstandingAmount: string;
  paidAmount: string;
  penaltyAmount: string;
  reason: string | null;
  status: PenaltyPaymentStatus;
}

interface PenaltyHistoryWeek {
  endDate: string;
  entries: PenaltyHistoryEntry[];
  outstandingBalance: string;
  paidAmount: string;
  startDate: string;
  status: PenaltyPaymentStatus;
  totalPenalty: string;
}

interface PenaltyHistoryResponse {
  currentWeek: PenaltyHistoryWeek;
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
type AttendanceSource = 'auto_attendance' | 'staff_portal';

function canSignOut(status: CheckInStatus | null) {
  return Boolean(status?.attendance && !status.attendance.signOutTime && status.time?.slice(0, 5) >= '16:30');
}

function statusCopy(status: CheckInStatus | null) {
  if (!status) return 'Checking your attendance status';
  if (!status.locationConfigured) return 'Office location not configured';
  if (!status.staff) return 'Profile not matched';
  if (status.device?.registered && !status.device.trusted) return 'Registered device required';
  if (status.permission?.permissionType === 'absence') return 'Permission recorded';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (status.attendance?.signOutTime) return 'Checked out';
  if (status.attendance?.status === 'late') return 'Late check-in recorded';
  if (status.attendance?.status === 'present') return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-ins closed';
  return 'Ready to check in';
}

function statusDetail(status: CheckInStatus | null, fallbackName: string | null | undefined) {
  const person = status?.staff?.fullName || fallbackName || 'Signed-in user';
  if (!status) return 'Verifying your account, location, and today\'s work calendar.';
  if (!status.locationConfigured) return 'Ask an admin to save the office location before staff check in.';
  if (!status.staff) return 'Your login could not be matched to a staff profile yet. Ask an admin to confirm your staff email or staff name.';
  if (status.device?.registered && !status.device.trusted) return status.transferRequest
    ? 'Your device transfer request is waiting for admin approval.'
    : 'This account is linked to another device. Request a device transfer from this browser.';
  if (status.permission?.permissionType === 'absence') return 'You have an approved absence for today. No check-in is required.';
  if (status.isHoliday) return 'Check-ins are disabled today in observance of the public holiday.';
  if (status.isWeekend) return 'You cannot check in today because attendance check-in is closed on weekends.';
  if (status.attendance?.signOutTime) return `${person}, you have checked out for today.`;
  if (status.attendance && !canSignOut(status)) return `You can check out from ${status.signOutStartLabel}.`;
  if (status.attendance?.status === 'late') return `${person}, your late check-in has been recorded.`;
  if (status.attendance?.status === 'present') return `${person}, you are checked in for today.`;
  if (status.isAfterWorkdayEnd) return `Check-ins are closed after ${status.workdayEndLabel}. Ask an admin to correct attendance if needed.`;
  if (status.permission?.permissionType === 'late_arrival') {
    const window = getPermissionWindowBounds(status.permission);
    const overdue = isPermissionWindowOverdue(status.permission, status.date, status.date, status.time);
    return overdue
      ? `Your approved ${window.label.toLowerCase()} window has passed. Checking in now will be recorded as late.`
      : `Your late arrival is approved for ${window.label.toLowerCase()}.`;
  }
  return `${person}, you can check in now.`;
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

function locationTone(liveLocation: LiveLocation) {
  if (liveLocation.state === 'inside') return 'success';
  if (liveLocation.state === 'outside' || liveLocation.state === 'error') return 'danger';
  if (liveLocation.state === 'weak') return 'warning';
  return 'neutral';
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
  if (status?.attendance) return canSignOut(status) ? 'Check Out' : `Check Out Opens ${status.signOutStartLabel}`;
  if (status?.isHoliday) return 'Closed - Holiday';
  if (status?.isWeekend) return 'Closed - Weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - After Hours';
  if (status && !status.locationConfigured) return 'Location Not Configured';
  if (status && !status.staff) return 'Profile Not Matched';
  if (status?.permission?.permissionType === 'absence') return 'Excused - No Check-In';
  return 'Check In';
}

function statusTone(status: CheckInStatus | null) {
  if (!status) return 'border-border bg-card text-muted-foreground';
  if (status.attendance?.signOutTime) return 'border-success/25 bg-success/10 text-success';
  if (status.attendance?.status === 'present') return 'border-success/25 bg-success/10 text-success';
  if (status.attendance?.status === 'late') return 'border-warning/25 bg-warning/10 text-warning';
  if (status.permission?.permissionType === 'absence') return 'border-primary/25 bg-primary/10 text-primary';
  if (!status.locationConfigured || !status.staff || (status.device?.registered && !status.device.trusted) || status.isHoliday || status.isWeekend) {
    return 'border-warning/25 bg-warning/10 text-warning';
  }
  if (status.isAfterWorkdayEnd) return 'border-warning/25 bg-warning/10 text-warning';
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

function paymentStatusLabel(status: PenaltyPaymentStatus) {
  if (status === 'paid') return 'Paid';
  if (status === 'partially_paid') return 'Partially paid';
  return 'Unpaid';
}

function validateLiveLocation(locationPolicy: CheckInStatus['locationPolicy'], evidence: LocationEvidence): LiveLocation {
  if (!locationPolicy) {
    return { blocking: false, message: 'Office location is not set yet.', state: 'idle' };
  }

  return locationStateFromValidation(validateAttendanceLocation({
    evidence,
    now: new Date(),
    office: {
      latitude: locationPolicy.latitude,
      longitude: locationPolicy.longitude,
      maxAccuracyMeters: locationPolicy.maxAccuracyMeters,
      radiusMeters: locationPolicy.radiusMeters,
    },
  }));
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

  return {
    accuracy: position.coords.accuracy,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

export default function CheckInPage() {
  const { isLoaded, user } = useUser();
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [autoAttendanceAction, setAutoAttendanceAction] = useState<AttendanceAction | null>(null);
  const [lastAutoActionAt, setLastAutoActionAt] = useState<number | null>(null);
  const [savingAutoSettings, setSavingAutoSettings] = useState(false);
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [penaltyHistory, setPenaltyHistory] = useState<PenaltyHistoryResponse | null>(null);
  const [penaltyHistoryError, setPenaltyHistoryError] = useState<string | null>(null);
  const [penaltyHistoryLoading, setPenaltyHistoryLoading] = useState(false);
  const [penaltyHistoryOpen, setPenaltyHistoryOpen] = useState(false);
  const [liveLocation, setLiveLocation] = useState<LiveLocation>({
    blocking: false,
    message: 'Waiting for location.',
    state: 'idle',
  });
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    setDeviceToken(getOrCreateDeviceToken());
  }, []);

  const fetchStatus = useCallback(async (options?: { preserveMessage?: boolean; silent?: boolean }) => {
    if (!deviceToken) return;
    if (!options?.silent) setLoading(true);
    if (!options?.preserveMessage) setMessage(null);

    try {
      const response = await fetch('/api/attendance/check-in', {
        cache: 'no-store',
        headers: { 'x-latewatch-device': deviceToken },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load check-in status');
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
  }, [deviceToken]);

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

  useEffect(() => {
    if (!deviceToken) return;

    const interval = window.setInterval(() => {
      void fetchStatus({ preserveMessage: true, silent: true });
    }, 30000);

    return () => window.clearInterval(interval);
  }, [deviceToken, fetchStatus]);

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
      setLiveLocation(validateLiveLocation(locationPolicy, {
        accuracy: position.coords.accuracy,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: new Date(position.timestamp).toISOString(),
      }));
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

  const submitAttendance = useCallback(async (options?: { action?: AttendanceAction; source?: AttendanceSource }) => {
    const action = options?.action || (status?.attendance && !status.attendance.signOutTime ? 'sign_out' : 'check_in');
    const source = options?.source || 'staff_portal';
    const isAutoAttendance = source === 'auto_attendance';
    if (isAutoAttendance) {
      setAutoAttendanceAction(action);
    } else {
      setCheckingIn(true);
    }
    setMessage(null);

    try {
      const location = await getCurrentLocationEvidence();
      const response = await fetch('/api/attendance/check-in', {
        body: JSON.stringify({
          action,
          deviceLabel: navigator.userAgent,
          deviceToken,
          location,
          source,
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
        text: isAutoAttendance
          ? action === 'sign_out'
            ? 'Auto sign-out complete.'
            : 'Auto check-in complete.'
          : body.signedOut
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
      await fetchStatus({ preserveMessage: isAutoAttendance, silent: isAutoAttendance });
      if (!isAutoAttendance) {
        setMessage({ type: 'error', text: errorMessage });
      }
    } finally {
      if (isAutoAttendance) {
        setAutoAttendanceAction(null);
      } else {
        setCheckingIn(false);
      }
    }
  }, [deviceToken, fetchStatus, status]);

  const updateAutoAttendanceSettings = useCallback(async (next: {
    autoCheckInEnabled: boolean;
    autoSignOutEnabled: boolean;
  }) => {
    if (!deviceToken) return;

    setSavingAutoSettings(true);
    setMessage(null);

    try {
      const response = await fetch('/api/attendance/check-in/auto-settings', {
        body: JSON.stringify({
          ...next,
          deviceToken,
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-latewatch-device': deviceToken,
        },
        method: 'PATCH',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update auto attendance');

      setStatus((current) => current
        ? {
            ...current,
            device: current.device
              ? {
                  ...current.device,
                  autoCheckInEnabled: Boolean(body.device?.autoCheckInEnabled),
                  autoSignOutEnabled: Boolean(body.device?.autoSignOutEnabled),
                  lastSeenAt: body.device?.lastSeenAt || current.device.lastSeenAt,
                  registered: Boolean(body.device?.registered ?? current.device.registered),
                  registeredAt: body.device?.registeredAt || current.device.registeredAt,
                  trusted: Boolean(body.device?.trusted ?? current.device.trusted),
                }
              : body.device || null,
          }
        : current);
      setMessage({ type: 'success', text: 'Auto attendance updated.' });
    } catch (error) {
      console.warn('Auto attendance settings could not update:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not update auto attendance' });
      await fetchStatus({ preserveMessage: true, silent: true });
    } finally {
      setSavingAutoSettings(false);
    }
  }, [deviceToken, fetchStatus]);

  async function requestDeviceTransfer() {
    if (!deviceToken) return;

    setRequestingTransfer(true);
    setMessage(null);

    try {
      const location = await getCurrentLocationEvidence();
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

  function toggleTheme() {
    applyThemePreference(isDark ? 'light' : 'dark');
  }

  const canCheckIn = Boolean(
    status?.locationConfigured &&
    status.staff &&
    (!status.device?.registered || status.device.trusted) &&
    !status.isHoliday &&
    !status.isWeekend &&
    !status.isAfterWorkdayEnd &&
    status.permission?.permissionType !== 'absence' &&
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
  const autoDeviceReady = Boolean(status?.staff && status.device?.registered && status.device.trusted);

  useEffect(() => {
    if (!autoDeviceReady || checkingIn || autoAttendanceAction || savingAutoSettings) return;

    const action = resolveAutoAttendanceAction({
      autoCheckInEnabled: Boolean(status?.device?.autoCheckInEnabled),
      autoSignOutEnabled: Boolean(status?.device?.autoSignOutEnabled),
      canCheckIn: autoDeviceReady && canCheckIn,
      canSubmitSignOut: autoDeviceReady && canSubmitSignOut,
      lastAutoActionAt,
      officeVerified: liveLocation.state === 'inside',
    });

    if (!action) return;

    setLastAutoActionAt(Date.now());
    void submitAttendance({ action, source: 'auto_attendance' });
  }, [
    autoAttendanceAction,
    autoDeviceReady,
    canCheckIn,
    canSubmitSignOut,
    checkingIn,
    lastAutoActionAt,
    liveLocation.state,
    savingAutoSettings,
    status?.device?.autoCheckInEnabled,
    status?.device?.autoSignOutEnabled,
    submitAttendance,
  ]);

  return (
    <main className="h-dvh overflow-hidden bg-background px-3 py-3 text-foreground sm:px-6 sm:py-4">
      <div className="mx-auto flex h-full w-full max-w-xl flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between sm:h-14">
          <LateWatchLogo title="LateWatch" />
          <div className="flex items-center gap-2">
            <Button
              asChild
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 px-2.5 sm:px-3"
              title="Back to portal chooser"
            >
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Portals</span>
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={openPenaltyHistory}
              aria-label="Penalty History"
              title="Penalty History"
            >
              <ReceiptText className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <UserButton />
          </div>
        </header>

        <PenaltyHistoryDialog
          history={penaltyHistory}
          loading={penaltyHistoryLoading}
          error={penaltyHistoryError}
          onRefresh={fetchPenaltyHistory}
          onOpenChange={setPenaltyHistoryOpen}
          open={penaltyHistoryOpen}
        />

        <div className="flex min-h-0 flex-1 items-center py-3 sm:py-4">
          <Card className="w-full overflow-hidden">
            {loading || !isLoaded ? (
              <LoadingBuffer variant="section" label="Loading check-in" description="Verifying your account and location." />
            ) : accessNotSetUp ? (
              <AccessNotSetUp
                email={user?.primaryEmailAddress?.emailAddress || null}
              />
            ) : (
              <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
                <div className={cn('rounded-lg border p-3 text-center sm:p-4', statusTone(status))}>
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-background/70 sm:h-12 sm:w-12">
                    {status?.attendance ? (
                      <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
                    ) : canCheckIn ? (
                      <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6" />
                    )}
                  </div>
                  <h2 className="text-lg font-semibold sm:text-xl">{statusCopy(status)}</h2>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm leading-5 text-muted-foreground">
                    {statusDetail(status, user?.primaryEmailAddress?.emailAddress)}
                  </p>
                  <div className="mt-3 flex flex-col items-center gap-2">
                    {status?.staff?.fullName && (
                      <div className="inline-flex h-9 max-w-full items-center rounded-full border border-border/70 bg-background/60 px-3.5 text-sm font-medium text-foreground">
                        <span className="truncate">{status.staff.fullName}</span>
                      </div>
                    )}
                    <LocationStatusChip status={status} liveLocation={liveLocation} />
                  </div>
                </div>

                {status?.attendance && (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Checked in at</span>
                      <span className="font-mono text-lg font-semibold">{status.attendance.checkInTime.slice(0, 5)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                      <span className="text-sm text-muted-foreground">Checked out at</span>
                      <span className="font-mono text-lg font-semibold">{status.attendance.signOutTime ? status.attendance.signOutTime.slice(0, 5) : '-'}</span>
                    </div>
                    {Number(status.attendance.computedAmount || 0) > 0 && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="text-sm text-muted-foreground">Penalty</span>
                        <span className="font-mono font-semibold text-warning">GHC {Number(status.attendance.computedAmount).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(status.attendance.computedAmount || 0) === 0 && status.attendance.reason && (
                      <div className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                        {status.attendance.reason}
                      </div>
                    )}
                  </div>
                )}

                <AutoAttendancePanel
                  autoCheckInEnabled={Boolean(status?.device?.autoCheckInEnabled)}
                  autoSignOutEnabled={Boolean(status?.device?.autoSignOutEnabled)}
                  disabled={!autoDeviceReady || savingAutoSettings || Boolean(autoAttendanceAction)}
                  onToggleCheckIn={() => {
                    void updateAutoAttendanceSettings({
                      autoCheckInEnabled: !status?.device?.autoCheckInEnabled,
                      autoSignOutEnabled: Boolean(status?.device?.autoSignOutEnabled),
                    });
                  }}
                  onToggleSignOut={() => {
                    void updateAutoAttendanceSettings({
                      autoCheckInEnabled: Boolean(status?.device?.autoCheckInEnabled),
                      autoSignOutEnabled: !status?.device?.autoSignOutEnabled,
                    });
                  }}
                />

                {message && (
                  <div className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                    message.type === 'success'
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-danger/30 bg-danger/10 text-danger',
                  )}>
                    {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {message.text}
                  </div>
                )}

                <Button className="h-10 w-full gap-2 text-sm sm:h-11 sm:text-base" onClick={() => void submitAttendance()} disabled={(!canCheckIn && !canSubmitSignOut) || checkingIn || locationBlocksAction}>
                  {checkingIn ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : status?.attendance && !status.attendance.signOutTime ? (
                    <LogOut className="h-5 w-5" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                  {attendanceButtonLabel(status, checkingIn, liveLocation)}
                </Button>

                {status?.device?.registered && !status.device.trusted && (
                  <Button
                    className="h-10 w-full gap-2 text-sm sm:h-11 sm:text-base"
                    disabled={requestingTransfer || Boolean(status.transferRequest) || locationBlocksAction}
                    onClick={requestDeviceTransfer}
                    type="button"
                    variant="outline"
                  >
                    {requestingTransfer ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                    {status.transferRequest ? 'Transfer Request Pending' : 'Request Device Transfer'}
                  </Button>
                )}
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
  onRefresh,
  open,
}: {
  error: string | null;
  history: PenaltyHistoryResponse | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  open: boolean;
}) {
  const currentWeek = history?.currentWeek || null;
  const olderWeeks = (history?.weeks || []).filter((week) => week.startDate !== currentWeek?.startDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Penalty History</DialogTitle>
          <DialogDescription>
            Review late days, paid amounts, and outstanding balance.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingBuffer variant="section" label="Loading penalty history" description="Checking your weekly balance." />
        ) : error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : currentWeek ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Current week</h3>
                  <p className="text-xs text-muted-foreground">{currentWeek.startDate} to {currentWeek.endDate}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                  Refresh
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <PenaltyHistoryStat label="Penalty" value={ghc(currentWeek.totalPenalty)} />
                <PenaltyHistoryStat label="Paid" value={ghc(currentWeek.paidAmount)} />
                <PenaltyHistoryStat label="Outstanding balance" value={ghc(currentWeek.outstandingBalance)} highlight />
              </div>
            </div>

            <PenaltyHistoryEntries entries={currentWeek.entries} emptyLabel="No late penalty days this week." />

            {olderWeeks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Older weekly history</h3>
                {olderWeeks.map((week) => (
                  <details key={`${week.startDate}-${week.endDate}`} className="rounded-md border border-border bg-background">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                      {week.startDate} to {week.endDate} - {ghc(week.outstandingBalance)} outstanding
                    </summary>
                    <div className="border-t border-border p-3">
                      <PenaltyHistoryEntries entries={week.entries} emptyLabel="No penalty days for this week." />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No penalty history found.
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function PenaltyHistoryStat({ highlight, label, value }: { highlight?: boolean; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-[11px] uppercase leading-tight text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-sm font-semibold', highlight && 'text-warning')}>{value}</div>
    </div>
  );
}

function PenaltyHistoryEntries({ emptyLabel, entries }: { emptyLabel: string; entries: PenaltyHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border px-3 py-5 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.entryId} className="rounded-md border border-border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{entry.date}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {entry.arrivalTime?.slice(0, 5) || '-'} - {entry.reason || 'Late arrival'}
              </div>
            </div>
            <span className={cn(
              'inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium',
              entry.status === 'paid' && 'border-success/25 bg-success/10 text-success',
              entry.status === 'partially_paid' && 'border-warning/25 bg-warning/10 text-warning',
              entry.status === 'unpaid' && 'border-danger/25 bg-danger/10 text-danger',
            )}>
              {paymentStatusLabel(entry.status)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <PenaltyHistoryStat label="Penalty" value={ghc(entry.penaltyAmount)} />
            <PenaltyHistoryStat label="Paid" value={ghc(entry.paidAmount)} />
            <PenaltyHistoryStat label="Balance" value={ghc(entry.outstandingAmount)} highlight />
          </div>
        </div>
      ))}
    </div>
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

function AutoAttendancePanel({
  autoCheckInEnabled,
  autoSignOutEnabled,
  disabled,
  onToggleCheckIn,
  onToggleSignOut,
}: {
  autoCheckInEnabled: boolean;
  autoSignOutEnabled: boolean;
  disabled: boolean;
  onToggleCheckIn: () => void;
  onToggleSignOut: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="grid grid-cols-2 gap-2">
        <AutoAttendanceToggle
          disabled={disabled}
          enabled={autoCheckInEnabled}
          label="Auto check-in"
          onToggle={onToggleCheckIn}
        />
        <AutoAttendanceToggle
          disabled={disabled}
          enabled={autoSignOutEnabled}
          label="Auto sign-out"
          onToggle={onToggleSignOut}
        />
      </div>
    </div>
  );
}

function AutoAttendanceToggle({
  disabled,
  enabled,
  label,
  onToggle,
}: {
  disabled: boolean;
  enabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={enabled}
      className={cn(
        'flex h-11 items-center justify-between gap-2 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        enabled
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-background text-foreground',
      )}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <span className="truncate">{label}</span>
      <span className={cn(
        'h-2.5 w-2.5 shrink-0 rounded-full',
        enabled ? 'bg-primary' : 'bg-muted-foreground/40',
      )} />
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
  const tone = locationTone(liveLocation);

  return (
    <div className={cn(
      'inline-flex h-9 min-w-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold',
      tone === 'success' && 'border-success/25 bg-success/10 text-success',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
      tone === 'neutral' && 'border-border/80 bg-background/65 text-foreground',
    )}>
      <span className="shrink-0">{locationIcon(liveLocation)}</span>
      <span className="flex min-w-0 items-center truncate">{locationValue(status, liveLocation)}</span>
    </div>
  );
}
