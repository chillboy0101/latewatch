/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const entriesPagePath = path.join(__dirname, '../src/app/entries/page.tsx');
const entriesRoutePath = path.join(__dirname, '../src/app/api/entries/route.ts');
const recalculateScriptPath = path.join(__dirname, '../scripts/recalculate-regular-staff-penalties.mjs');

test('entries page live penalty calculation preserves monitoring-only staff rules', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isAttendanceOnly\?: boolean \| null/);
  // The rules for the selected date: the person's type then, not now.
  assert.match(source, /isAttendanceOnly: \(member\?\.chargeOnDate \?\? member\)\?\.isAttendanceOnly === true/);
});

test('entries page shows leave for the selected date and excludes it from totals', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /fetch\(`\/api\/staff\?date=\$\{selectedDateKey\}`/);
  assert.match(source, /const isOnLeave = member\?\.onLeave === true/);
  assert.match(source, /On leave/);
  assert.match(source, /const rowDisabled = entriesDisabled \|\| isOnLeave/);
  // People on leave are counted under Excused / Leave and add nothing to the day's total.
  assert.match(source, /if \(onLeave\) return \{ \.\.\.acc, excused: acc\.excused \+ 1 \};/);
  assert.match(source, /const next = \{ \.\.\.acc, totalAmount: acc\.totalAmount \+ entry\.amount \};/);
});

test('entries page exposes an icon-only refresh button beside save entries', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /RefreshCw/);
  assert.match(source, /aria-label="Refresh entries"/);
  assert.match(source, /onClick=\{\(\) => \{\s*setMessage\(null\);\s*void fetchStaffAndEntries\(\);\s*\}\}/);
  assert.match(source, /<RefreshCw className="h-4 w-4" \/>/);
});

test('entries page filters visible rows with a toolbar search without changing saved rows', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /Search/);
  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(\(\) => queryParam \|\| ''\)/);
  assert.match(source, /placeholder="Search staff or entry"/);
  assert.match(source, /aria-label="Search entries"/);
  assert.match(source, /const visibleEntries = useMemo/);
  assert.match(source, /visibleEntries\.map/);
  assert.doesNotMatch(source, /\{entries\.map\(\(entry, index\) =>/);
  assert.match(source, /entries: changedEntries\.map/);
});

test('entries page search includes staff fields and flexible time tokens', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /member\?\.fullName/);
  assert.match(source, /member\?\.email/);
  assert.match(source, /member\?\.staffNo/);
  assert.match(source, /member\?\.department/);
  assert.match(source, /member\?\.unit/);
  assert.match(source, /member\?\.rank/);
  assert.match(source, /entry\.arrivalTime/);
  assert.match(source, /entry\.signOutTime/);
  assert.match(source, /function getTimeSearchTokens/);
  assert.match(source, /function getSearchNeedleGroups/);
  assert.match(source, /\$\{paddedHour\}:\$\{minute\}/);
  assert.match(source, /\$\{unpaddedHour\}:\$\{minute\}/);
  assert.match(source, /\$\{paddedHour\}\$\{minute\}/);
  assert.match(source, /\$\{unpaddedHour\}\$\{minute\}/);
  assert.match(source, /\.\.\.getTimeSearchTokens\(entry\.arrivalTime\)/);
  assert.match(source, /\.\.\.getTimeSearchTokens\(entry\.signOutTime\)/);
  assert.match(source, /entries: changedEntries\.map/);
});

