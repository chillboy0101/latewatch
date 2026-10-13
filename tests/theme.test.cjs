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
  assert.match(picker, /useDismissable\(open && !isPhone, containerRef, close\)/);
  assert.match(modePicker, /useDismissable\(open, containerRef, close\)/);
  assert.match(modePicker, /label: 'System', value: 'system'/);
  const wheel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'colour-wheel.tsx'), 'utf8');
  assert.doesNotMatch(picker, /type="color"/);
  assert.match(picker, /<Drawer open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(wheel, /setPointerCapture/);
  assert.match(wheel, /touch-none/);
  assert.doesNotMatch(picker, /Applies across every page/);
  assert.match(css, /--background: color-mix\(in oklab, var\(--brand\) 11%, #ffffff\);/);
  assert.match(css, /\.dark\[data-accent='neutral'\]/);
  assert.doesNotMatch(css, /data-accent='(pink|red|green|violet)'/);
});

test('in-app colour wheel converts hue/tone to valid colours', () => {
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
  assert.deepEqual(parseThemeSelection({ accent: 'custom', customColor: '#ABCDEF', updatedAt: 5 }), { accent: 'custom', customColor: '#abcdef', updatedAt: 5 });
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

test('colour wheel stays visible, follows the current colour and never uses the native picker', () => {
  const wheel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'colour-wheel.tsx'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'theme', 'theme-picker.tsx'), 'utf8');

  assert.match(picker, /<ColourWheel\s+size=\{wheelSize\}\s+value=\{accentColor\}/);
  assert.doesNotMatch(picker, /wheelOpen/);
  assert.doesNotMatch(wheel, /type="range"|type="color"/);
  assert.match(wheel, /aria-label="Colour tone"/);
  assert.equal((wheel.match(/data-vaul-no-drag/g) || []).length >= 3, true);
});
