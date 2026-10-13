/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('tsx/cjs');

const {
  buildThemeBootScript,
  computeAccentVariables,
  normalizeHexColor,
  THEME_ACCENT_PRESETS,
} = require('../src/lib/theme.ts');

function luminance(hex) {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test('theme offers neutral plus a variety of preset colours', () => {
  const accents = THEME_ACCENT_PRESETS.map((preset) => preset.accent);
  assert.equal(accents[0], 'neutral');
  assert.ok(accents.length >= 10);
  for (const legacy of ['blue', 'pink', 'red', 'green', 'violet']) assert.ok(accents.includes(legacy));
});

test('every accent, including extreme custom picks, keeps primary buttons readable', () => {
  const colours = [...THEME_ACCENT_PRESETS.map((preset) => preset.swatch), '#ffffff', '#000000', '#f5e663', '#00ff00'];
  for (const colour of colours) {
    const variables = computeAccentVariables(colour);
    assert.ok(contrast(variables['--brand-light'], '#ffffff') >= 2.9, `${colour} light primary vs page`);
    assert.ok(contrast(variables['--brand-dark'], '#0a0a0a') >= 4.4, `${colour} dark primary vs page`);
    assert.ok(contrast(variables['--brand-light'], variables['--brand-light-foreground']) >= 4.4, `${colour} light button text`);
    assert.ok(contrast(variables['--brand-dark'], variables['--brand-dark-foreground']) >= 4.4, `${colour} dark button text`);
  }
});

test('custom colours are validated and the boot script restores saved colours safely', () => {
  assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
  assert.equal(normalizeHexColor('#12345g'), null);
  assert.equal(normalizeHexColor('red'), null);

  const script = buildThemeBootScript();
  assert.doesNotMatch(script, /__name|require\(/);
  assert.match(script, /\/\^--brand\/\.test\(name\)/);
  assert.doesNotThrow(() => new Function(script));
});

test('theme picker closes on outside taps and Escape, and all surfaces derive from the accent', () => {
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-picker.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

  const modePicker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'mode-picker.tsx'), 'utf8');
  const dismiss = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'use-dismissable.ts'), 'utf8');

  assert.match(dismiss, /addEventListener\('pointerdown', handlePointerDown\)/);
  assert.match(dismiss, /event\.key === 'Escape'/);
  assert.match(modePicker, /useDismissable\(open, containerRef, close\)/);
  assert.match(modePicker, /label: 'System', value: 'system'/);
  assert.match(picker, /type="color"\s+aria-label="Theme colour"/);
  assert.doesNotMatch(picker, /Applies across every page/);
  assert.match(css, /--background: color-mix\(in oklab, var\(--brand\) 14%, #ffffff\);/);
  assert.match(css, /\.dark\[data-accent='neutral'\]/);
  assert.doesNotMatch(css, /data-accent='(pink|red|green|violet)'/);
});

test('home page shows the appearance and theme colour buttons', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.tsx'), 'utf8');
  assert.match(home, /<ModePicker /);
  assert.match(home, /<ThemePicker /);
});

