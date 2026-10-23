'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { cn } from '@/lib/utils';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { ArrowLeft, ClockAlert, Save, CheckCircle, AlertCircle, CalendarOff, ChevronLeft, ChevronRight, Clock, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { computePenalty } from '@/lib/penalty-calculator';
import { NO_SHOW_SIGN_IN_REASON, NO_SHOW_SIGN_IN_WAIVED_REASON } from '@/lib/penalty-calculator';
import { getAccraDateKey, getAccraTimeKey } from '@/lib/date-key';
import { chargesNoSignOut, isNoSignOutChargeDue, isOnTimeCheckIn } from '@/lib/work-hours';
import { formatLongDisplayDate } from '@/lib/date-format';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { formatLeaveSummary } from '@/lib/staff-leave';
import { LATE_ARRIVAL_PERMISSION_REASONS } from '@/lib/attendance-permissions';

interface StaffMember {
  id: string;
  fullName: string;
  active?: boolean | null;
  archived?: boolean | null;
  onLeave?: boolean;
  activeLeave?: {
    endDate: string | null;
    leaveType: string | null;
    returnedOn: string | null;
    source: string | null;
    staffId: string;
    startDate: string | null;
  } | null;
  department?: string | null;
  email?: string | null;
  isAttendanceOnly?: boolean | null;
  isNssPersonnel?: boolean | null;
  // The charge rules on the selected date (the person's type then, not now).
  chargeOnDate?: { isAttendanceOnly: boolean; isNssPersonnel: boolean };
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

const LATE_ARRIVAL_PENALTY_REASON = "DIDN'T COME BEFORE 8:30AM";
const LATE_ARRIVAL_PARDON_REASON_PREFIX = 'Approved late arrival';

type EntrySnapshot = Pick<Entry, 'arrivalTime' | 'didNotSignOut' | 'signOutTime' | 'noShowSignInWaived' | 'noSignOutWaived'>;
type SearchableValue = string | number | null | undefined;

function normalizeTimeValue(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '';
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

const STATUS_TAG_CLASS = 'whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary';

/**
 * The one status tag shown under a staff member's name: on leave, general pardon, excused absence
 * or late-arrival permission (in that order, so a row never shows two tags for the same reason).
 * coversReason: the Reason column would only repeat the tag, so it shows "-" instead.
 */
function getEntryStatusTag(entry: Entry, leaveSummary?: string | null): { coversReason: boolean; detail?: string; label: string } | null {
  const reason = entry.reason || '';
  const detailAfter = (text: string) => text.slice(text.indexOf(':') + 1).trim() || undefined;

  if (leaveSummary !== undefined) return { coversReason: false, detail: leaveSummary || undefined, label: 'On leave' };
  if (entry.isGeneralPardon) return { coversReason: entry.amount === 0, label: 'General pardon' };
  if (entry.isExcusedAbsence) {
    const isExcuseText = reason.toLowerCase().startsWith('excused absence');
    return { coversReason: isExcuseText || !reason, detail: isExcuseText ? detailAfter(reason) : undefined, label: 'Excused' };
  }
  if (reason.startsWith(LATE_ARRIVAL_PARDON_REASON_PREFIX)) {
    return { coversReason: entry.amount === 0, detail: reason.includes(':') ? detailAfter(reason) : undefined, label: 'Late permission' };
  }
  return null;
}

// The fields an admin edits in the grid; everything else (amount, reason, flags) comes from the server.
function pickEditableFields(entry: Entry) {
  return {
    arrivalTime: entry.arrivalTime,
    didNotSignOut: entry.didNotSignOut,
    noShowSignInWaived: entry.noShowSignInWaived,
    noSignOutWaived: entry.noSignOutWaived,
    signOutTime: entry.signOutTime,
  };
}

function formatChangedEntriesMessage(names: string[], count: number) {
  if (count <= 0) return 'No changes to save.';
  if (count === 1 && names[0]) return `Updated ${names[0]}.`;
  if (count === 2 && names.length >= 2) return `Updated ${names[0]} and ${names[1]}.`;
  if (names[0]) return `Updated ${names[0]} and ${count - 1} ${count - 1 === 1 ? 'other' : 'others'}.`;
  return `${count} entr${count === 1 ? 'y' : 'ies'} updated successfully`;
}

function EntriesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');
  const queryParam = searchParams.get('q');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const parsed = dateParam ? parseISO(dateParam) : null;
    return parsed && isValid(parsed) ? parsed : parseISO(getAccraDateKey());
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [originalEntrySnapshots, setOriginalEntrySnapshots] = useState<Record<string, EntrySnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => queryParam || '');
  const [showBackToPayments, setShowBackToPayments] = useState(() => Boolean(dateParam || queryParam));
  // 'late' waives the late fee only; 'all' also waives the no-sign-out charge on the same row.
  const [lateArrivalPardonTarget, setLateArrivalPardonTarget] = useState<{
    amount: number;
    mode: 'late' | 'all';
    staffId: string;
    staffName: string;
  } | null>(null);
  const [lateArrivalPardonReason, setLateArrivalPardonReason] = useState<string>('personal excuse');
  const [pardoningLateArrival, setPardoningLateArrival] = useState(false);
  // Rows another admin changed while this person had unsaved edits on them.
  const [conflictStaffIds, setConflictStaffIds] = useState<Set<string>>(() => new Set());
  // Latest grid state, read by background refreshes so they never wipe unsaved edits.
  const entriesRef = useRef<Entry[]>([]);
  const snapshotsRef = useRef<Record<string, EntrySnapshot>>({});
  const loadedDateRef = useRef<string | null>(null);
  // True while this page's own save is in flight; its echo refresh is not someone else's change.
  const savingRef = useRef(false);

