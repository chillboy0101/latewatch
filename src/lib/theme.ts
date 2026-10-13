export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_ACCENT_PRESETS = [
  { accent: 'neutral', label: 'Neutral', swatch: '#737373' },
  { accent: 'blue', label: 'Blue', swatch: '#2563eb' },
  { accent: 'sky', label: 'Sky', swatch: '#0284c7' },
  { accent: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { accent: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { accent: 'pink', label: 'Pink', swatch: '#db2777' },
  { accent: 'rose', label: 'Rose', swatch: '#e11d48' },
  { accent: 'red', label: 'Red', swatch: '#dc2626' },
  { accent: 'orange', label: 'Orange', swatch: '#ea580c' },
  { accent: 'amber', label: 'Amber', swatch: '#d97706' },
  { accent: 'green', label: 'Green', swatch: '#16a34a' },
  { accent: 'teal', label: 'Teal', swatch: '#0d9488' },
] as const;

export type ThemeAccentPreset = typeof THEME_ACCENT_PRESETS[number]['accent'];
export type ThemeAccent = ThemeAccentPreset | 'custom';

const THEME_EVENT = 'latewatch-theme-change';
const THEME_ACCENT_KEY = 'theme-accent';
const THEME_CUSTOM_COLOR_KEY = 'theme-custom-color';
const THEME_VARIABLES_KEY = 'theme-accent-variables';
const THEME_OWNER_KEY = 'theme-accent-owner';
const THEME_UPDATED_AT_KEY = 'theme-accent-updated-at';
const DEFAULT_ACCENT: ThemeAccentPreset = 'blue';
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

const PRESET_SWATCHES: Record<string, string> = Object.fromEntries(
  THEME_ACCENT_PRESETS.map(({ accent, swatch }) => [accent, swatch]),
);

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}

export function normalizeHexColor(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const expanded = /^#[0-9a-f]{3}$/i.test(trimmed)
    ? `#${trimmed.slice(1).split('').map((character) => character + character).join('')}`
    : trimmed;
  return HEX_PATTERN.test(expanded) ? expanded.toLowerCase() : null;
}

/** Builds the CSS variables for an accent colour: readable primaries for light and dark mode. */
export function computeAccentVariables(hex: string) {
  const parse = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  const toHex = (rgb: number[]) => `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (from: number[], to: number[], amount: number) => from.map((channel, index) => channel + (to[index] - channel) * amount);
  const luminance = (rgb: number[]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (first: number, second: number) => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  const readableOn = (rgb: number[]) => {
    const value = luminance(rgb);
    return contrast(value, 1) >= contrast(value, luminance([10, 10, 10])) ? '#ffffff' : '#0a0a0a';
  };

  const base = parse(hex);
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  // Light mode needs a primary dark enough to read on white; dark mode needs one light enough to
  // read on near-black. Very light or very dark picks are nudged rather than used as-is.
  let lightPrimary = base;
  while (contrast(luminance(lightPrimary), 1) < 3 && luminance(lightPrimary) > 0.05) lightPrimary = mix(lightPrimary, black, 0.12);
  let darkPrimary = mix(base, white, 0.18);
  while (contrast(luminance(darkPrimary), luminance([10, 10, 10])) < 4.5 && luminance(darkPrimary) < 0.95) darkPrimary = mix(darkPrimary, white, 0.15);

  return {
    '--brand': toHex(base),
    '--brand-light': toHex(lightPrimary),
    '--brand-light-foreground': readableOn(lightPrimary),
    '--brand-light-hover': toHex(mix(lightPrimary, black, 0.15)),
    '--brand-dark': toHex(darkPrimary),
    '--brand-dark-foreground': readableOn(darkPrimary),
    '--brand-dark-hover': toHex(mix(darkPrimary, white, 0.2)),
  } as Record<string, string>;
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';

  const saved = readStorage('theme');
  if (saved === 'light' || saved === 'dark') return saved;

  return 'system';
}

export function getThemeAccent(): ThemeAccent {
  if (typeof window === 'undefined') return DEFAULT_ACCENT;

  const saved = readStorage(THEME_ACCENT_KEY);
  if (saved === 'custom' && normalizeHexColor(readStorage(THEME_CUSTOM_COLOR_KEY))) return 'custom';
  return saved && saved in PRESET_SWATCHES ? saved as ThemeAccentPreset : DEFAULT_ACCENT;
}

export function getThemeCustomColor() {
  if (typeof window === 'undefined') return PRESET_SWATCHES[DEFAULT_ACCENT];
  return normalizeHexColor(readStorage(THEME_CUSTOM_COLOR_KEY)) || PRESET_SWATCHES[DEFAULT_ACCENT];
}

export function getThemeAccentColor() {
  const accent = getThemeAccent();
  return accent === 'custom' ? getThemeCustomColor() : PRESET_SWATCHES[accent];
}

export type ThemeSelection = { accent: ThemeAccent; customColor: string; updatedAt?: number };

/** The accent selection in the shape saved to the signed-in user's account. */
export function getThemeSelection(): ThemeSelection {
  return { accent: getThemeAccent(), customColor: getThemeCustomColor(), updatedAt: getThemeUpdatedAt() };
}

/** When the colour on this device was last chosen (ms). 0 when it has never been chosen here. */
export function getThemeUpdatedAt() {
  if (typeof window === 'undefined') return 0;
  const value = Number(readStorage(THEME_UPDATED_AT_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseThemeSelection(value: unknown): ThemeSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const customColor = normalizeHexColor(record.customColor) || PRESET_SWATCHES[DEFAULT_ACCENT];
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) && record.updatedAt > 0
    ? record.updatedAt
    : 0;
  if (record.accent === 'custom') return { accent: 'custom', customColor, updatedAt };
  if (typeof record.accent === 'string' && record.accent in PRESET_SWATCHES) {
    return { accent: record.accent as ThemeAccentPreset, customColor, updatedAt };
  }
  return null;
}

export function sameThemeSelection(left: ThemeSelection, right: ThemeSelection) {
  return left.accent === right.accent && (left.accent !== 'custom' || left.customColor === right.customColor);
}

/** Live-update channel carrying one person's theme colour to their other open devices. */
export function themeChannelForUser(userId: string) {
  return `user-theme:${userId}`;
}

export const DEFAULT_THEME_SELECTION: ThemeSelection = { accent: DEFAULT_ACCENT, customColor: PRESET_SWATCHES[DEFAULT_ACCENT] };

/** True when someone on this device has explicitly picked a colour (not just the Blue default). */
export function hasStoredThemeAccent() {
  return typeof window !== 'undefined' && readStorage(THEME_ACCENT_KEY) !== null;
}

/** Which signed-in user the colour on this device belongs to, so a shared device never leaks it. */
export function getThemeAccentOwner() {
  return typeof window === 'undefined' ? null : readStorage(THEME_OWNER_KEY);
}

export function setThemeAccentOwner(userId: string) {
  writeStorage(THEME_OWNER_KEY, userId);
}

/** Applies a selection that came from the account, keeping its timestamp. */
export function applyThemeSelection(selection: ThemeSelection) {
  if (sameThemeSelection(selection, getThemeSelection()) && hasStoredThemeAccent()) {
    if (selection.updatedAt && selection.updatedAt > getThemeUpdatedAt()) writeStorage(THEME_UPDATED_AT_KEY, String(selection.updatedAt));
    return;
  }
  applyThemeAccent(selection.accent, selection.customColor, selection.updatedAt || Date.now());
}

/**
 * Recolours the page for a colour being dragged on the wheel, without saving or notifying anyone.
 * The final colour is saved once with applyThemeAccent when the drag ends.
 */
export function previewThemeAccentColor(hex: string) {
  if (typeof window === 'undefined') return;
  const color = normalizeHexColor(hex);
  if (!color) return;
  const root = document.documentElement;
  root.dataset.accent = 'brand';
  for (const [name, value] of Object.entries(computeAccentVariables(color))) {
    root.style.setProperty(name, value);
  }
}

/** The primary colour actually shown for the current accent and mode (used outside CSS, e.g. Clerk). */
export function getThemePrimaryColor(isDark: boolean) {
  if (getThemeAccent() === 'neutral') return isDark ? '#fafafa' : '#171717';
  const variables = computeAccentVariables(getThemeAccentColor());
  return isDark ? variables['--brand-dark'] : variables['--brand-light'];
}

export function getIsDarkTheme() {
  if (typeof window === 'undefined') return true;

  const theme = getThemePreference();
  if (theme === 'light') return false;
  if (theme === 'dark') return true;

  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function subscribeThemeChange(callback: () => void) {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener('storage', callback);
  window.addEventListener(THEME_EVENT, callback);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);

  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_EVENT, callback);
    media.removeEventListener('change', callback);
  };
}

function applyAccentToDocument() {
  const root = document.documentElement;
  const accent = getThemeAccent();
  root.dataset.accent = accent === 'neutral' ? 'neutral' : 'brand';
  const variables = computeAccentVariables(getThemeAccentColor());
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  // Saved so the pre-paint boot script can restore the exact colours without recomputing them.
  writeStorage(THEME_VARIABLES_KEY, JSON.stringify({ accent: root.dataset.accent, variables }));

  // Keep the mobile browser/status bar colour in step with the themed page background.
  requestAnimationFrame(() => {
    const background = getComputedStyle(document.body || root).backgroundColor;
    if (!background) return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', background);
    });
  });
}

export function applyThemeAccent(accent: ThemeAccent, customColor?: string, updatedAt = Date.now()) {
  if (typeof window === 'undefined') return;

  // Remember the custom colour even while a preset is active, so it is still there to return to.
  const color = normalizeHexColor(customColor);
  if (color) writeStorage(THEME_CUSTOM_COLOR_KEY, color);
  else if (accent === 'custom') writeStorage(THEME_CUSTOM_COLOR_KEY, getThemeCustomColor());
  writeStorage(THEME_ACCENT_KEY, accent);
  writeStorage(THEME_UPDATED_AT_KEY, String(updatedAt));
  applyAccentToDocument();
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function applyThemePreference(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  writeStorage('theme', theme === 'system' ? null : theme);

  document.documentElement.classList.toggle('dark', getIsDarkTheme());
  applyAccentToDocument();
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Inline script for the root layout: applies mode and accent before first paint (no colour flash). */
export function buildThemeBootScript() {
  return `(function() {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    }
    var saved = JSON.parse(localStorage.getItem('${THEME_VARIABLES_KEY}') || 'null');
    if (saved && saved.variables) {
      root.dataset.accent = saved.accent === 'neutral' ? 'neutral' : 'brand';
      for (var name in saved.variables) {
        if (/^--brand/.test(name) && /^#[0-9a-f]{6}$/i.test(saved.variables[name])) {
          root.style.setProperty(name, saved.variables[name]);
        }
      }
    }
  } catch (error) {}
})();`;
}

if (typeof window !== 'undefined') {
  applyAccentToDocument();
  // Another tab or portal on this device changed the colour: recolour this one too.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_ACCENT_KEY || event.key === THEME_CUSTOM_COLOR_KEY) applyAccentToDocument();
    if (event.key === 'theme') document.documentElement.classList.toggle('dark', getIsDarkTheme());
  });
}
