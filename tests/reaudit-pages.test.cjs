/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('check-in: an approved late arrival reads "Checked in", and the sign-in nudge stops at 4:30', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  assert.match(page, /if \(status\.attendance\?\.checkInTime\) return 'Checked in';/);
  assert.doesNotMatch(page, /if \(status\.attendance\?\.status === 'present'\) return 'Checked in';/);
  assert.match(page, /const SIGN_IN_REMINDER_END_MINUTE = 16 \* 60 \+ 30;/);
});

test('check-in: receipts print the one on screen, lose "New" once seen, and fit a phone', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  const view = read('src', 'components', 'receipts', 'receipt-detail-view.tsx');
  assert.match(view, /async function loadReceipt\(\) \{\s*\/\/[^\n]*\n\s*setReceipt\(null\);/);
  assert.doesNotMatch(view, /min-w-\[28rem\]/);
  assert.match(page, /setReceiptHistory\(\(current\) => current\.map\(\(receipt\) => \(receipt\.id === id \? \{ \.\.\.receipt, read: true \} : receipt\)\)\);/);
});

test('check-in: turning a broken phone back on keeps the reminders the person chose', () => {
  const page = read('src', 'app', 'check-in', 'page.tsx');
  assert.match(page, /const keepChoice = refresh && Boolean\(chosen\?\.signInEnabled \|\| chosen\?\.signOutEnabled\);/);
});

test('payments: results show in the dialog, refreshes are quiet, drafts survive, "Nothing owed"', () => {
  const page = read('src', 'app', 'payments', 'page.tsx');
  assert.match(page, /setPaymentNotice\(\{ type: 'success', text: `Payment of \$\{currency\(input\.amount\)\} recorded\.` \}\);/);
  assert.match(page, /setPaymentNotice\(\{ type: 'error'/);
  assert.match(page, /if \(!paymentsLoadedRef\.current\) setLoading\(true\);/);
  assert.doesNotMatch(page, /setData\(null\);/);
  assert.match(page, /if \(options\.background && offenceBookDirtyRef\.current\) return;/);
  assert.match(page, /void loadOffenceBookItems\(\{ background: true \}\);/);
  assert.match(page, /\{status === 'paid' \? 'Nothing owed' : 'Unpaid'\}/);
  assert.match(page, /\{ label: 'Nothing owed', value: 'paid' \}/);
  assert.match(page, /toLocaleString\('en-GB', \{ month: 'short', year: 'numeric' \}\)/);
});

test('entries and overview keep their tables when a refresh fails', () => {
  const entries = read('src', 'app', 'entries', 'page.tsx');
  assert.match(entries, /if \(isRefresh\) setMessage\(\{ type: 'error'/);
  const overview = read('src', 'app', 'attendance', 'overview', 'page.tsx');
  assert.match(overview, /const quiet = loadedDateRef\.current === attendanceDate;/);
  assert.match(overview, /if \(!quiet\) setData\(null\);/);
  assert.match(overview, /refreshTimer = setTimeout\(\(\) => \{/);
});

test('overview: the penalty column shows the day charge, and removing a permission asks first', () => {
  const overview = read('src', 'app', 'attendance', 'overview', 'page.tsx');
  const api = read('src', 'app', 'api', 'attendance', 'route.ts');
  assert.match(overview, /Number\(row\.penaltyAmount \|\| 0\) > 0/);
  assert.match(api, /penaltyAmount: chargeByStaffId\.get\(member\.id\) \?\? null,/);
  assert.match(overview, /kind: 'remove_permission',/);
  assert.match(overview, /if \(action\?\.kind === 'remove_permission'\) void deletePermission\(action\.permissionId\);/);
  assert.doesNotMatch(overview, /onClick=\{\(\) => deletePermission\(permission\.id\)\}/);
});

test('location, staff and emergency contacts keep what is on screen and show errors', () => {
  const location = read('src', 'app', 'location', 'page.tsx');
  assert.match(location, /if \(incomingDefault && !limitsEditedRef\.current\) \{/);
  const staff = read('src', 'app', 'staff', 'page.tsx');
  assert.match(staff, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| `Staff could not be loaded/);
  assert.match(staff, /setEditError\(error instanceof Error \? error\.message : 'Changes could not be saved'\);/);
  assert.doesNotMatch(staff, /setStaff\(\[\]\);/);
  const contacts = read('src', 'app', 'emergency-contacts', 'page.tsx');
  assert.match(contacts, /if \(!loadedRef\.current\) setLoading\(true\);/);
  assert.doesNotMatch(contacts, /setContacts\(\[\]\);\n\s*\} finally/);
});

test('dashboard compares finished days with the same days last week', () => {
  const api = read('src', 'app', 'api', 'dashboard', 'route.ts');
  assert.match(api, /const comparable = comparedThrough >= weekStartStr;/);
  assert.match(api, /lte\(latenessEntry\.date, prevComparedThrough\)/);
  assert.match(api, /comparable && previous > 0 \? Math\.round/);
});
