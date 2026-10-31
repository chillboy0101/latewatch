/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const {
  allowedStaffTypes,
  canChangeStaffType,
  isValidDateKey,
  penaltyFlagsOn,
  staffReturnDateError,
  staffTypeChangeError,
  staffTypeOf,
  staffTypeOn,
  undoableStaffTypeChange,
} = require('../src/lib/staff-type.ts');
const { planStaffPenaltyRecalculation } = require('../src/lib/staff-penalty-recalculation.ts');

// Ama: intern last year, NSS from 1 Mar, main staff from 1 Oct; archived 1-14 Jul in between.
const amaChanges = [
  { effectiveFrom: '2000-01-01', staffType: 'intern' },
  { effectiveFrom: '2026-03-01', staffType: 'nss' },
  { effectiveFrom: '2026-07-01', staffType: 'away' },
  { effectiveFrom: '2026-07-15', staffType: 'nss' },
  { effectiveFrom: '2026-10-01', staffType: 'main' },
];
const amaNow = { isAttendanceOnly: false, isNssPersonnel: false, staffType: 'main' };

test('the type on a day is the latest change on or before it', () => {
  assert.equal(staffTypeOn('2025-11-03', amaChanges, amaNow), 'intern');
  assert.equal(staffTypeOn('2026-02-28', amaChanges, amaNow), 'intern');
  assert.equal(staffTypeOn('2026-03-01', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-07-10', amaChanges, amaNow), 'away');
  assert.equal(staffTypeOn('2026-07-15', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-09-30', amaChanges, amaNow), 'nss');
  assert.equal(staffTypeOn('2026-10-01', amaChanges, amaNow), 'main');
  // Out of order rows are still read by date.
  assert.equal(staffTypeOn('2026-05-01', [...amaChanges].reverse(), amaNow), 'nss');
});

test('people who never changed type keep their current rules on every day', () => {
  assert.equal(staffTypeOn('2024-01-01', [], amaNow), 'main');
  assert.deepEqual(penaltyFlagsOn('2024-01-01', undefined, { isAttendanceOnly: true, isNssPersonnel: false }), {
    isAttendanceOnly: true,
    isNssPersonnel: false,
  });
  assert.equal(staffTypeOf({ isAttendanceOnly: true }), 'special');
  assert.equal(staffTypeOf({ isNssPersonnel: true }), 'nss');
  assert.equal(staffTypeOf({ staffType: 'intern', isAttendanceOnly: true }), 'intern');
});

test('a type change is written with the staff row, under the per-person lock', () => {
  const history = read('src/lib/staff-type-history.ts');
  assert.match(history, /const results = await db\.batch\(\[\.\.\.staffTypeChangeWrites\(change\), update\]\);/);
  assert.match(history, /SELECT pg_advisory_xact_lock\(hashtext\(\$\{`staff-type:\$\{input\.staffId\}`\}\)\)/);
  // The starting row is added only if they have no history yet, checked after the lock.
  assert.match(history, /WHERE NOT EXISTS \(SELECT 1 FROM \$\{staffTypeChange\} WHERE staff_id = \$\{input\.staffId\}\) AND \$\{unchanged\}/);
  // Every write checks the person is still as the request read them, after the lock; if not,
  // nothing is saved and the API says so (409) instead of saving over the other change.
  assert.match(history, /AND \$\{staff\.staffType\} = \$\{input\.previousType\}/);
  assert.match(history, /\.where\(and\(eq\(staff\.id, staffId\), stillAsRead\(change\)\)\)\.returning\(\)/);
  assert.match(history, /\.from\(staff\)\.where\(eq\(staff\.id, input\.staffId\)\)\.for\('update'\)/);
  const update = read('src/app/api/staff/[id]/route.ts');
  assert.match(update, /\? NextResponse\.json\(\{ error: CHANGED_MEANWHILE \}, \{ status: 409 \}\)/);
  assert.match(update, /if \(!updated\) return NextResponse\.json\(\{ error: CHANGED_MEANWHILE \}, \{ status: 409 \}\);/);
  assert.match(read('src/app/api/staff/route.ts'), /if \(!restored\) \{\n\s+return NextResponse\.json\(\{ error: `\$\{existingStaff\.fullName\} was just changed by someone else\. Reload and try again\.` \}, \{ status: 409 \}\);/);
});

test('interns, special staff and away days are never charged; NSS skips the hourly charge', () => {
  assert.deepEqual(penaltyFlagsOn('2025-11-03', amaChanges, amaNow), { isAttendanceOnly: true, isNssPersonnel: false });
  assert.deepEqual(penaltyFlagsOn('2026-07-10', amaChanges, amaNow), { isAttendanceOnly: true, isNssPersonnel: false });
  assert.deepEqual(penaltyFlagsOn('2026-05-04', amaChanges, amaNow), { isAttendanceOnly: false, isNssPersonnel: true });
  assert.deepEqual(penaltyFlagsOn('2026-10-05', amaChanges, amaNow), { isAttendanceOnly: false, isNssPersonnel: false });
});

test('types only move forward and main staff is final', () => {
  assert.deepEqual(allowedStaffTypes('intern'), ['intern', 'nss', 'special', 'main']);
  assert.deepEqual(allowedStaffTypes('nss'), ['nss', 'special', 'main']);
  assert.deepEqual(allowedStaffTypes('special'), ['special', 'main']);
  assert.deepEqual(allowedStaffTypes('main'), ['main']);
  assert.equal(canChangeStaffType('special', 'main'), true);
  assert.equal(canChangeStaffType('nss', 'intern'), false);
  assert.equal(canChangeStaffType('main', 'special'), false);

  const today = '2026-10-18';
  assert.equal(staffTypeChangeError({ effectiveFrom: today, from: 'main', to: 'nss', today }), 'Main staff stay main staff.');
  assert.match(staffTypeChangeError({ effectiveFrom: today, from: 'special', to: 'nss', today }), /can only move on to Main staff/);
  assert.match(staffTypeChangeError({ effectiveFrom: '2026-10-19', from: 'intern', to: 'main', today }), /future/);
  assert.match(staffTypeChangeError({ effectiveFrom: '2026-09-01', from: 'nss', latestChangeDate: '2026-09-15', to: 'main', today }), /before 2026-09-15/);
  assert.equal(staffTypeChangeError({ effectiveFrom: '2026-09-15', from: 'nss', latestChangeDate: '2026-09-15', to: 'main', today }), null);
  assert.equal(staffTypeChangeError({ effectiveFrom: today, from: 'nss', to: 'nss', today }), null);
});

const lateDay = (date, id) => ({
  checkInTime: '10:31:00',
  computedAmount: '0.00',
  date,
  id,
  reason: null,
  signOutTime: '17:00:00',
  status: 'present',
});

test('a former intern made main staff from a date is charged only from that date', () => {
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [lateDay('2026-09-29', 'a1'), lateDay('2026-10-02', 'a2')],
    currentDateKey: '2026-10-18',
    currentTimeKey: '12:00:00',
    isAttendanceOnly: false,
    isNssPersonnel: false,
    latenessEntries: [],
    permissions: [],
    staffId: 'ama',
    typeChanges: [
      { effectiveFrom: '2000-01-01', staffType: 'intern' },
      { effectiveFrom: '2026-10-01', staffType: 'main' },
    ],
  });
  assert.deepEqual(plan.latenessCreates.map((entry) => [entry.date, entry.computedAmount]), [['2026-10-02', '20.00']]);
  // The intern day stays at no charge.
  assert.deepEqual(plan.attendanceUpdates.map((update) => [update.id, update.computedAmount]), [['a1', '0.00'], ['a2', '20.00']]);
});

test('NSS made special staff from a date keeps the NSS charges before it', () => {
  const entry = (date, id) => ({
    arrivalTime: '10:31:00', computedAmount: '10.00', date, didNotSignOut: false, id, reason: "DIDN'T COME BEFORE 8:30AM", staffId: 'kofi',
  });
  const plan = planStaffPenaltyRecalculation({
    attendanceRecords: [lateDay('2026-09-29', 'a1'), lateDay('2026-10-02', 'a2')],
    currentDateKey: '2026-10-18',
    currentTimeKey: '12:00:00',
    isAttendanceOnly: true,
    isNssPersonnel: false,
    latenessEntries: [entry('2026-09-29', 'e1'), entry('2026-10-02', 'e2')],
    permissions: [],
    staffId: 'kofi',
    typeChanges: [
      { effectiveFrom: '2000-01-01', staffType: 'nss' },
      { effectiveFrom: '2026-10-01', staffType: 'special' },
    ],
  });
  assert.deepEqual(plan.latenessDeletes, [{ id: 'e2' }]);
  assert.deepEqual(plan.latenessUpdates, []);
});

test('the staff API checks type changes, saves them from a date and marks away days', () => {
  const update = read('src/app/api/staff/[id]/route.ts');
  const create = read('src/app/api/staff/route.ts');
  assert.match(update, /const typeError = staffTypeChangeError\(\{/);
  assert.match(update, /if \(nextType === 'main' && \(!nextStaffNo \|\| !nextRank\)\)/);
  assert.match(update, /effectiveFrom: nextDateKey\(today\), expected, previousType: beforeType, staffId: id, staffType: 'away' as const, today \}/);
  assert.match(update, /staffType: 'away' as const,/);
  assert.match(update, /const typeChange = typeChanged \|\| comingBack\n/);
  // The staff row and its history are saved together (one transaction).
  assert.match(update, /const updated = await saveStaffWithTypeChange\(id, updateData, typeChange\);/);
  assert.match(create, /const \[restored\] = await saveStaffWithTypeChange\(existingStaff\.id, \{/);
  assert.doesNotMatch(update + create, /recordStaffTypeChange/);
  assert.match(update, /reason: 'staff-type-changed',/);
  // Archiving from the delete action is away too.
  assert.match(update, /const archiveChange = before\.active === true && before\.archived !== true/);
  assert.match(update, /const \[updated\] = await saveStaffWithTypeChange\(\n\s+id,\n\s+\{ active: false, archived: true, archivedAt: new Date\(\), updatedAt: new Date\(\) \},\n\s+archiveChange,/);
  // The same person comes back on the same profile (by email or name), never a second account.
  assert.match(create, /const existingStaff = existingByEmail \|\| existingByName;/);
  assert.match(create, /\$\{existingStaff\.fullName\} is archived\. \$\{typeError\}/);
  // The general pardon now respects people who are never charged.
  assert.match(read('src/app/api/attendance/permissions/general-pardon/route.ts'), /isAttendanceOnly: member\.isAttendanceOnly,/);
  const migration = read('drizzle/0038_staff_type_history.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_type_change/);
  assert.match(migration, /SELECT s\.id, 'away'/);
});

test('returns keep days away and days under an earlier type; impossible dates are refused', () => {
  const today = '2026-10-18';
  // Away since 2 Aug: a return dated 1 Aug would charge Aug-Sep as no-shows.
  assert.match(staffReturnDateError({ awayStart: '2026-08-02', effectiveFrom: '2026-08-01', today }), /before 2026-08-02, when they left/);
  assert.equal(staffReturnDateError({ awayStart: '2026-08-02', effectiveFrom: '2026-08-02', today }), null);
  // Deactivated by mistake today (away from tomorrow): activating today is fine.
  assert.equal(staffReturnDateError({ awayStart: '2026-10-19', effectiveFrom: today, today }), null);
  // Same type, but dated before their last type change.
  assert.match(staffReturnDateError({ effectiveFrom: '2026-06-01', latestChangeDate: '2026-06-15', today }), /before 2026-06-15/);
  assert.match(staffReturnDateError({ effectiveFrom: '2026-10-19', today }), /future/);
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('2028-02-29'), true);
  assert.match(staffReturnDateError({ effectiveFrom: '2026-02-30', today }), /Choose the date/);
  assert.match(staffTypeChangeError({ effectiveFrom: '2026-02-30', from: 'intern', to: 'nss', today }), /Choose the date/);
});

test('the API refuses a type change while away and checks returns before saving anything', () => {
  const update = read('src/app/api/staff/[id]/route.ts');
  assert.match(update, /if \(typeChanged && wasAway && !comingBack\) \{/);
  assert.match(update, /Bring this person back \(Activate or Restore\) to change their type\./);
  // A type change and leaving in one request would record only the type: refused, one at a time.
  assert.match(update, /if \(typeChanged && goingAway\) \{\n[^\n]*\n\s+return NextResponse\.json\(\{ error: 'Change the type and deactivate or archive separately\.' \}, \{ status: 400 \}\);/);
  assert.match(update, /const history = typeChanged \|\| comingBack \? await staffHistorySummary\(id\) : null;/);
  assert.match(update, /const returnError = staffReturnDateError\(\{\n\s+awayStart: history\?\.awayStart \?\? null,/);
  // Both checks run before the staff row is written.
  assert.ok(update.indexOf('const returnError') < update.indexOf('const updated = await saveStaffWithTypeChange('));
  assert.ok(update.indexOf('const typeError') < update.indexOf('const updated = await saveStaffWithTypeChange('));
  // Only an away that hasn't started yet is dropped by a return.
  assert.match(read('src/lib/staff-type-history.ts'), /gt\(staffTypeChange\.effectiveFrom, input\.today\),/);
  assert.match(read('src/app/staff/page.tsx'), /disabledNote=\{!member\.active \|\| member\.archived \? 'Change the type when you Activate or Restore them\.' : undefined\}/);
});

test('only the latest type change can be undone, back to the type before it', () => {
  // Ama made main staff from 1 Oct by mistake: undo puts NSS back from that date.
  assert.deepEqual(undoableStaffTypeChange(amaChanges), {
    effectiveFrom: '2026-10-01', previousType: 'nss', revertOnly: false, staffType: 'main',
  });
  // A return as a later type (restored as special staff): the return stays, only the type reverts.
  assert.deepEqual(undoableStaffTypeChange([
    { effectiveFrom: '2000-01-01', staffType: 'nss' },
    { effectiveFrom: '2026-08-01', staffType: 'away' },
    { effectiveFrom: '2026-10-01', staffType: 'special' },
  ]), { effectiveFrom: '2026-10-01', previousType: 'nss', revertOnly: true, staffType: 'special' });
  // Nothing to undo: no history, only the start, a plain return, or away now.
  assert.equal(undoableStaffTypeChange([]), null);
  assert.equal(undoableStaffTypeChange([{ effectiveFrom: '2000-01-01', staffType: 'intern' }]), null);
  assert.equal(undoableStaffTypeChange([
    { effectiveFrom: '2000-01-01', staffType: 'nss' },
    { effectiveFrom: '2026-08-01', staffType: 'away' },
    { effectiveFrom: '2026-10-01', staffType: 'nss' },
  ]), null);
  assert.equal(undoableStaffTypeChange([...amaChanges, { effectiveFrom: '2026-10-10', staffType: 'away' }]), null);
});

test('type changes are confirmed before saving, and undo is admin-only, audited and recharged', () => {
  const undoRoute = read('src/app/api/staff/[id]/type-change/route.ts');
  assert.match(undoRoute, /const authError = await enforceRole\(\['admin'\]\);/);
  assert.match(undoRoute, /Bring this person back \(Activate or Restore\) before undoing a type change\./);
  // Only the change the admin confirmed is undone; anything changed meanwhile is a 409.
  assert.match(undoRoute, /const result = await undoLatestStaffTypeChange\(id, expected\);/);
  assert.match(undoRoute, /\{ status: 409 \}/);
  assert.match(undoRoute, /identitySync = sync\.status;/);
  assert.match(undoRoute, /reason: 'staff-type-change-undone',/);
  assert.match(undoRoute, /await recalculateStaffStoredPenalties\(\{/);
  const history = read('src/lib/staff-type-history.ts');
  assert.match(history, /const historyWrites = undo\.revertOnly/);
  // History and staff row change together in one batch, each guarded against a change meanwhile.
  assert.match(history, /const results = await db\.batch\(\[\n\s+db\.execute\(sql`SELECT pg_advisory_xact_lock/);
  assert.match(history, /\.where\(and\(eq\(staff\.id, staffId\), eq\(staff\.staffType, undo\.staffType\)\)\)/);
  // Every history write shares the staff row's check, so a failed check changes nothing at all.
  assert.match(history, /const stillUndoable = sql`EXISTS \(SELECT 1 FROM \$\{staff\} WHERE/);
  assert.equal((history.match(/stillUndoable/g) || []).length, 3);
  // Their staff row is locked before any history write, so the check can't change mid-batch.
  assert.match(history, /pg_advisory_xact_lock[^\n]*\n[^\n]*\n\s+db\.select\(\{ id: staff\.id \}\)\.from\(staff\)\.where\(eq\(staff\.id, staffId\)\)\.for\('update'\),\n\s+\.\.\.historyWrites,/);
  assert.match(history, /if \(undo\.effectiveFrom !== expected\.effectiveFrom \|\| undo\.staffType !== expected\.staffType\) \{/);
  const page = read('src/app/staff/page.tsx');
  assert.match(page, /onClick=\{\(\) => \(editStaffType !== editOriginalType \? setConfirmTypeChange\(true\) : handleEdit\(\)\)\}/);
  assert.match(page, /Days before stay \{STAFF_TYPE_LABELS\[editOriginalType\]\}\./);
  assert.match(page, /fetch\(`\/api\/staff\/\$\{member\.id\}\/type-change\?\$\{query\}`, \{ method: 'DELETE' \}\)/);
  assert.match(page, /if \(body\.identitySync === 'sync_failed'\) \{/);
  assert.match(page, /Undo last type change \(/);
  // The Audit Trail row summary names the change and its date.
  const display = read('src/lib/audit-display.ts');
  assert.match(display, /\$\{typeChange\.from\} → \$\{typeChange\.to\} from/);
  assert.match(display, /type change undone, back to/);
});