test('entries page uses general entries wording instead of lateness-only labels', () => {
  const pageSource = fs.readFileSync(entriesPagePath, 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../src/components/layout/sidebar.tsx'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '../src/components/layout/app-shell.tsx'), 'utf8');
  const exportsPageSource = fs.readFileSync(path.join(__dirname, '../src/app/exports/page.tsx'), 'utf8');

  assert.match(pageSource, /DashboardLayout title="Entries"/);
  assert.match(pageSource, /Save Entries/);
  assert.match(sidebarSource, /name: 'Entries'/);
  assert.match(sidebarSource, /name: 'Exports'/);
  assert.match(sidebarSource, /name: 'Payments'/);
  assert.match(shellSource, /entries: 'Entries'/);
  assert.match(shellSource, /exports: 'Exports'/);
  assert.match(shellSource, /payments: 'Payments'/);
  assert.match(exportsPageSource, /DashboardLayout title="Exports"/);
  assert.match(exportsPageSource, />Lateness Exports</);
  assert.match(exportsPageSource, />Attendance Exports</);
  assert.doesNotMatch(pageSource, /Save Lateness Entries/);
  assert.doesNotMatch(sidebarSource, /Lateness Entries/);
  assert.doesNotMatch(sidebarSource, /Lateness Exports/);
  assert.doesNotMatch(sidebarSource, /Penalty Payments/);
  assert.doesNotMatch(shellSource, /Lateness Entries/);
  assert.doesNotMatch(shellSource, /Lateness Exports/);
  assert.doesNotMatch(shellSource, /Penalty Payments/);
});

test('entries page omits removed manual message queue controls', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const brand = ['Whats', 'App'].join('');
  const apiSegment = ['/api/', ['what', 'sapp'].join('')].join('');
  const queueSymbol = `${brand}NoticeQueue`;

  assert.doesNotMatch(source, new RegExp(`Send ${brand} Notices`));
  assert.doesNotMatch(source, new RegExp(apiSegment));
  assert.doesNotMatch(source, new RegExp(queueSymbol));
});

test('entries page tags general pardons under the name and keeps the amount column for money', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /if \(entry\.isGeneralPardon\) return \{ coversReason: entry\.amount === 0, label: 'General pardon' \};/);
  assert.doesNotMatch(source, />General pardon<\/span>/);
  assert.doesNotMatch(source, /bg-success\/10 px-2 py-1 text-xs font-semibold text-success">(Excused|Pardoned|General pardon)/);
});

test('entries page shows waived no-sign-out rows without a charge', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /noSignOutWaived/);
  assert.match(source, /\{ state: 'waived', text: 'Waived', title: 'No sign-out waived' \}/);
});

test('entries page tracks changed rows and submits only precise updates', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /originalEntrySnapshots/);
  assert.match(source, /changedEntries/);
  assert.match(source, /entries: changedEntries/);
  assert.match(source, /signOutTime/);
  assert.match(source, /noSignOutWaivedChanged/);
  assert.match(source, /No changes to save\./);
  assert.match(source, /Save 1 Change/);
  assert.match(source, /Save \$\{changedEntries\.length\} Changes/);
  assert.match(source, /formatChangedEntriesMessage/);
});

test('entries API sources saved arrival times from attendance records', () => {
  const source = fs.readFileSync(entriesRoutePath, 'utf8');

  assert.match(source, /checkInTime: attendanceRecord\.checkInTime/);
  assert.match(source, /signOutTime: attendanceRecord\.signOutTime/);
  assert.match(source, /arrivalWindow: attendancePermission\.arrivalWindow/);
  assert.match(source, /expectedEndTime: attendancePermission\.expectedEndTime/);
  assert.match(source, /expectedStartTime: attendancePermission\.expectedStartTime/);
  assert.match(source, /mergeAttendanceRowsIntoEntryRows\(\{ attendanceRows, entryRows: entries, permissionRows \}\)/);
});

test('entries API refuses manual edits for staff on approved leave', () => {
  const source = fs.readFileSync(entriesRoutePath, 'utf8');

  assert.match(source, /staffLeavePeriod/);
  assert.match(source, /isStaffLeaveDate\(leavePeriods, entry\.staffId, date\)/);
  assert.match(source, /Entries cannot be edited for staff on approved leave/);
  assert.match(source, /status: 409/);
});

test('entries page separates real sign-out time from waiver state', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /Sign In/);
  assert.match(source, /Sign Out/);
  assert.match(source, /updateSignOutTime/);
  assert.match(source, /toggleNoSignOutWaiver/);
  assert.match(source, />Waive no sign-out</);
  assert.match(source, />Waive no sign-in</);
  assert.match(source, />Remove waiver</);
  assert.doesNotMatch(source, />Time<\/th>/);
  assert.doesNotMatch(source, /No Sign Out<\/th>/);
});

test('entries page renders excused absence permissions without missing sign-out controls', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');

  assert.match(source, /isExcusedAbsence/);
  assert.match(source, /label: 'Excused'/);
  assert.match(source, /!entry\.isExcusedAbsence/);
  assert.match(source, /entry\.isExcusedAbsence\s+\? \{ state: 'excused', text: 'Excused' \}/);
});