  useEffect(() => {
    entriesRef.current = entries;
    snapshotsRef.current = originalEntrySnapshots;
  }, [entries, originalEntrySnapshots]);

  const fetchStaffAndEntries = useCallback(async () => {
    const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
    // Same day: a quiet background refresh that keeps the grid (and anything being typed) on screen.
    const isRefresh = loadedDateRef.current === selectedDateKey;
    try {
      if (!isRefresh) setLoading(true);

      // Fetch all data in parallel
      const [staffResponse, calendarResponse, entriesResponse] = await Promise.all([
        fetch(`/api/staff?date=${selectedDateKey}`, { cache: 'no-store' }),
        fetch(`/api/calendar?start=${selectedDateKey}&end=${selectedDateKey}`, { cache: 'no-store' }),
        fetch(`/api/entries?date=${selectedDateKey}`, { cache: 'no-store' }),
      ]);

      const failedResponse = [staffResponse, calendarResponse, entriesResponse].find((response) => !response.ok);
      if (failedResponse) {
        const errorData = await failedResponse.json().catch(() => null);
        throw new Error(errorData?.error || `Could not load entries (${failedResponse.status})`);
      }

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

      // Keep unsaved edits: a row someone is editing keeps their values; every other row takes the
      // latest saved values. If another admin saved a change to a row being edited, flag it.
      const previousEntries = isRefresh ? new Map(entriesRef.current.map((entry) => [entry.staffId, entry])) : new Map<string, Entry>();
      const previousSnapshots = isRefresh ? snapshotsRef.current : {};
      const newConflicts: string[] = [];
      const nextEntries = mergedEntries.map((serverEntry) => {
        const local = previousEntries.get(serverEntry.staffId);
        const base = previousSnapshots[serverEntry.staffId];
        if (!local || !base || entryMatchesSnapshot(local, base)) return serverEntry;
        if (!savingRef.current && !entryMatchesSnapshot(serverEntry, base)) newConflicts.push(serverEntry.staffId);
        return { ...serverEntry, ...pickEditableFields(local) };
      });

      setEntries(nextEntries);
      setOriginalEntrySnapshots(Object.fromEntries(
        mergedEntries.map((entry) => [entry.staffId, snapshotEntry(entry)]),
      ));
      setConflictStaffIds((current) => {
        const next = isRefresh ? new Set(current) : new Set<string>();
        newConflicts.forEach((staffId) => next.add(staffId));
        return next;
      });
      if (newConflicts.length > 0) {
        const names = newConflicts.map((staffId) => allStaffList.find((member) => member.id === staffId)?.fullName).filter(Boolean);
        setMessage({
          type: 'error',
          text: `Another admin just saved changes to ${names.join(', ') || 'a row you are editing'}. Your unsaved edits are kept; saving will replace theirs for ${names.length === 1 ? 'that row' : 'those rows'}.`,
        });
      }
      loadedDateRef.current = selectedDateKey;
      setLoadError(null);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      const text = error instanceof Error ? error.message : 'Failed to load entries';
      // A failed background refresh keeps the grid (and any typing) on screen.
      if (isRefresh) setMessage({ type: 'error', text: `${text.replace(/\.$/, '')}. Showing the last loaded entries.` });
      else setLoadError(text);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchStaffAndEntries();
  }, [fetchStaffAndEntries]);

  const appliedDeepLinkKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!dateParam && !queryParam) return;