test('theme colour syncs to the account, defaulting to blue for first-time users', () => {
  const {
    DEFAULT_THEME_SELECTION,
    parseThemeSelection,
    sameThemeSelection,
  } = require('../src/lib/theme.ts');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-account-sync.tsx'), 'utf8');
  const provider = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'auth', 'clerk-theme-provider.tsx'), 'utf8');

  assert.deepEqual(DEFAULT_THEME_SELECTION, { accent: 'blue', customColor: '#2563eb' });
  assert.deepEqual(parseThemeSelection({ accent: 'custom', customColor: '#ABCDEF', updatedAt: 5 }), { accent: 'custom', customColor: '#abcdef', mode: undefined, updatedAt: 5 });
  assert.equal(parseThemeSelection({ accent: 'role-admin' }), null);
  assert.equal(parseThemeSelection('red'), null);
  assert.ok(sameThemeSelection({ accent: 'red', customColor: '#000000' }, { accent: 'red', customColor: '#ffffff' }));

  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'account', 'theme', 'route.ts'), 'utf8');
  const themeLib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'theme.ts'), 'utf8');
  // Stored in the app database with an atomic newest-wins upsert (no sign-in provider API calls).
  assert.match(route, /onConflictDoUpdate\(/);
  assert.match(route, /setWhere: sql`\$\{userThemePreference\.updatedAt\} <= excluded\.updated_at`/);
  assert.doesNotMatch(route, /clerkClient|updateUserMetadata|redis/i);
  assert.match(route, /await ablyPublish\(`latewatch:\$\{themeChannelForUser\(userId\)\}`, 'theme'/);
  // Only the person's own picks are saved; colours applied by sync never trigger a save (no loops).
  assert.match(sync, /subscribeThemeUserChange\(/);
  assert.doesNotMatch(sync, /subscribeThemeChange\(/);
  assert.match(themeLib, /if \(source === 'user'\) window\.dispatchEvent\(new Event\(THEME_USER_EVENT\)\)/);
  assert.match(themeLib, /applyThemeAccent\(selection\.accent, selection\.customColor, selection\.updatedAt \|\| Date\.now\(\), 'sync'\)/);
  assert.match(sync, /channel\.subscribe\('theme', handler\)/);
  assert.match(sync, /\{ \.\.\.DEFAULT_THEME_SELECTION, updatedAt: Date\.now\(\) \}/);
  assert.match(sync, /localUpdatedAt === 0 \|\| \(remote\.updatedAt \|\| 0\) > localUpdatedAt/);
  assert.doesNotMatch(sync, /role/);
  assert.match(provider, /<ThemeAccountSync \/>/);
});

test('theme colour button opens the native colour picker on each device directly', () => {
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-picker.tsx'), 'utf8');
  const modePicker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'mode-picker.tsx'), 'utf8');

  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'colour-wheel.tsx')), false);
  assert.doesNotMatch(picker, /ColourWheel|THEME_ACCENT_PRESETS|Drawer|EyeDropper/);
  // Live recolour while picking; saved once from the native change event when the picker closes.
  assert.match(picker, /onChange=\{\(event\) => previewLive\(event\.target\.value\)\}/);
  assert.match(picker, /input\.addEventListener\('change', handleChange\)/);
  assert.match(picker, /defaultValue=\{accentColor\}/);
  // A way back to the standard blue.
  assert.match(modePicker, /applyThemeAccent\('blue'\)/);
  assert.match(modePicker, />Reset to blue</);
  assert.match(modePicker, /<p className=\{SECTION_LABEL\}>Colour<\/p>/);
});

test('rate limiter falls back to Postgres when the configured Redis is unreachable', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'rate-limit.ts'), 'utf8');
  assert.match(source, /rate-limit Redis unavailable, using Postgres/);
  assert.match(source, /return await allowRequestViaPostgres\(key, limit, windowSeconds\);/);
});

test('light/dark/system mode is remembered explicitly and synced with the colour', () => {
  const { parseThemeSelection, sameThemeSelection } = require('../src/lib/theme.ts');
  const themeLib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'theme.ts'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'account', 'theme', 'route.ts'), 'utf8');

  assert.equal(parseThemeSelection({ accent: 'blue', mode: 'dark' }).mode, 'dark');
  assert.equal(parseThemeSelection({ accent: 'blue', mode: 'purple' }).mode, undefined);
  assert.equal(sameThemeSelection({ accent: 'blue', mode: 'dark' }, { accent: 'blue', mode: 'light' }), false);
  assert.match(themeLib, /writeStorage\('theme', theme\);/);
  assert.match(themeLib, /theme !== 'light' && window\.matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches/);
  assert.match(themeLib, /if \(source === 'user'\) window\.dispatchEvent\(new Event\(THEME_USER_EVENT\)\);\n\}/);
  assert.match(route, /mode: sql`coalesce\(excluded\.mode, \$\{userThemePreference\.mode\}\)`/);
});

test('theme changes snap instantly and are shared live while dragging', () => {
  const themeLib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'theme.ts'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-picker.tsx'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-account-sync.tsx'), 'utf8');

  assert.match(themeLib, /\*:not\(\[data-keep-transition\]\),\*::before,\*::after\{transition:none!important\}/);
  assert.match(themeLib, /function applyAccentToDocument\(\) \{\n  const resume = suspendThemeTransitions\(\);/);
  assert.match(picker, /const LIVE_SHARE_INTERVAL_MS = 250;/);
  assert.match(picker, /previewLive\(event\.target\.value\)/);
  // First save goes out immediately, then at most one per interval.
  assert.match(sync, /const wait = Math\.max\(0, SAVE_INTERVAL_MS - \(Date\.now\(\) - lastSentAt\)\);/);
});

