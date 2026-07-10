'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { ArrowLeft, Save, CheckCircle, AlertCircle, ChevronLeft, ChevronRight, Clock, RefreshCw, Search } from 'lucide-react';
import { computePenalty } from '@/lib/penalty-calculator';
import { NO_SHOW_SIGN_IN_REASON, NO_SHOW_SIGN_IN_WAIVED_REASON } from '@/lib/penalty-calculator';
import { getAccraDateKey } from '@/lib/date-key';
import { formatLongDisplayDate } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';

interface StaffMember {
  id: string;
  fullName: string;
  active?: boolean | null;
  archived?: boolean | null;
  department?: string | null;
  email?: string | null;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  rank?: string | null;
  staffNo?: string | null;
  unit?: string | null;
}

interface Entry {
  staffId: string;
  arrivalTime: string;
  signOutTime: string;
  didNotSignOut: boolean;
  amount: number;
  isExcusedAbsence: boolean;
  isGeneralPardon: boolean;
  noShowSignInWaived: boolean;
  noSignOutWaived: boolean;
  reason: string;
}

interface CalendarDay {
  isHoliday?: boolean | null;
  isRemoved?: boolean | null;
  holidayNote?: string | null;
}

interface ExistingEntry {
  staffId: string;
  arrivalTime: string | null;
  signOutTime?: string | null;
  didNotSignOut: boolean | null;
  computedAmount: string | number | null;
  isExcusedAbsence?: boolean | null;
  isGeneralPardon?: boolean | null;
  noShowSignInWaived?: boolean | null;
  noSignOutWaived?: boolean | null;
  reason: string | null;
}

type EntrySnapshot = Pick<Entry, 'arrivalTime' | 'didNotSignOut' | 'signOutTime' | 'noShowSignInWaived' | 'noSignOutWaived'>;
type SearchableValue = string | number | null | undefined;

function normalizeTimeValue(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '';
}

function getEntriesDeepLinkParams() {
  if (typeof window === 'undefined') return { date: null, fromPayments: false, query: null };

  const params = new URLSearchParams(window.location.search);
  const date = params.get('date');
  const query = params.get('q');

  return {
    date,
    fromPayments: Boolean(date || query),
    query,
  };
}

function normalizeSearchValue(value: SearchableValue) {
  return String(value ?? '').trim().toLowerCase();
}

function getTimeSearchTokens(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})/) ?? raw.match(/^(\d{1,2})(\d{2})$/);

  if (!timeMatch) return [];

  const [, hour, minute] = timeMatch;
  const hourNumber = Number.parseInt(hour, 10);

  if (Number.isNaN(hourNumber)) return [];

  const paddedHour = String(hourNumber).padStart(2, '0');
  const unpaddedHour = String(hourNumber);

  return Array.from(new Set([
    `${paddedHour}:${minute}`,
    `${unpaddedHour}:${minute}`,
    `${paddedHour}${minute}`,
    `${unpaddedHour}${minute}`,
  ]));
}

function getSearchNeedleGroups(query: string) {
  return normalizeSearchValue(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => Array.from(new Set([
      token,
      ...getTimeSearchTokens(token),
    ].map(normalizeSearchValue).filter(Boolean))));
}

function snapshotEntry(entry: Entry): EntrySnapshot {
  return {
    arrivalTime: normalizeTimeValue(entry.arrivalTime),
    didNotSignOut: entry.didNotSignOut === true,
    noShowSignInWaived: entry.noShowSignInWaived === true,
    noSignOutWaived: entry.noSignOutWaived === true,
    signOutTime: normalizeTimeValue(entry.signOutTime),
  };
}

function entryMatchesSnapshot(entry: Entry, snapshot: EntrySnapshot | undefined) {
  if (!snapshot) return false;

  return (
    normalizeTimeValue(entry.arrivalTime) === normalizeTimeValue(snapshot.arrivalTime) &&
    entry.didNotSignOut === snapshot.didNotSignOut &&
    entry.noShowSignInWaived === snapshot.noShowSignInWaived &&
    entry.noSignOutWaived === snapshot.noSignOutWaived &&
    normalizeTimeValue(entry.signOutTime) === normalizeTimeValue(snapshot.signOutTime)
  );
}