test('entries time fields show their state on the field and can be cleared', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'entries', 'route.ts'), 'utf8');
  assert.match(source, /type TimeFieldState = 'ok' \| 'late' \| 'missing' \| 'waived' \| 'excused' \| 'leave' \| 'empty';/);
  assert.match(source, /\{ state: 'missing', text: 'No sign-out', title: 'No sign-out: charged' \}/);
  assert.match(source, /\{ state: 'missing', text: 'No sign-in', title: 'No sign-in: charged' \}/);
  assert.doesNotMatch(source, /'Missing'\}/);
  assert.match(source, /aria-label=\{`Clear \$\{label\.toLowerCase\(\)\}`\}/);
  // Clearing a saved sign-in removes the day's check-in, after confirmation, never touching paid or pardoned days.
  assert.match(source, /arrivalTimeCleared: !entry\.arrivalTime && Boolean\(originalEntrySnapshots\[entry\.staffId\]\?\.arrivalTime\)/);
  assert.match(source, /Remove the check-in for/);
  assert.match(route, /if \(entry\.arrivalTimeCleared === true && !arrivalTime && existingAttendance\?\.checkInTime\)/);
  // Removing a check-in never touches a paid or pardoned day, even one settled mid-save.
  assert.match(route, /if \(!\(await deleteUnsettledLatenessEntry\(existing\.id\)\)\) \{\s*blockedCheckInRemovals\.push\(staffName\);/);
  // A reopened leave has every day since re-checked, clearing the no-shows charged meanwhile.
  assert.match(route, /if \(reopenedLeaveCount > 0\) \{\s*await recalculateDaysAfterLeaveChange\(date, getAccraDateKey\(\)\);/);
  assert.match(route, /reason: 'staff-leave-reopened-check-in-removed'/);
  assert.match(route, /await applyNoShowSignInPenaltiesForDate\(date\)/);
});

test('regular staff recalculation apply notifies live pages to refetch entries', () => {
  const source = fs.readFileSync(recalculateScriptPath, 'utf8');

  assert.match(source, /async function publishInvalidation/);
  assert.match(source, /latewatch:\$\{channel\}/);
  assert.match(source, /'entries'/);
  assert.match(source, /'attendance'/);
  assert.match(source, /'dashboard'/);
});

test('entries page pardons late arrivals through an approved late-arrival permission', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'entries', 'page.tsx'), 'utf8');

  assert.match(source, /fetch\('\/api\/attendance\/permissions'/);
  assert.match(source, /permissionType: 'late_arrival'/);
  assert.match(source, /arrivalWindow: 'any_time_today'/);
  assert.match(source, /entry\.reason\.includes\(LATE_ARRIVAL_PENALTY_REASON\)/);
  assert.match(source, /disabled=\{hasUnsavedChanges \|\| pardoningLateArrival\}/);
  assert.match(source, /financialReviewRequired/);
});

test('payments and offence book ignore pardons on entries that no longer carry a penalty', () => {
  const payments = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'payments', 'lateness', 'route.ts'), 'utf8');
  const exportRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'export', 'offence-book', 'route.ts'), 'utf8');
  const itemsRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'payments', 'offence-book-items', 'route.ts'), 'utf8');

  assert.match(payments, /const penaltyEntries = entryRows\.filter\(\(entry\) => Number\(entry\.computedAmount \|\| 0\) > 0\);/);
  assert.doesNotMatch(payments, /computedAmount: pardon\.penaltyAmount/);
  assert.match(exportRoute, /pardonedAmount: currentPardonedAmount\(entry\.computedAmount,/);
  assert.match(itemsRoute, /pardonedAmount: currentPardonedAmount\(entry\.computedAmount,/);
});

test('entries page keeps unsaved edits when another admin saves', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  // Background refreshes merge instead of replacing the grid.
  assert.match(source, /const isRefresh = loadedDateRef\.current === selectedDateKey;/);
  assert.match(source, /if \(!isRefresh\) setLoading\(true\);/);
  assert.match(source, /return \{ \.\.\.serverEntry, \.\.\.pickEditableFields\(local\) \};/);
  // Same-row changes by someone else are flagged, but not the echo of this page's own save.
  assert.match(source, /if \(!savingRef\.current && !entryMatchesSnapshot\(serverEntry, base\)\) newConflicts\.push/);
  assert.match(source, /Changed by another admin/);
  // Leaving with unsaved edits asks first.
  assert.match(source, /You have unsaved changes on this day\. Leave without saving them\?/);
  assert.match(source, /window\.addEventListener\('beforeunload', warn\)/);
});

