'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, LogOut, Moon, ShieldCheck, Sun, Wifi, XCircle } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { getPermissionWindowBounds, isPermissionWindowOverdue } from '@/lib/attendance-permissions';
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
  time: string;
  noSignOutAlertLabel: string;
  signOutStartLabel: string;
  workdayEndLabel: string;
  workdayStartLabel: string;
}

function canSignOut(status: CheckInStatus | null) {
  return Boolean(status?.attendance && !status.attendance.signOutTime && status.time?.slice(0, 5) >= '16:30');
}

function statusCopy(status: CheckInStatus | null) {
  if (!status) return 'Checking your attendance status';
  if (!status.networkConfigured) return 'Office network not configured';
  if (!status.staff) return 'Profile not matched';
  if (status.device?.registered && !status.device.trusted) return 'Registered device required';
  if (status.permission?.permissionType === 'absence') return 'Permission recorded';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (!status.isOfficeNetwork) return 'Office WiFi required';
  if (status.attendance?.signOutTime) return 'Checked out';
  if (status.attendance?.status === 'late') return 'Late check-in recorded';
  if (status.attendance?.status === 'present') return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-ins closed';
  return 'Ready to check in';
}

function statusDetail(status: CheckInStatus | null, fallbackName: string | null | undefined) {
  const person = status?.staff?.fullName || fallbackName || 'Signed-in user';
  if (!status) return 'Verifying your account, network, and today\'s work calendar.';
  if (!status.networkConfigured) return 'Ask an admin to save the office WiFi network before staff check in.';
  if (!status.staff) return 'Your login could not be matched to a staff profile yet. Ask an admin to confirm your staff email or staff name.';
  if (status.device?.registered && !status.device.trusted) return 'This account is linked to another device. Ask an admin to reset the attendance device.';
  if (status.permission?.permissionType === 'absence') return 'You have an approved absence for today. No check-in is required.';
  if (status.isHoliday) return 'Check-ins are disabled today in observance of the public holiday.';
  if (status.isWeekend) return 'You cannot check in today because attendance check-in is closed on weekends.';
  if (!status.isOfficeNetwork) return 'Connect to the office WiFi and refresh this page before checking in.';
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

function wifiValue(status: CheckInStatus | null) {
  if (!status?.networkConfigured) return 'Not set';
  return status.isOfficeNetwork ? <VerifiedWifiBadge /> : <UnverifiedWifiBadge />;
}

function attendanceButtonLabel(status: CheckInStatus | null, submitting: boolean) {
  if (submitting) return status?.attendance && !status.attendance.signOutTime ? 'Checking out' : 'Checking in';
  if (status?.attendance?.signOutTime) return 'Already Checked Out';
  if (status?.attendance) return canSignOut(status) ? 'Check Out' : `Check Out Opens ${status.signOutStartLabel}`;
  if (status?.isHoliday) return 'Closed - Holiday';
  if (status?.isWeekend) return 'Closed - Weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - After Hours';
  if (status && !status.networkConfigured) return 'Network Not Configured';
  if (status && !status.staff) return 'Profile Not Matched';
  if (status?.device?.registered && !status.device.trusted) return 'Registered Device Required';
  if (status?.permission?.permissionType === 'absence') return 'Excused - No Check-In';
  if (status && !status.isOfficeNetwork) return 'Office WiFi Required';
  return 'Check In';
}

function statusTone(status: CheckInStatus | null) {
  if (!status) return 'border-border bg-card text-muted-foreground';
  if (status.attendance?.signOutTime) return 'border-success/25 bg-success/10 text-success';
  if (status.attendance?.status === 'present') return 'border-success/25 bg-success/10 text-success';
  if (status.attendance?.status === 'late') return 'border-warning/25 bg-warning/10 text-warning';
  if (status.permission?.permissionType === 'absence') return 'border-primary/25 bg-primary/10 text-primary';
  if (!status.networkConfigured || !status.staff || (status.device?.registered && !status.device.trusted) || !status.isOfficeNetwork || status.isHoliday || status.isWeekend) {
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

export default function CheckInPage() {
  const { isLoaded, user } = useUser();
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    setDeviceToken(getOrCreateDeviceToken());
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!deviceToken) return;
    setLoading(true);
    setMessage(null);

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
      console.error('Failed to load check-in status:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load check-in status' });
    } finally {
      setLoading(false);
    }
  }, [deviceToken]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function submitAttendance() {
    setCheckingIn(true);
    setMessage(null);
    const action = status?.attendance && !status.attendance.signOutTime ? 'sign_out' : 'check_in';

    try {
      const response = await fetch('/api/attendance/check-in', {
        body: JSON.stringify({ action, deviceToken }),
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
      console.error('Attendance action failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Attendance action failed';
      await fetchStatus();
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setCheckingIn(false);
    }
  }

  function toggleTheme() {
    applyThemePreference(isDark ? 'light' : 'dark');
  }

  const canCheckIn = Boolean(
    status?.networkConfigured &&
    status.staff &&
    (!status.device?.registered || status.device.trusted) &&
    status.isOfficeNetwork &&
    !status.isHoliday &&
    !status.isWeekend &&
    !status.isAfterWorkdayEnd &&
    status.permission?.permissionType !== 'absence' &&
    !status.attendance,
  );
  const canSubmitSignOut = Boolean(
    status?.networkConfigured &&
    status.staff &&
    (!status.device?.registered || status.device.trusted) &&
    status.isOfficeNetwork &&
    !status.isHoliday &&
    !status.isWeekend &&
    status.attendance &&
    !status.attendance.signOutTime &&
    canSignOut(status),
  );
  const accessNotSetUp = Boolean(status && !status.staff);

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
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <UserButton />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center py-3 sm:py-4">
          <Card className="w-full overflow-hidden">
            {loading || !isLoaded ? (
              <LoadingBuffer variant="section" label="Loading check-in" description="Verifying your account and network." />
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
                    <StatusChip
                      icon={<Clock className="h-3.5 w-3.5" />}
                      label="Time"
                      value={status?.time?.slice(0, 5) || '-'}
                      labelClassName="font-medium text-foreground/85"
                      valueClassName="font-bold text-foreground"
                    />
                    <StatusChip
                      icon={<Wifi className="h-3.5 w-3.5" />}
                      label="WiFi"
                      labelClassName="font-medium text-foreground/85"
                      value={wifiValue(status)}
                    />
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

                <Button className="h-10 w-full gap-2 text-sm sm:h-11 sm:text-base" onClick={submitAttendance} disabled={(!canCheckIn && !canSubmitSignOut) || checkingIn}>
                  {checkingIn ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : status?.attendance && !status.attendance.signOutTime ? (
                    <LogOut className="h-5 w-5" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                  {attendanceButtonLabel(status, checkingIn)}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
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

function StatusChip({
  icon,
  label,
  tone = 'neutral',
  value,
  labelClassName,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'neutral' | 'success' | 'warning';
  value: ReactNode;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn(
      'inline-flex h-9 min-w-0 items-center gap-2 rounded-full border px-3.5 text-sm',
      tone === 'success' && 'border-success/25 bg-success/10 text-success',
      tone === 'warning' && 'border-warning/25 bg-warning/10 text-warning',
      tone === 'neutral' && 'border-border/80 bg-background/65 text-foreground',
    )}>
      <span className="shrink-0">{icon}</span>
      <span className={cn('text-xs text-muted-foreground', labelClassName)}>{label}</span>
      <span className={cn('flex items-center font-semibold', valueClassName)}>{value}</span>
    </div>
  );
}

function VerifiedWifiBadge() {
  return (
    <svg
      aria-label="Verified office network"
      className="h-4 w-4 shrink-0"
      role="img"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 1.6 14.1 3.4 16.8 2.9 18.1 5.3 20.8 6.1 20.9 8.9 23 10.7 21.8 13.2 22.6 15.9 20.1 17.2 19.3 19.9 16.5 20 14.7 22.1 12 21 9.3 22.1 7.5 20 4.7 19.9 3.9 17.2 1.4 15.9 2.2 13.2 1 10.7 3.1 8.9 3.2 6.1 5.9 5.3 7.2 2.9 9.9 3.4 12 1.6Z"
        fill="#1d9bf0"
      />
      <path
        d="m10.35 14.55 5.55-6.05 1.55 1.42-6.95 7.58-4.05-4.05 1.48-1.48 2.42 2.58Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function UnverifiedWifiBadge() {
  return (
    <svg
      aria-label="Unverified office network"
      className="h-4 w-4 shrink-0"
      role="img"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 1.6 14.1 3.4 16.8 2.9 18.1 5.3 20.8 6.1 20.9 8.9 23 10.7 21.8 13.2 22.6 15.9 20.1 17.2 19.3 19.9 16.5 20 14.7 22.1 12 21 9.3 22.1 7.5 20 4.7 19.9 3.9 17.2 1.4 15.9 2.2 13.2 1 10.7 3.1 8.9 3.2 6.1 5.9 5.3 7.2 2.9 9.9 3.4 12 1.6Z"
        fill="#ef4444"
      />
      <path
        d="m8.55 7.1 3.45 3.45 3.45-3.45 1.45 1.45L13.45 12l3.45 3.45-1.45 1.45L12 13.45 8.55 16.9 7.1 15.45 10.55 12 7.1 8.55 8.55 7.1Z"
        fill="#ffffff"
      />
    </svg>
  );
}