test('check-in status card and location chip follow the theme colour in every state', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'check-in', 'page.tsx'), 'utf8');
  const statusTone = page.slice(page.indexOf('function statusTone('), page.indexOf('function getOrCreateDeviceToken'));
  assert.match(statusTone, /return 'border-primary\/25 bg-primary\/10 text-primary';/);
  assert.doesNotMatch(statusTone, /success|warning|danger/);
  const chip = page.slice(page.indexOf('function LocationStatusChip('));
  assert.match(chip, /border-primary\/30 bg-primary\/10 px-3\.5 text-sm font-semibold text-primary/);
  assert.doesNotMatch(chip.slice(0, chip.indexOf('\n}\n')), /success|warning|danger/);
});

test('staff picker opens inside its dialog with search and a capped scroll list', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const picker = read('src', 'components', 'ui', 'staff-picker.tsx');
  assert.match(picker, /placeholder="Search name"/);
  assert.match(picker, /max-h-48 overflow-y-auto/);
  assert.match(picker, /absolute inset-x-0 top-full z-50/);
  assert.doesNotMatch(picker, /<select/);
  for (const file of [
    ['src', 'app', 'payments', 'page.tsx'],
    ['src', 'components', 'attendance', 'staff-leave-dialog.tsx'],
    ['src', 'app', 'attendance', 'overview', 'page.tsx'],
    ['src', 'app', 'emergency-contacts', 'page.tsx'],
  ]) {
    const source = read(...file);
    assert.match(source, /<StaffPicker/);
    assert.doesNotMatch(source, /<option value="">Select staff<\/option>/);
  }
});

test('page loader centres in the content area for compact and expanded sidebars', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const loader = read('src', 'components', 'ui', 'loading-buffer.tsx');
  const layout = read('src', 'components', 'layout', 'dashboard-layout.tsx');
  assert.match(loader, /variant === 'page' && 'pointer-events-none absolute inset-x-0 bottom-0 top-16 z-30'/);
  assert.doesNotMatch(loader, /left-64/);
  assert.match(layout, /<div className="relative flex min-w-0 flex-1 flex-col">/);
});

test('dialogs with a staff picker scroll normally and only overflow while the picker is open', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  assert.match(read('src', 'components', 'ui', 'staff-picker.tsx'), /data-picker-open=\{open \|\| undefined\}/);
  for (const file of [
    ['src', 'app', 'payments', 'page.tsx'],
    ['src', 'components', 'attendance', 'staff-leave-dialog.tsx'],
    ['src', 'app', 'attendance', 'overview', 'page.tsx'],
    ['src', 'app', 'emergency-contacts', 'page.tsx'],
  ]) {
    const source = read(...file);
    assert.match(source, /has-\[\[data-picker-open\]\]:overflow-visible/);
    assert.doesNotMatch(source, /<DialogContent className="[^"]*(?<!:)overflow-visible/);
  }
  // The pardon staff list scrolls on its own however many people it holds.
  assert.match(read('src', 'app', 'payments', 'page.tsx'), /<ul className="absolute inset-x-0 bottom-full z-50 mb-1\.5 max-h-48 divide-y divide-border overflow-y-auto/);
});

test('one reminders pop-up replaces the top banner and shows at most once a day', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const page = read('src', 'app', 'check-in', 'page.tsx');
  const route = read('src', 'app', 'api', 'attendance', 'check-in', 'push-subscription', 'route.ts');
  assert.doesNotMatch(page, /ReminderCheckPrompt|REMINDER_CHECK_|NotificationNudge/);
  assert.match(page, /<ReminderPrompt\b/);
  assert.match(page, /role="dialog" aria-modal="true" aria-labelledby="reminder-prompt-title"/);
  assert.match(page, /const REMINDER_PROMPT_SEEN_KEY = 'latewatch-reminder-prompt-seen';/);
  assert.match(page, /localStorage\.setItem\(REMINDER_PROMPT_SEEN_KEY, today\)/);
  assert.match(page, /const REMINDER_NUDGE_OPTOUT_KEY = 'latewatch-reminder-nudge-optout';/);
  assert.match(page, /return !failing && localStorage\.getItem\(REMINDER_NUDGE_OPTOUT_KEY\) === '1';/);
  assert.match(page, /remindersOff=\{!signInReminderEnabled && !signOutReminderEnabled\}/);
  assert.match(page, /'Your reminders stopped working'/);
  assert.match(page, /if \(options\?\.refresh && existingSubscription\)/);
  assert.match(route, /return latest\?\.status === 'failed';/);
});

test('penalty history and receipts sheets fill the screen on phones', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'check-in', 'page.tsx'), 'utf8');
  const fullHeight = page.match(/<DrawerContent className="h-\[calc\(100dvh-env\(safe-area-inset-top\)-1rem\)\] sm:h-\[85dvh\]">/g) || [];
  assert.equal(fullHeight.length, 2);
});