    const paramsKey = `${dateParam ?? ''}|${queryParam ?? ''}`;
    if (appliedDeepLinkKeyRef.current === paramsKey) return;
    appliedDeepLinkKeyRef.current = paramsKey;

    if (dateParam) {
      const parsed = parseISO(dateParam);
      if (isValid(parsed)) {
        setSelectedDate((prev) =>
          format(prev, 'yyyy-MM-dd') === format(parsed, 'yyyy-MM-dd') ? prev : parsed
        );
      }
    }

    if (queryParam !== null) {
      setSearchQuery((prev) => (prev === queryParam ? prev : queryParam));
    }

    setShowBackToPayments(true);
    router.replace('/entries', { scroll: false });
  }, [dateParam, queryParam, router]);

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
    // From 12 Oct 2026 a missed sign-out is no longer charged, so it isn't shown as one either.
    const didNotSignOut = hasSignOutTime || isExcusedAbsence || noSignOutWaived || noShowSignInWaived
      || !chargesNoSignOut(format(selectedDate, 'yyyy-MM-dd'))
      ? false
      : entry.didNotSignOut;
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
      date: format(selectedDate, 'yyyy-MM-dd'),
      didNotSignOut,
      isAttendanceOnly: (member?.chargeOnDate ?? member)?.isAttendanceOnly === true,
      isNssPersonnel: (member?.chargeOnDate ?? member)?.isNssPersonnel === true,
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
          // No sign-in means no sign-out either: clearing the sign-in clears the whole day.
          ...(arrivalTime ? {} : { didNotSignOut: false, noSignOutWaived: false, signOutTime: '' }),
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
        // No sign-out is only a charge once the day is over; earlier it just means "not yet".
        const noSignOutDue = isNoSignOutChargeDue(format(selectedDate, 'yyyy-MM-dd'), getAccraDateKey(), getAccraTimeKey());
        const updated = {
          ...entry,
          didNotSignOut: signOutTime ? false : !entry.isExcusedAbsence && noSignOutDue,
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
        const noSignOutDue = isNoSignOutChargeDue(format(selectedDate, 'yyyy-MM-dd'), getAccraDateKey(), getAccraTimeKey());
        const updated = {
          ...entry,
          didNotSignOut: nextWaived ? false : !normalizeTimeValue(entry.signOutTime) && noSignOutDue,
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

    // Clearing a saved sign-in removes that day's check-in. Confirm first, naming who.
    const removals = changedEntries.filter((entry) => !entry.arrivalTime && originalEntrySnapshots[entry.staffId]?.arrivalTime);
    if (removals.length > 0) {
      const names = removals.map((entry) => staff.find((member) => member.id === entry.staffId)?.fullName || 'staff member');
      const confirmed = window.confirm(
        `Remove the check-in for ${names.join(', ')} on ${formatLongDisplayDate(format(selectedDate, 'yyyy-MM-dd'))}?\n\n`
        + 'Their sign-in and sign-out for this day will be deleted. The no sign-in charge then applies unless waived.',
      );
      if (!confirmed) return;
    }

    setSaving(true);
    savingRef.current = true;
    try {
      const today = format(selectedDate, 'yyyy-MM-dd');
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today,
          entries: changedEntries.map((entry) => ({
            ...entry,
            arrivalTimeCleared: !entry.arrivalTime && Boolean(originalEntrySnapshots[entry.staffId]?.arrivalTime),
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
        const blocked = Array.isArray(data.blockedCheckInRemovals) ? data.blockedCheckInRemovals as string[] : [];
        setMessage(blocked.length > 0
          ? {
              type: 'error',
              text: `Not removed for ${blocked.join(', ')}: that day has a payment or pardon. Reverse it on Payments first. Other changes were saved.`,
            }
          : {
              type: 'success',
              text: formatChangedEntriesMessage(changedStaffNames, changedStaffCount),
            });
        // What was just saved is now the baseline, so the follow-up refresh replaces these rows
        // with the saved values instead of treating them as still being edited.
        const savedSnapshots = Object.fromEntries(changedEntries.map((entry) => [entry.staffId, snapshotEntry(entry)]));
        snapshotsRef.current = { ...snapshotsRef.current, ...savedSnapshots };
        setOriginalEntrySnapshots((current) => ({ ...current, ...savedSnapshots }));
        setConflictStaffIds(new Set());
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
      savingRef.current = false;
      // Auto-dismiss message after 5 seconds
      setTimeout(() => setMessage(null), 5000);
    }
  }

  async function pardonLateArrival() {
    if (!lateArrivalPardonTarget) return;
    const { mode, staffId, staffName } = lateArrivalPardonTarget;

    setPardoningLateArrival(true);
    try {
      const response = await fetch('/api/attendance/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrivalWindow: 'any_time_today',
          date: format(selectedDate, 'yyyy-MM-dd'),
          permissionType: 'late_arrival',
          reason: lateArrivalPardonReason,
          staffId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to pardon late arrival');
      }

      // Waive all: also waive the no-sign-out charge for this one row, saved straight away.
      let signOutWaiverError: string | null = null;
      if (mode === 'all') {
        const entry = entriesRef.current.find((row) => row.staffId === staffId);
        const original = snapshotsRef.current[staffId];
        if (entry) {
          const waiverResponse = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: format(selectedDate, 'yyyy-MM-dd'),
              entries: [{
                ...entry,
                didNotSignOut: false,
                didNotSignOutChanged: original?.didNotSignOut !== false,
                noShowSignInWaivedChanged: false,
                noSignOutWaived: true,
                noSignOutWaivedChanged: original?.noSignOutWaived !== true,
                signOutTime: '',
                signOutTimeChanged: false,
              }],
            }),
          });
          if (!waiverResponse.ok) {
            const waiverBody = await waiverResponse.json().catch(() => ({}));
            signOutWaiverError = waiverBody?.error || 'the no-sign-out waiver could not be saved';
          }
        }
      }

      setLateArrivalPardonTarget(null);
      setMessage(signOutWaiverError
        ? { type: 'error', text: `Late fee waived for ${staffName}, but ${signOutWaiverError}. Use Waive no sign-out, then Save Entries.` }
        : body?.reconciliation?.financialReviewRequired
          ? {
              type: 'error',
              text: `Late arrival permission recorded for ${staffName}, but the amount was not changed because a payment is already allocated to this entry. Review it on Payments.`,
            }
          : { type: 'success', text: mode === 'all' ? `All charges waived for ${staffName}.` : `Late fee waived for ${staffName}.` });
      await fetchStaffAndEntries();
    } catch (error) {
      console.error('Failed to pardon late arrival:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to pardon late arrival' });
    } finally {
      setPardoningLateArrival(false);
      setTimeout(() => setMessage(null), 5000);
    }
  }

  function changeSelectedDate(nextDate: Date) {
    if (changedEntries.length > 0 && !window.confirm('You have unsaved changes on this day. Leave without saving them?')) return;
    setSelectedDate(nextDate);
    setMessage(null);
  }

  // Warn before closing or reloading the tab with unsaved edits.
  useEffect(() => {
    if (changedEntries.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changedEntries.length]);

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

  // Day Summary, counted from each row's sign-in and sign-out:
  // on time = signed in by 8:30; late = signed in after 8:30 without a late permission;
  // no sign-in = charged for not signing in; excused = on leave, excused absence, late
  // permission or a waived no sign-in. People not in yet (before 4:30 PM) are in none of these.
  const totals = entries.reduce(
    (acc, entry) => {
      const onLeave = staff.find((member) => member.id === entry.staffId)?.onLeave === true;
      if (onLeave) return { ...acc, excused: acc.excused + 1 };
      const next = { ...acc, totalAmount: acc.totalAmount + entry.amount };
      if (entry.isExcusedAbsence) next.excused += 1;
      else if (entry.arrivalTime) {
        if (isOnTimeCheckIn(entry.arrivalTime)) next.onTime += 1;
        else if (entry.reason.includes(LATE_ARRIVAL_PARDON_REASON_PREFIX)) next.excused += 1;
        else next.late += 1;
      } else if (entry.noShowSignInWaived) next.excused += 1;
      else if (entry.reason === NO_SHOW_SIGN_IN_REASON) next.noSignIn += 1;
      if (entry.didNotSignOut && !entry.noSignOutWaived) next.didNotSignOut += 1;
      return next;
    },
    { didNotSignOut: 0, excused: 0, late: 0, noSignIn: 0, onTime: 0, totalAmount: 0 },
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

  if (loadError) {
    return (
      <DashboardLayout title="Entries">
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-5 text-danger sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Entries could not be loaded</p>
              <p className="mt-1 text-sm">{loadError}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void fetchStaffAndEntries()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
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
        {showBackToPayments && (
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
                  <th className="min-w-[15rem] px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</th>
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
                  const isMonitoringStaff = (member?.chargeOnDate ?? member)?.isAttendanceOnly === true;
                  const isOnLeave = member?.onLeave === true;
                  const leaveSummary = member?.activeLeave ? formatLeaveSummary(member.activeLeave) : null;
                  const rowDisabled = entriesDisabled || isOnLeave;
                  const showNoShowSignInWaiverButton =
                    !rowDisabled &&
                    !entry.arrivalTime &&
                    !entry.isExcusedAbsence &&
                    !isMonitoringStaff &&
                    (
                      noShowSignInWaiveAvailable ||
                      entry.reason === NO_SHOW_SIGN_IN_REASON ||
                      entry.reason === NO_SHOW_SIGN_IN_WAIVED_REASON ||
                      entry.noShowSignInWaived
                    );
                  const hasUnsavedChanges = !entryMatchesSnapshot(entry, originalEntrySnapshots[entry.staffId]);
                  const showLateArrivalPardonButton =
                    !rowDisabled &&
                    !isMonitoringStaff &&
                    isSelectedDateInPastOrToday &&
                    Boolean(entry.arrivalTime) &&
                    entry.amount > 0 &&
                    entry.reason.includes(LATE_ARRIVAL_PENALTY_REASON);
                  const signInField: { state: TimeFieldState; text?: string; title?: string } = isOnLeave
                    ? { state: 'leave', text: 'On leave' }
                    : entry.isExcusedAbsence
                      ? { state: 'excused', text: 'Excused' }
                      : entry.arrivalTime
                        ? entry.amount === 0 && entry.reason.includes(LATE_ARRIVAL_PARDON_REASON_PREFIX)
                          ? { state: 'waived', title: 'Late permission' }
                          : entry.amount > 0 && entry.reason.includes(LATE_ARRIVAL_PENALTY_REASON)
                            ? { state: 'late', title: 'Late arrival' }
                            : { state: 'ok' }
                        : entry.noShowSignInWaived
                          ? { state: 'waived', text: 'Waived', title: 'No sign-in waived' }
                          : entry.reason === NO_SHOW_SIGN_IN_REASON
                            ? { state: 'missing', text: 'No sign-in', title: 'No sign-in: charged' }
                            : { state: 'empty' };
                  const signOutField: { state: TimeFieldState; text?: string; title?: string } = isOnLeave
                    ? { state: 'leave', text: 'On leave' }
                    : entry.isExcusedAbsence
                      ? { state: 'excused', text: 'Excused' }
                      : entry.signOutTime
                        ? { state: 'ok' }
                        : entry.noSignOutWaived
                          ? { state: 'waived', text: 'Waived', title: 'No sign-out waived' }
                          : entry.didNotSignOut
                            ? { state: 'missing', text: 'No sign-out', title: 'No sign-out: charged' }
                            : { state: 'empty' };
                  const statusTag = getEntryStatusTag(entry, isOnLeave ? leaveSummary : undefined);
                  // Two charges on the row (late + no sign-out): offer one action for both.
                  const showWaiveAllButton =
                    showLateArrivalPardonButton &&
                    entry.didNotSignOut &&
                    !entry.noSignOutWaived &&
                    !entry.signOutTime;
                  return (
                    <tr key={entry.staffId} className="hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td className="min-w-[15rem] px-4 py-3 text-sm font-medium">
                        <div className="whitespace-nowrap">{member?.fullName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                          {statusTag && (
                            <span className={STATUS_TAG_CLASS}>
                              {statusTag.label}{statusTag.detail ? ` · ${statusTag.detail}` : ''}
                            </span>
                          )}
                          {hasUnsavedChanges && conflictStaffIds.has(entry.staffId) && (
                            <span
                              className="shrink-0 whitespace-nowrap rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                              title="Another admin saved a change to this row while you were editing it. Saving keeps your version."
                            >
                              Changed by another admin
                            </span>
                          )}
                          {member?.archived && (
                            <span className="whitespace-nowrap rounded-full border border-warning/25 px-2 py-0.5 text-[11px] font-medium text-warning">
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
                            disabled={rowDisabled}
                            label="Sign-in time"
                            state={signInField.state}
                            emptyText={signInField.text}
                            title={signInField.title}
                          />
                          {showNoShowSignInWaiverButton && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={rowDisabled}
                              onClick={() => toggleNoShowSignInWaiver(entry.staffId)}
                            >
                              {entry.noShowSignInWaived ? (
                                <>Remove waiver</>
                              ) : (
                                <>Waive no sign-in</>
                              )}
                            </Button>
                          )}
                          {showLateArrivalPardonButton && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={hasUnsavedChanges || pardoningLateArrival}
                              title={hasUnsavedChanges ? 'Save entries first' : undefined}
                              onClick={() => {
                                setLateArrivalPardonReason('personal excuse');
                                setLateArrivalPardonTarget({ amount: entry.amount, mode: 'late', staffId: entry.staffId, staffName: member?.fullName || 'staff member' });
                              }}
                            >
                              Waive late fee
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TimeSelector
                            value={entry.signOutTime}
                            onChange={(value) => updateSignOutTime(entry.staffId, value)}
                            disabled={rowDisabled}
                            label="Sign-out time"
                            max="23:59"
                            state={signOutField.state}
                            emptyText={signOutField.text}
                            title={signOutField.title}
                          />
                          {/* No sign-in means no sign-out charge, so nothing to waive there. */}
                          {!entry.signOutTime && Boolean(entry.arrivalTime) && !entry.isExcusedAbsence && !isOnLeave && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={rowDisabled}
                              onClick={() => toggleNoSignOutWaiver(entry.staffId)}
                            >
                              {entry.noSignOutWaived ? (
                                <>Remove waiver</>
                              ) : (
                                <>Waive no sign-out</>
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {entry.amount > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-danger">GHC {entry.amount}</span>
                            {showWaiveAllButton && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="font-sans"
                                disabled={hasUnsavedChanges || pardoningLateArrival}
                                title={hasUnsavedChanges ? 'Save entries first' : 'Waive the late fee and the no sign-out charge'}
                                onClick={() => {
                                  setLateArrivalPardonReason('personal excuse');
                                  setLateArrivalPardonTarget({ amount: entry.amount, mode: 'all', staffId: entry.staffId, staffName: member?.fullName || 'staff member' });
                                }}
                              >
                                Waive all
                              </Button>
                            )}
                          </div>
                        ) : (
                          // Money only: excuses, pardons and waivers show as name tags and field states.
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {/* A permission or excuse is already shown as a tag; only charges and notes stay here. */}
                        {statusTag?.coversReason ? '-' : entry.reason || '-'}
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-success">{totals.onTime}</p>
                <p className="text-xs text-muted-foreground mt-1">On Time</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-danger">{totals.late}</p>
                <p className="text-xs text-muted-foreground mt-1">Late</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-danger">{totals.noSignIn}</p>
                <p className="text-xs text-muted-foreground mt-1">No Sign In</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-warning">{totals.didNotSignOut}</p>
                <p className="text-xs text-muted-foreground mt-1">No Sign Out</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono text-muted-foreground">{totals.excused}</p>
                <p className="text-xs text-muted-foreground mt-1">Excused / Leave</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold font-mono">GHC {totals.totalAmount}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Amount</p>
              </div>
            </div>
          </div>
        </Card>

      </div>

      <Dialog
        open={Boolean(lateArrivalPardonTarget)}
        onOpenChange={(open) => {
          if (!open && !pardoningLateArrival) setLateArrivalPardonTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lateArrivalPardonTarget?.mode === 'all' ? 'Waive all charges' : 'Waive late fee'}</DialogTitle>
            <DialogDescription>
              {lateArrivalPardonTarget?.staffName} / {formatLongDisplayDate(selectedDateKey)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="late-arrival-pardon-reason" className="text-sm font-medium">Reason</label>
            <select
              id="late-arrival-pardon-reason"
              value={lateArrivalPardonReason}
              onChange={(event) => setLateArrivalPardonReason(event.target.value)}
              disabled={pardoningLateArrival}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary"
            >
              {LATE_ARRIVAL_PERMISSION_REASONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {lateArrivalPardonTarget?.mode === 'all'
                ? `Clears GHC ${lateArrivalPardonTarget.amount}: the late fee and the no sign-out charge.`
                : 'Late fee only. No sign-out has its own Waive button.'}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLateArrivalPardonTarget(null)} disabled={pardoningLateArrival}>
              Cancel
            </Button>
            <Button onClick={() => void pardonLateArrival()} disabled={pardoningLateArrival}>
              {pardoningLateArrival ? 'Waiving…' : lateArrivalPardonTarget?.mode === 'all' ? 'Waive all' : 'Waive late fee'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

export default function EntriesPage() {
  return (
    <Suspense fallback={
      <DashboardLayout title="Entries">
        <LoadingBuffer
          variant="page"
          label="Loading entries"
          description="Checking staff, holidays, and saved records."
        />
      </DashboardLayout>
    }>
      <EntriesPageContent />
    </Suspense>
  );
}

type TimeFieldState = 'ok' | 'late' | 'missing' | 'waived' | 'excused' | 'leave' | 'empty';

// Each state is shown on the field itself (outline, icon, and the text inside when there is no time),
// so the sign-in and sign-out columns read the same way without notes underneath.
const TIME_FIELD_STATE: Record<TimeFieldState, { field: string; icon: string; Icon: typeof Clock | null; text: string }> = {
  ok: { field: '', icon: 'text-muted-foreground', Icon: CheckCircle, text: '' },
  late: { field: 'border-warning/60 bg-warning/5', icon: 'text-warning', Icon: ClockAlert, text: '' },
  missing: { field: 'border-danger/60 bg-danger/5', icon: 'text-danger', Icon: AlertCircle, text: 'text-danger' },
  waived: { field: 'border-dashed', icon: 'text-muted-foreground', Icon: ShieldCheck, text: 'text-muted-foreground' },
  excused: { field: 'opacity-70', icon: 'text-muted-foreground', Icon: CalendarOff, text: 'text-muted-foreground' },
  leave: { field: 'opacity-70', icon: 'text-muted-foreground', Icon: CalendarOff, text: 'text-muted-foreground' },
  empty: { field: '', icon: 'text-muted-foreground', Icon: null, text: 'text-muted-foreground' },
};

function TimeSelector({
  disabled,
  emptyText,
  label = 'Time',
  max = '18:00',
  min = '06:00',
  onChange,
  state = 'empty',
  title,
  value,
}: {
  disabled?: boolean;
  /** Shown inside the field when there is no time, e.g. "No sign-out" or "Waived". */
  emptyText?: string;
  label?: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  state?: TimeFieldState;
  title?: string;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const time = normalizeTimeValue(value);
  const look = TIME_FIELD_STATE[state];
  const StateIcon = look.Icon;
  const showText = !time && !focused && Boolean(emptyText);

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
    <div className="relative w-44" title={title}>
      {StateIcon && (
        <StateIcon aria-hidden className={cn('pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2', look.icon)} />
      )}
      <Input
        ref={inputRef}
        aria-label={emptyText && !time ? `${label}: ${emptyText}` : label}
        className={cn(
          'latewatch-native-time-input h-9 w-full font-mono text-sm font-medium [color-scheme:light] dark:[color-scheme:dark]',
          StateIcon ? 'pl-8' : 'pl-3',
          time && !disabled ? 'pr-14' : 'pr-9',
          look.field,
          showText && 'text-transparent',
        )}
        disabled={disabled}
        max={max}
        min={min}
        step={300}
        type="time"
        value={time}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
      />
      {showText && (
        <span aria-hidden className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-sm font-medium', StateIcon ? 'left-8' : 'left-3', look.text)}>
          {emptyText}
        </span>
      )}
      {time && !disabled && (
        <button
          aria-label={`Clear ${label.toLowerCase()}`}
          title={`Clear ${label.toLowerCase()}`}
          className="absolute right-8 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35"
          type="button"
          onClick={() => onChange('')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
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