test('entries page puts each waiver beside its charge and offers Waive all for two charges', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const signInCell = source.slice(source.indexOf('label="Sign-in time"'), source.indexOf('label="Sign-out time"'));
  assert.match(signInCell, />\s*Waive late fee\s*</);
  assert.match(signInCell, /Waive no sign-in/);
  assert.match(source, /const showWaiveAllButton =\s+showLateArrivalPardonButton &&\s+entry\.didNotSignOut &&\s+!entry\.noSignOutWaived/);
  assert.match(source, />\s*Waive all\s*</);
  // Waive all applies the late-fee permission, then saves the no-sign-out waiver for that row.
  assert.match(source, /if \(mode === 'all'\) \{/);
  assert.match(source, /noSignOutWaived: true,\s+noSignOutWaivedChanged:/);
});

test('entries status tags sit under the name in the theme colour, with a clear late icon', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  assert.match(source, /Icon: ClockAlert/);
  assert.doesNotMatch(source, /AlarmClock/);
  assert.match(source, /const STATUS_TAG_CLASS = 'whitespace-nowrap rounded-full border border-primary\/25 bg-primary\/10/);
  assert.match(source, /function getEntryStatusTag\(/);
  assert.match(source, /label: 'Late permission'/);
  assert.match(source, /\{statusTag\?\.coversReason \? '-' : entry\.reason \|\| '-'\}/);
});

test('a missing sign-out is only charged once the day is over (not when cleared earlier in the day)', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'entries', 'route.ts'), 'utf8');
  const workHours = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'work-hours.ts'), 'utf8');
  assert.match(workHours, /export function isNoSignOutChargeDue\(dateKey: string, todayKey: string, nowTimeKey: string\)/);
  assert.match(route, /const noSignOutChargeDue = isNoSignOutChargeDue\(date, getAccraDateKey\(\), getAccraTimeKey\(\)\);/);
  assert.match(route, /submittedSignOutTime \|\| requestedNoSignOutWaived \|\| !noSignOutChargeDue/);
  assert.match(source, /didNotSignOut: signOutTime \? false : !entry\.isExcusedAbsence && noSignOutDue/);
  assert.match(source, /didNotSignOut: nextWaived \? false : !normalizeTimeValue\(entry\.signOutTime\) && noSignOutDue/);
});

test('Day Summary counts no sign-in separately from late arrivals', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  assert.match(source, /if \(isOnTimeCheckIn\(entry\.arrivalTime\)\) next\.onTime \+= 1;/);
  assert.match(source, /else if \(entry\.reason === NO_SHOW_SIGN_IN_REASON\) next\.noSignIn \+= 1;/);
  assert.match(source, />No Sign In</);
  assert.match(source, />Excused \/ Leave</);
  assert.doesNotMatch(source, /entry\.amount > 0 && !entry\.reason\.includes\('SIGN OUT'\)/);
});

test('entries page shows a missed sign-out from 1 Oct 2026 as not charged, and still counts it', () => {
  const source = fs.readFileSync(entriesPagePath, 'utf8');
  assert.match(source, /const noSignOutCharged = chargesNoSignOut\(selectedDateKey\);/);
  assert.match(source, /selectedDateKey === todayDateKey && shouldAlertNoSignOut\(getAccraTimeKey\(\)\)/);
  assert.match(source, /missedUnchargedSignOut\(entry\)\s*\? \{ state: 'empty', text: 'No sign-out', title: 'No sign-out: not charged \(from 1 Oct 2026\)' \}/);
  assert.match(source, /\(entry\.didNotSignOut && !entry\.noSignOutWaived\) \|\| missedUnchargedSignOut\(entry\)/);
  // The late-fee dialog doesn't point at a no-sign-out Waive button that no longer shows.
  assert.match(source, /noSignOutCharged\s*\? 'Late fee only\. No sign-out has its own Waive button\.'\s*: 'Clears the late fee\.'/);
});
