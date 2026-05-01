'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { cn } from '@/lib/utils';

interface CheckInStatus {
  attendance: {
    id: string;
    checkInAt: string;
    checkInTime: string;
    computedAmount: string;
    reason: string | null;
    status: 'present' | 'late';
  } | null;
  date: string;
  holidayName: string | null;
  isHoliday: boolean;
  isAfterWorkdayEnd: boolean;
  isOfficeNetwork: boolean;
  isWeekend: boolean;
  networkConfigured: boolean;
  staff: {
    id: string;
    fullName: string;
    email: string | null;
  } | null;
  time: string;
  workdayEndLabel: string;
  workdayStartLabel: string;
}

function statusCopy(status: CheckInStatus | null) {
  if (!status) return 'Checking your attendance status';
  if (!status.networkConfigured) return 'Office network not configured';
  if (!status.staff) return 'Account not linked';
  if (status.isHoliday) return status.holidayName || 'Public holiday';
  if (status.isWeekend) return 'Weekend';
  if (!status.isOfficeNetwork) return 'Office WiFi required';
  if (status.attendance?.status === 'late') return 'Late check-in recorded';
  if (status.attendance?.status === 'present') return 'Checked in';
  if (status.isAfterWorkdayEnd) return 'Check-ins closed';
  return 'Ready to check in';
}

function statusDetail(status: CheckInStatus | null, fallbackName: string | null | undefined) {
  const person = status?.staff?.fullName || fallbackName || 'Signed-in user';
  if (!status) return 'Verifying your account, network, and today\'s work calendar.';
  if (!status.networkConfigured) return 'Ask an admin to save the office WiFi network before staff check in.';
  if (!status.staff) return 'Ask an admin to link your login email to your staff profile.';
  if (status.isHoliday) return 'Check-ins are disabled today in observance of the public holiday.';
  if (status.isWeekend) return 'You cannot check in today because attendance check-in is closed on weekends.';
  if (!status.isOfficeNetwork) return 'Connect to the office WiFi and refresh this page before checking in.';
  if (status.attendance?.status === 'late') return `${person}, your late check-in has been recorded.`;
  if (status.attendance?.status === 'present') return `${person}, your attendance has been recorded.`;
  if (status.isAfterWorkdayEnd) return `Check-ins are closed after ${status.workdayEndLabel}. Ask an admin to correct attendance if needed.`;
  return `${person}, you can check in now.`;
}

function todayTileValue(status: CheckInStatus | null) {
  if (!status) return 'Checking';
  if (status.attendance?.status === 'late') return 'Late';
  if (status.attendance?.status === 'present') return 'Present';
  if (status.isHoliday) return 'Holiday';
  if (status.isWeekend) return 'Weekend';
  if (status.isAfterWorkdayEnd) return 'Closed';
  return 'Not checked in';
}

function checkInButtonLabel(status: CheckInStatus | null, checkingIn: boolean) {
  if (checkingIn) return 'Checking in';
  if (status?.attendance) return 'Already Checked In';
  if (status?.isHoliday) return 'Closed - Holiday';
  if (status?.isWeekend) return 'Closed - Weekend';
  if (status?.isAfterWorkdayEnd) return 'Closed - After Hours';
  if (status && !status.networkConfigured) return 'Network Not Configured';
  if (status && !status.staff) return 'Account Not Linked';
  if (status && !status.isOfficeNetwork) return 'Office WiFi Required';
  return 'Check In';
}

function statusTone(status: CheckInStatus | null) {
  if (!status) return 'border-border bg-card text-muted-foreground';
  if (status.attendance?.status === 'present') return 'border-success/25 bg-success/10 text-success';
  if (status.attendance?.status === 'late') return 'border-warning/25 bg-warning/10 text-warning';
  if (!status.networkConfigured || !status.staff || !status.isOfficeNetwork || status.isHoliday || status.isWeekend) {
    return 'border-warning/25 bg-warning/10 text-warning';
  }
  if (status.isAfterWorkdayEnd) return 'border-warning/25 bg-warning/10 text-warning';
  return 'border-primary/25 bg-primary/10 text-primary';
}

export default function CheckInPage() {
  const { isLoaded, user } = useUser();
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/attendance/check-in', { cache: 'no-store' });
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
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function checkIn() {
    setCheckingIn(true);
    setMessage(null);

    try {
      const response = await fetch('/api/attendance/check-in', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Check-in failed');

      setStatus(body);
      setMessage({
        type: 'success',
        text: body.alreadyCheckedIn ? 'You already checked in today.' : 'Attendance recorded successfully.',
      });
    } catch (error) {
      console.error('Check-in failed:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Check-in failed' });
      await fetchStatus();
    } finally {
      setCheckingIn(false);
    }
  }

  const canCheckIn = Boolean(
    status?.networkConfigured &&
    status.staff &&
    status.isOfficeNetwork &&
    !status.isHoliday &&
    !status.isWeekend &&
    !status.isAfterWorkdayEnd &&
    !status.attendance,
  );

  return (
    <main className="h-dvh overflow-hidden bg-background px-3 py-3 text-foreground sm:px-6 sm:py-4">
      <div className="mx-auto flex h-full w-full max-w-xl flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between sm:h-14">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">LateWatch Check-In</h1>
              <p className="text-xs text-muted-foreground">GRA Attendance</p>
            </div>
          </div>
          <UserButton />
        </header>

        <div className="flex min-h-0 flex-1 items-center py-3 sm:py-4">
          <Card className="w-full overflow-hidden">
            {loading || !isLoaded ? (
              <LoadingBuffer variant="section" label="Loading check-in" description="Verifying your account and network." />
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
                  {status?.staff?.fullName && (
                    <div className="mt-2 inline-flex max-w-full rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                      <span className="truncate">{status.staff.fullName}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <InfoTile
                    icon={<Wifi className="h-4 w-4" />}
                    label="Office Network"
                    value={status?.isOfficeNetwork ? 'Verified' : 'Not verified'}
                    good={status?.isOfficeNetwork}
                  />
                  <InfoTile
                    icon={<Clock className="h-4 w-4" />}
                    label="Server Time"
                    value={status?.time?.slice(0, 5) || '-'}
                    good
                  />
                  <InfoTile
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Staff Profile"
                    value={status?.staff ? 'Linked' : 'Not linked'}
                    good={Boolean(status?.staff)}
                  />
                  <InfoTile
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    label="Today"
                    value={todayTileValue(status)}
                    good={Boolean(status?.attendance)}
                  />
                </div>

                {status?.attendance && (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Checked in at</span>
                      <span className="font-mono text-lg font-semibold">{status.attendance.checkInTime.slice(0, 5)}</span>
                    </div>
                    {Number(status.attendance.computedAmount || 0) > 0 && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="text-sm text-muted-foreground">Penalty</span>
                        <span className="font-mono font-semibold text-warning">GHC {Number(status.attendance.computedAmount).toFixed(2)}</span>
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

                <Button className="h-10 w-full gap-2 text-sm sm:h-11 sm:text-base" onClick={checkIn} disabled={!canCheckIn || checkingIn}>
                  {checkingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                  {checkInButtonLabel(status, checkingIn)}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

function InfoTile({
  good,
  icon,
  label,
  value,
}: {
  good?: boolean;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card p-2.5 sm:p-3">
      <div className={cn('mb-1.5 flex h-7 w-7 items-center justify-center rounded-md', good ? 'bg-success/10 text-success' : 'bg-muted/20 text-muted-foreground')}>
        {icon}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