function formatChangedEntriesMessage(names: string[], count: number) {
  if (count <= 0) return 'No changes to save.';
  if (count === 1 && names[0]) return `Updated ${names[0]}.`;
  if (count === 2 && names.length >= 2) return `Updated ${names[0]} and ${names[1]}.`;
  if (names[0]) return `Updated ${names[0]} and ${count - 1} ${count - 1 === 1 ? 'other' : 'others'}.`;
  return `${count} entr${count === 1 ? 'y' : 'ies'} updated successfully`;
}

export default function EntriesPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [deepLink] = useState(() => getEntriesDeepLinkParams());
  const [selectedDate, setSelectedDate] = useState(() => {
    const parsed = deepLink.date ? parseISO(deepLink.date) : null;
    return parsed && isValid(parsed) ? parsed : parseISO(getAccraDateKey());
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [originalEntrySnapshots, setOriginalEntrySnapshots] = useState<Record<string, EntrySnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => deepLink.query || '');

  const fetchStaffAndEntries = useCallback(async () => {
    try {
      setLoading(true);
      const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');

      // Fetch all data in parallel
      const [staffResponse, calendarResponse, entriesResponse] = await Promise.all([
        fetch('/api/staff', { cache: 'no-store' }),
        fetch(`/api/calendar?start=${selectedDateKey}&end=${selectedDateKey}`, { cache: 'no-store' }),
        fetch(`/api/entries?date=${selectedDateKey}`, { cache: 'no-store' }),
      ]);

      const [staffData, calendarData, entriesData] = await Promise.all([
        staffResponse.json(),
        calendarResponse.json(),
        entriesResponse.json(),
      ]);

      const allStaffList = Array.isArray(staffData) ? staffData as StaffMember[] : [];

      const calendarDays = Array.isArray(calendarData) ? calendarData as CalendarDay[] : [];
      const holiday = calendarDays.find((h) => h.isHoliday && !h.isRemoved) ?? null;
      setIsHoliday(!!holiday);
      setHolidayName(holiday?.holidayNote || 'Holiday');

      const entriesList = Array.isArray(entriesData) ? entriesData as ExistingEntry[] : [];
      const entryStaffIds = new Set(entriesList.map((entry) => entry.staffId));
      const displayStaff = allStaffList.filter((member) =>
        (member.active === true && member.archived !== true) || entryStaffIds.has(member.id)
      );

      setStaff(displayStaff);

      const mergedEntries = displayStaff.map((s: StaffMember) => {
        const existing = entriesList.find((e) => e.staffId === s.id);
        return {
          staffId: s.id,
          arrivalTime: normalizeTimeValue(existing?.arrivalTime),
          signOutTime: normalizeTimeValue(existing?.signOutTime),
          didNotSignOut: existing?.didNotSignOut || false,
          amount: existing ? parseFloat(String(existing.computedAmount || '0')) : 0,
          isExcusedAbsence: existing?.isExcusedAbsence === true,
          isGeneralPardon: existing?.isGeneralPardon === true,
          noShowSignInWaived: existing?.noShowSignInWaived === true,
          noSignOutWaived: existing?.noSignOutWaived === true,
          reason: existing?.reason || '',
        };
      });

      setEntries(mergedEntries);
      setOriginalEntrySnapshots(Object.fromEntries(
        mergedEntries.map((entry) => [entry.staffId, snapshotEntry(entry)]),
      ));
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchStaffAndEntries();
  }, [fetchStaffAndEntries]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchStaffAndEntries();
    };
    const handleFocus = () => void fetchStaffAndEntries();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchStaffAndEntries]);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let mounted = true;

    (async () => {
      const unsubscribers = await Promise.all(
        ['entries', 'dashboard'].map((channel) =>
          subscribeRealtimeChannel({
            channel,
            events: ['invalidate'],
            onEvent: fetchStaffAndEntries,
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
  }, [fetchStaffAndEntries]);

  
  function applyPenaltyDisplay(entry: Entry, member: StaffMember | undefined): Entry {
    const hasSignOutTime = Boolean(normalizeTimeValue(entry.signOutTime));
    const hasSignInTime = Boolean(normalizeTimeValue(entry.arrivalTime));
    const isExcusedAbsence = entry.isExcusedAbsence === true;
    const noShowSignInWaived = hasSignInTime || isExcusedAbsence ? false : entry.noShowSignInWaived;
    const noSignOutWaived = hasSignOutTime || isExcusedAbsence ? false : entry.noSignOutWaived;
    const didNotSignOut = hasSignOutTime || isExcusedAbsence || noSignOutWaived || noShowSignInWaived ? false : entry.didNotSignOut;
    const normalizedEntry = {
      ...entry,
      didNotSignOut,
      isExcusedAbsence,
      noShowSignInWaived,
      noSignOutWaived,
      arrivalTime: normalizeTimeValue(entry.arrivalTime),
      signOutTime: normalizeTimeValue(entry.signOutTime),
    };

    if (normalizedEntry.isGeneralPardon && !didNotSignOut) {
      return {
        ...normalizedEntry,
        amount: 0,
        reason: normalizedEntry.reason || 'General pardon',
      };
    }

    if (normalizedEntry.isExcusedAbsence && !didNotSignOut) {
      return {
        ...normalizedEntry,
        amount: 0,
        isGeneralPardon: false,
        reason: normalizedEntry.reason || 'Excused absence',
      };
    }

    if (noSignOutWaived && !didNotSignOut) {
      return {
        ...normalizedEntry,
        amount: 0,
        isGeneralPardon: false,
        reason: 'No sign-out waived',
      };
    }

    if (noShowSignInWaived && !hasSignInTime) {
      return {
        ...normalizedEntry,
        amount: 0,
        didNotSignOut: false,
        isGeneralPardon: false,
        reason: NO_SHOW_SIGN_IN_WAIVED_REASON,
      };
    }

    if (!hasSignInTime && normalizedEntry.reason === NO_SHOW_SIGN_IN_REASON) {
      return {
        ...normalizedEntry,
        amount: normalizedEntry.amount,
        didNotSignOut: false,
        isExcusedAbsence: false,
        isGeneralPardon: false,
        noShowSignInWaived: false,
        noSignOutWaived: false,
        reason: NO_SHOW_SIGN_IN_REASON,
      };
    }

    const penalty = computePenalty({
      arrivalTime: normalizedEntry.arrivalTime || null,
      didNotSignOut,
      isAttendanceOnly: member?.isAttendanceOnly === true,
      isNssPersonnel: member?.isNssPersonnel === true,
      isHoliday,
    });

    return {
      ...normalizedEntry,
      amount: penalty.amount,
      isExcusedAbsence: false,
      isGeneralPardon: false,
      noShowSignInWaived: false,
      noSignOutWaived: false,
      reason: penalty.reason,
    };
  }

  function updateArrivalTime(staffId: string, value: string) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId !== staffId) return entry;

        const arrivalTime = normalizeTimeValue(value);
        const updated = {
          ...entry,
          arrivalTime,
          noShowSignInWaived: false,
          reason: arrivalTime && entry.reason === NO_SHOW_SIGN_IN_REASON ? '' : entry.reason,
        };
        const member = staff.find((s) => s.id === staffId);
        return applyPenaltyDisplay(updated, member);
      }),
    );
  }

  function updateSignOutTime(staffId: string, value: string) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId !== staffId) return entry;

        const signOutTime = normalizeTimeValue(value);
        const updated = {
          ...entry,
          didNotSignOut: signOutTime ? false : !entry.isExcusedAbsence,
          noSignOutWaived: false,
          signOutTime,
        };
        const member = staff.find((s) => s.id === staffId);
        return applyPenaltyDisplay(updated, member);
      }),
    );
  }

  function toggleNoSignOutWaiver(staffId: string) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId !== staffId) return entry;
        if (entry.isExcusedAbsence) return entry;

        const nextWaived = !entry.noSignOutWaived;
        const updated = {
          ...entry,
          didNotSignOut: nextWaived ? false : !normalizeTimeValue(entry.signOutTime),
          noSignOutWaived: nextWaived,
          signOutTime: '',
        };
        const member = staff.find((s) => s.id === staffId);
        return applyPenaltyDisplay(updated, member);
      }),
    );
  }

  function toggleNoShowSignInWaiver(staffId: string) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.staffId !== staffId) return entry;
        if (entry.isExcusedAbsence || normalizeTimeValue(entry.arrivalTime)) return entry;

        const nextWaived = !entry.noShowSignInWaived;
        const updated = {
          ...entry,
          didNotSignOut: false,
          noShowSignInWaived: nextWaived,
          noSignOutWaived: false,
          reason: nextWaived ? NO_SHOW_SIGN_IN_WAIVED_REASON : NO_SHOW_SIGN_IN_REASON,
        };
        const member = staff.find((s) => s.id === staffId);
        return applyPenaltyDisplay(updated, member);
      }),
    );
  }

  const changedEntries = useMemo(
    () => entries.filter((entry) => !entryMatchesSnapshot(entry, originalEntrySnapshots[entry.staffId])),
    [entries, originalEntrySnapshots],
  );

  const visibleEntries = useMemo(() => {
    const indexedEntries = entries.map((entry, index) => ({ entry, index }));
    const needleGroups = getSearchNeedleGroups(searchQuery);

    if (needleGroups.length === 0) return indexedEntries;

    return indexedEntries.filter(({ entry }) => {
      const member = staff.find((s) => s.id === entry.staffId);
      const searchableText = [
        member?.fullName,
        member?.email,
        member?.staffNo,
        member?.department,
        member?.unit,
        member?.rank,
        entry.arrivalTime,
        ...getTimeSearchTokens(entry.arrivalTime),
        entry.signOutTime,
        ...getTimeSearchTokens(entry.signOutTime),
        entry.reason,
        entry.amount,
        entry.amount > 0 ? `GHC ${entry.amount}` : '',
      ]
        .map(normalizeSearchValue)
        .filter(Boolean)
        .join(' ')

      return needleGroups.every((needles) =>
        needles.some((needle) => searchableText.includes(needle))
      );
    });
  }, [entries, searchQuery, staff]);

  async function handleSaveAll() {
    setMessage(null);

    if (changedEntries.length === 0) {
      setMessage({ type: 'success', text: 'No changes to save.' });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    setSaving(true);
    try {
      const today = format(selectedDate, 'yyyy-MM-dd');
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today,
          entries: changedEntries.map((entry) => ({
            ...entry,
            didNotSignOutChanged: entry.didNotSignOut !== originalEntrySnapshots[entry.staffId]?.didNotSignOut,
            noSignOutWaivedChanged: entry.noSignOutWaived !== originalEntrySnapshots[entry.staffId]?.noSignOutWaived,
            noShowSignInWaivedChanged: entry.noShowSignInWaived !== originalEntrySnapshots[entry.staffId]?.noShowSignInWaived,
            signOutTimeChanged:
              normalizeTimeValue(entry.signOutTime) !==
              normalizeTimeValue(originalEntrySnapshots[entry.staffId]?.signOutTime),
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const savedCount = Number(data.count || 0);
        const attendanceCount = Number(data.attendanceCount || 0);
        const deletedCount = Number(data.deletedCount || 0);
        const totalChanges = savedCount + attendanceCount + deletedCount;
        const changedStaffNames = Array.isArray(data.changedStaffNames) ? data.changedStaffNames as string[] : [];
        const changedStaffCount = Number(data.changedStaffCount ?? changedStaffNames.length ?? totalChanges);
        setMessage({
          type: 'success',
          text: formatChangedEntriesMessage(changedStaffNames, changedStaffCount),
        });
        // Re-fetch fresh data from DB so saved entries display immediately
        setTimeout(() => fetchStaffAndEntries(), 50);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || 'Failed to save entries' });
      }
    } catch (error) {
      console.error('Failed to save entries:', error);
      setMessage({ type: 'error', text: 'Failed to save entries' });
    } finally {
      setSaving(false);
      // Auto-dismiss message after 5 seconds
      setTimeout(() => setMessage(null), 5000);
    }
  }

  function changeSelectedDate(nextDate: Date) {
    setSelectedDate(nextDate);
    setMessage(null);
  }

  function handleDateInputChange(value: string) {
    const parsed = parseISO(value);
    if (isValid(parsed)) {
      changeSelectedDate(parsed);
    }
  }

  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const isWeekend = selectedDate.getDay() === 0 || selectedDate.getDay() === 6;
  const entriesDisabled = isHoliday || isWeekend;
  const todayDateKey = getAccraDateKey();
  const isSelectedDateInPastOrToday = selectedDateKey <= todayDateKey;
  const noShowSignInWaiveAvailable = isSelectedDateInPastOrToday;

  const totals = entries.reduce(
    (acc, entry) => ({
      late: acc.late + (entry.amount > 0 && !entry.reason.includes('SIGN OUT') ? 1 : 0),
      onTime: acc.onTime + (entry.amount === 0 && !entry.didNotSignOut ? 1 : 0),
      didNotSignOut: acc.didNotSignOut + (entry.didNotSignOut ? 1 : 0),
      totalAmount: acc.totalAmount + entry.amount,
    }),
    { late: 0, onTime: 0, didNotSignOut: 0, totalAmount: 0 }
  );

  if (loading) {
    return (
      <DashboardLayout title="Entries">
        <LoadingBuffer
          variant="page"
          label="Loading entries"
          description="Checking staff, holidays, and saved records."
        />
      </DashboardLayout>
    );
  }

  if (staff.length === 0) {
    return (
      <DashboardLayout title="Entries">
        <div className="space-y-6">
          <Card>
            <div className="p-8 text-center">
              <p className="text-lg mb-2">No staff members found</p>
              <p className="text-sm text-muted-foreground mb-4">Please add staff members first before recording entries</p>
              <Button onClick={() => window.location.href = '/staff'}>
                Go to Staff Management
              </Button>
            </div>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Entries">
      <div className="space-y-6">
        {deepLink.fromPayments && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Payments
          </Button>
        )}

        {/* Success/Error Message */}
        {message && (
          <div className={`flex items-center gap-3 rounded-lg border p-4 ${
            message.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        {/* Holiday Warning */}
        {(isHoliday || isWeekend) && (
          <Card className="overflow-hidden border-warning/30 bg-warning/5">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{isWeekend ? 'Weekend' : holidayName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No entries can be recorded on {isWeekend ? 'weekends.' : 'public holidays.'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Date and Save Action */}
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 lg:flex-row lg:items-center">
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => changeSelectedDate(addDays(selectedDate, -1))}
                aria-label="Previous date"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <DateField
                ariaLabel="Entries date"
                value={selectedDateKey}
                onChange={handleDateInputChange}
                inputClassName="w-[168px]"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => changeSelectedDate(addDays(selectedDate, 1))}
                aria-label="Next date"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => changeSelectedDate(parseISO(getAccraDateKey()))}
              className="self-start"
            >
              Today
            </Button>
            <span className="text-sm font-medium text-muted-foreground">
              {formatLongDisplayDate(selectedDate)}
            </span>
          </div>
          <div className="relative w-full lg:max-w-sm xl:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search entries"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search staff or entry"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto lg:ml-auto">
            <Button
              aria-label="Refresh entries"
              disabled={saving}
              onClick={() => {
                setMessage(null);
                void fetchStaffAndEntries();
              }}
              size="icon"
              title="Refresh entries"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleSaveAll} disabled={saving || entriesDisabled}>
              <Save className="mr-2 h-4 w-4" />
              {saving
                ? 'Saving...'
                : entriesDisabled
                ? 'Closed - No Entries'
                : changedEntries.length === 1
                ? 'Save 1 Change'
                : changedEntries.length > 1
                ? `Save ${changedEntries.length} Changes`
                : 'Save Entries'}
            </Button>
          </div>
        </div>

        {/* Entry Grid */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-card">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="w-44 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Sign In</th>
                  <th className="w-56 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Sign Out</th>
                  <th className="w-28 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No entries match your search.
                    </td>
                  </tr>
                ) : visibleEntries.map(({ entry, index }) => {
                  const member = staff.find((s) => s.id === entry.staffId);
                  const isMonitoringStaff = member?.isAttendanceOnly === true;
                  const showNoShowSignInWaiverButton =
                    !entriesDisabled &&
                    !entry.arrivalTime &&
                    !entry.isExcusedAbsence &&
                    !isMonitoringStaff &&
                    (
                      noShowSignInWaiveAvailable ||
                      entry.reason === NO_SHOW_SIGN_IN_REASON ||
                      entry.reason === NO_SHOW_SIGN_IN_WAIVED_REASON ||
                      entry.noShowSignInWaived
                    );
                  return (
                    <tr key={entry.staffId} className="hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <span>{member?.fullName}</span>
                          {member?.archived && (
                            <span className="rounded-full border border-warning/25 px-2 py-0.5 text-[11px] font-medium text-warning">
                              Former
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TimeSelector
                            value={entry.arrivalTime}
                            onChange={(value) => updateArrivalTime(entry.staffId, value)}
                            disabled={entriesDisabled}
                            label="Sign-in time"
                          />
                          {showNoShowSignInWaiverButton && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={entriesDisabled}
                              onClick={() => toggleNoShowSignInWaiver(entry.staffId)}
                            >
                              {entry.noShowSignInWaived ? (
                                <>Remove waiver</>
                              ) : (
                                <>Mark as waived</>
                              )}
                            </Button>
                          )}
                        </div>
                        {!entry.arrivalTime && (entry.reason === NO_SHOW_SIGN_IN_REASON || entry.noShowSignInWaived) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entry.noShowSignInWaived ? 'Waived' : 'No sign-in'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TimeSelector
                            value={entry.signOutTime}
                            onChange={(value) => updateSignOutTime(entry.staffId, value)}
                            disabled={entriesDisabled}
                            label="Sign-out time"
                            max="23:59"
                          />
                          {entry.signOutTime ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-semibold text-success">
                              <CheckCircle className="h-3 w-3" />
                              Signed out
                            </span>
                          ) : !entry.isExcusedAbsence && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={entriesDisabled}
                              onClick={() => toggleNoSignOutWaiver(entry.staffId)}
                            >
                              {entry.noSignOutWaived ? (
                                <>Remove waiver</>
                              ) : (
                                <>Mark as waived</>
                              )}
                            </Button>
                          )}
                        </div>
                        {!entry.signOutTime && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entry.isExcusedAbsence ? 'Excused' : entry.noSignOutWaived ? 'Waived' : entry.didNotSignOut ? 'No sign-out' : 'Missing'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {entry.amount > 0 ? (
                          <span className="text-danger">GHC {entry.amount}</span>
                        ) : entry.isGeneralPardon ? (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-semibold text-success">General pardon</span>
                        ) : entry.isExcusedAbsence ? (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs font-semibold text-success">Excused</span>
                        ) : entry.noSignOutWaived || entry.noShowSignInWaived ? (
                          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">Waived</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {entry.reason || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Day Summary */}
        <Card>
          <div className="p-4">
            <h3 className="mb-3 font-semibold">Day Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-danger">{totals.late}</p>
                <p className="text-xs text-muted-foreground mt-1">Late</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-success">{totals.onTime}</p>
                <p className="text-xs text-muted-foreground mt-1">On Time</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-warning">{totals.didNotSignOut}</p>
                <p className="text-xs text-muted-foreground mt-1">No Sign Out</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono">GHC {totals.totalAmount}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Amount</p>
              </div>
            </div>
          </div>
        </Card>

      </div>
    </DashboardLayout>
  );
}

function TimeSelector({
  disabled,
  label = 'Time',
  max = '18:00',
  min = '06:00',
  onChange,
  value,
}: {
  disabled?: boolean;
  label?: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openNativePicker() {
    const input = inputRef.current;
    if (!input || disabled) return;

    try {
      input.showPicker?.();
    } catch {
      input.focus();
      input.click();
    }
  }

  return (
    <div className="relative w-36">
      <Input
        ref={inputRef}
        aria-label={label}
        className="latewatch-native-time-input h-9 w-full pr-9 font-mono text-sm font-medium [color-scheme:light] dark:[color-scheme:dark]"
        disabled={disabled}
        max={max}
        min={min}
        step={300}
        type="time"
        value={normalizeTimeValue(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        aria-label="Open time picker"
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        type="button"
        onClick={openNativePicker}
      >
        <Clock className="h-4 w-4" />
      </button>
    </div>
  );
}
