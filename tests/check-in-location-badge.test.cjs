/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const checkInPagePath = path.join(__dirname, '../src/app/check-in/page.tsx');

test('check-in page uses compact location badge copy', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /Office location verified\. Accuracy/);
  assert.match(source, /distanceMeters: validation\.distanceMeters/);
  assert.match(source, /locationDistanceLabel\(liveLocation\.distanceMeters\)/);
  assert.match(source, /At office/);
  assert.match(source, /weak signal/);
  // Outside, the chip says how far (not "Not at office" under the "Not at the office" title).
  assert.doesNotMatch(source, /'Not at office'/);
  assert.match(source, /return distanceLabel \? `\$\{distanceLabel\} away` : 'Move closer';/);
  // Location off: what to do, not "Location needed" under "Location needed to check in".
  assert.match(source, /if \(liveLocation\.state === 'error'\) return canTurnOn \? 'Location off' : 'Location unavailable';/);
  assert.match(source, /locationValue\(status, liveLocation, Boolean\(onClick\)\)/);
});

test('check-in feedback shows in the status island', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  assert.doesNotMatch(source, /StatusMessageToast/);
  assert.match(source, /<StatusIsland message=\{message\} onDismiss=\{clearMessage\} \/>/);
  // A dark pill that springs open and shrinks away; a green tick or a red "!".
  assert.match(source, /rounded-\[1\.75rem\] bg-neutral-950/);
  assert.match(source, /closing \? 'status-island-out' : 'status-island-in'/);
  assert.match(source, /success \? 'bg-success' : 'bg-danger'/);
  // Check-in: just "You're checked in"; the card shows the time and any charge.
  assert.match(source, /return "You're checked in";/);
  assert.match(source, /setMessage\(\{ type: 'success', text: attendanceFeedback\(body\) \}\);/);
  assert.doesNotMatch(source, /no charge'/);
  assert.match(source, /text: action === 'sign_out' \? "Couldn't check out" : "Couldn't check in", detail: errorMessage/);
  // Errors stay a little longer; a swipe isn't also a tap.
  assert.match(source, /message\.type === 'error' \? CHECK_IN_ERROR_DISMISS_MS : CHECK_IN_FEEDBACK_DISMISS_MS/);
  assert.match(source, /if \(Math\.abs\(event\.clientX - pressXRef\.current\) < 10\) onDismiss\(\);/);
  const css = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
  assert.match(css, /\.status-island-in \{\n\s*animation: status-island-in 520ms cubic-bezier\(0\.34, 1\.56, 0\.64, 1\) backwards;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('check-in page keeps location blocking states intact', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /validation\.result === 'LOCATION_ACCURACY_WEAK'/);
  assert.match(source, /state: 'weak'/);
  assert.match(source, /state: 'outside'/);
  assert.match(source, /locationBlocksAction/);
  // The button keeps its action name and is greyed out; with location off it turns location on.
  assert.doesNotMatch(source, /Outside Office|Improve GPS Accuracy|Location Required/);
  assert.match(source, /if \(opensLocationSheet\) return 'Turn On Location';/);
  assert.match(source, /const opensLocationSheet = needsLocationPermission && \(canCheckIn \|\| canSubmitSignOut\);/);
  assert.match(source, /icon=\{opensLocationSheet \? MapPin : /);
  assert.match(source, /attendanceButtonLabel\(status, checkingIn, opensLocationSheet\)/);
});

test('check-in page uses concise attendance status copy', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /your late check-in has been recorded/);
  assert.doesNotMatch(source, /you are checked in for today/);
  assert.doesNotMatch(source, /you have checked out for today/);
  assert.doesNotMatch(source, /You can check in now/);
  assert.doesNotMatch(source, /statusDetailText &&/);
  assert.match(source, /No sign-out recorded/);
  assert.match(source, /Late \+ no sign-out recorded/);
  assert.match(source, /hasNoSignOutPenalty/);
  assert.match(source, /hasLateCheckInPenalty/);
});

test('check-in page auto-dismisses response feedback', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.match(source, /CHECK_IN_FEEDBACK_DISMISS_MS = 4_000/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /setMessage\(null\);/);
  assert.match(source, /window\.clearTimeout\(timeout\)/);
});

test('check-in page does not expose temporary Anna-Lisa permission buttons', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  assert.doesNotMatch(source, /PermissionRequestPanel/);
  assert.doesNotMatch(source, /Request location access/);
  assert.doesNotMatch(source, /Request notification access/);
  assert.doesNotMatch(source, /isAnnalisaPermissionRequestStaff/);
  assert.doesNotMatch(source, /requestLocationAccess/);
  assert.doesNotMatch(source, /requestNotificationAccess/);
});

test('check-in card shows a Penalty row only when there is a charge', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');
  assert.doesNotMatch(source, /\{!status\?\.attendance && \(\s*<div[^>]*>\s*<span[^>]*>Penalty<\/span>/);
  assert.equal((source.match(/>Penalty<\/span>/g) || []).length, 1);
  assert.match(source, /status\?\.attendance && Number\(status\.attendance\.computedAmount \|\| 0\) > 0 && \(/);
});

test('check-in status icon: a bold tick on a solid badge once checked in, no charge badge', () => {
  const page = fs.readFileSync(checkInPagePath, 'utf8');
  assert.match(page, /bg-primary text-primary-foreground[\s\S]{0,200}<Check className="[^"]*" strokeWidth=\{3\} \/>/);
  assert.doesNotMatch(page, /<CheckCircle2 className="h-10 w-10/);
  // Before check-in: a soft fill of the card's colour (option C), not a dark outlined circle.
  assert.match(page, /rounded-full bg-current\/20 ring-1 ring-current\/30[\s\S]{0,400}<ShieldCheck /);
  assert.doesNotMatch(page, /chargeStatus/);
});

test('the status card is not "Ready to check in" while location stops the check-in', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  // Title follows the live location, like the button below it.
  assert.match(source, /\{statusCopy\(status, liveLocation\)\}/);
  assert.match(source, /if \(liveLocation\.blocking\) \{\n\s+if \(liveLocation\.state === 'outside'\) return 'Not at the office';\n\s+if \(liveLocation\.state === 'weak'\) return 'Waiting for a clearer location';\n\s+return 'Location needed to check in';\n\s+\}\n\s+if \(liveLocation\.state === 'checking'\) return 'Checking your location';\n\s+return 'Ready to check in';/);
  // No check badge while location blocks it, and a spinner while the first reading comes in.
  assert.match(source, /canCheckIn && !locationBlocksAction && liveLocation\.state === 'checking'\n\s+\? <Loader2 className="size-\[50%\] animate-spin" \/>\n\s+: canCheckIn && !locationBlocksAction \? <ShieldCheck/);
});

test('a status refresh does not restart location tracking for the same office policy', () => {
  const source = fs.readFileSync(checkInPagePath, 'utf8');

  // The policy is keyed by its content, so the 30-second refresh keeps the current reading.
  assert.match(source, /const locationPolicyKey = status\?\.locationPolicy \? JSON\.stringify\(status\.locationPolicy\) : '';/);
  assert.match(source, /\[locationPolicyKey\],\n\s+\);/);
  assert.match(source, /\}, \[locationAccess, locationConfigured, locationPolicy, locationWatchKey, showBlockedSheetOnce\]\);/);
});
