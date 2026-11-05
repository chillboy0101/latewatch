export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_ACCENT_PRESETS = [
  { accent: 'neutral', label: 'Neutral', swatch: '#737373' },
  { accent: 'wine', label: 'Wine', swatch: '#5e1224' },
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
// Fired only when the person on this device picks a colour (not when sync applies one).
const THEME_USER_EVENT = 'latewatch-theme-user-change';
const THEME_ACCENT_KEY = 'theme-accent';
const THEME_CUSTOM_COLOR_KEY = 'theme-custom-color';
const THEME_VARIABLES_KEY = 'theme-accent-variables';
const THEME_OWNER_KEY = 'theme-accent-owner';
const THEME_UPDATED_AT_KEY = 'theme-accent-updated-at';
// Everyone's colour until they pick their own.
export const DEFAULT_ACCENT: ThemeAccentPreset = 'wine';
export const DEFAULT_ACCENT_COLOR = '#5e1224';
// Blue was the default until this date, and it was saved to each account on first sign-in, so a Blue
// saved before then can't be told apart from the old default: it reads as the new default instead.
// Blue picked after this date is kept.
export const BLUE_DEFAULT_RETIRED_AT = Date.UTC(2026, 9, 26);

function isRetiredBlueDefault(accent: unknown, updatedAt: number) {
  return accent === 'blue' && updatedAt < BLUE_DEFAULT_RETIRED_AT;
}
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
  // OKLCH (perceived lightness, chroma, hue): a colour can be made lighter here without fading it.
  // Mixing with white instead turns deep colours like Wine a dusty pink.
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const toOklch = (rgb: number[]) => {
    const [red, green, blue] = rgb.map(linear);
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { chroma: Math.hypot(a, b), hue: Math.atan2(b, a), lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s };
  };
  const fromOklch = (lightness: number, chroma: number, hue: number) => {
    // A colour the screen can't show keeps its lightness and hue and gives up chroma until it fits
    // (at most 200 steps; by then it is grey, which always fits).
    let amount = Number.isFinite(chroma) ? chroma : 0;
    let rgb = [lightness, lightness, lightness];
    for (let step = 0; step < 200; step += 1, amount *= 0.95) {
      const a = amount * Math.cos(hue);
      const b = amount * Math.sin(hue);
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
      rgb = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ];
      if (amount < 0.001 || rgb.every((value) => value >= -0.0001 && value <= 1.0001)) break;
    }
    return rgb.map((value) => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055));
  };
  // The same colour at no less than this lightness, its chroma kept (times `boost`) so it stays rich.
  const atLeast = (rgb: number[], lightness: number, boost = 1) => {
    const colour = toOklch(rgb);
    return colour.lightness >= lightness ? rgb : fromOklch(lightness, colour.chroma * boost, colour.hue);
  };

  const base = parse(hex);
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  // Dark mode cards (a little lighter than the page): coloured text has to read on them too.
  const darkCard = luminance([28, 28, 28]);
  // Light mode needs a primary dark enough to read on white; dark mode needs one light enough to
  // read on its dark cards. Both aim for 4.5:1, the level for small text, since the primary is
  // also used for small coloured text (status lines, chips). Very light or very dark picks are
  // nudged rather than used as-is. Each is checked on the rounded colour the page actually gets.
  let lightPrimary = base;
  while (contrast(luminance(parse(toHex(lightPrimary))), 1) < 4.5 && luminance(lightPrimary) > 0.05) lightPrimary = mix(lightPrimary, black, 0.12);
  // Dark mode text and lines: the accent made lighter, keeping its colour.
  const { chroma, hue } = toOklch(base);
  let darkLightness = toOklch(mix(base, white, 0.18)).lightness;
  let darkPrimary = fromOklch(darkLightness, chroma, hue);
  while (contrast(luminance(parse(toHex(darkPrimary))), darkCard) < 4.5 && darkLightness < 0.99) {
    darkLightness = Math.min(0.99, darkLightness + 0.01);
    darkPrimary = fromOklch(darkLightness, chroma, hue);
  }
  // Dark mode buttons and other solid fills keep the light mode colour and its white text, made
  // light enough to stand out from the dark page (Wine would all but vanish into it).
  const darkSolid = atLeast(lightPrimary, 0.44, 1.2);
  // Light mode page and card tints: a deep accent mixed into white turns grey, so its tint comes
  // from a lighter version of it.
  const tint = atLeast(base, 0.5, 1.2);

  return {
    '--brand': toHex(base),
    '--brand-tint': toHex(tint),
    '--brand-light': toHex(lightPrimary),
    '--brand-light-foreground': readableOn(lightPrimary),
    '--brand-light-hover': toHex(mix(lightPrimary, black, 0.15)),
    '--brand-dark': toHex(darkPrimary),
    '--brand-dark-foreground': readableOn(darkPrimary),
    '--brand-dark-hover': toHex(mix(darkPrimary, white, 0.2)),
    '--brand-dark-solid': toHex(darkSolid),
    '--brand-dark-solid-foreground': readableOn(darkSolid),
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
  if (isRetiredBlueDefault(saved, getThemeUpdatedAt())) return DEFAULT_ACCENT;
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

export type ThemeSelection = { accent: ThemeAccent; customColor: string; mode?: ThemePreference; updatedAt?: number };

/** The accent selection in the shape saved to the signed-in user's account. */
export function getThemeSelection(): ThemeSelection {
  return {
    accent: getThemeAccent(),
    customColor: getThemeCustomColor(),
    mode: getThemePreference(),
    updatedAt: getThemeUpdatedAt(),
  };
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
  const mode = record.mode === 'light' || record.mode === 'dark' || record.mode === 'system' ? record.mode : undefined;
  if (record.accent === 'custom') return { accent: 'custom', customColor, mode, updatedAt };
  if (isRetiredBlueDefault(record.accent, updatedAt)) return { accent: DEFAULT_ACCENT, customColor, mode, updatedAt };
  if (typeof record.accent === 'string' && record.accent in PRESET_SWATCHES) {
    return { accent: record.accent as ThemeAccentPreset, customColor, mode, updatedAt };
  }
  return null;
}

export function sameThemeSelection(left: ThemeSelection, right: ThemeSelection) {
  return left.accent === right.accent
    && (left.accent !== 'custom' || left.customColor === right.customColor)
    && (!left.mode || !right.mode || left.mode === right.mode);
}

/** Live-update channel carrying one person's theme colour to their other open devices. */
export function themeChannelForUser(userId: string) {
  return `user-theme:${userId}`;
}

export const DEFAULT_THEME_SELECTION: ThemeSelection = { accent: DEFAULT_ACCENT, customColor: PRESET_SWATCHES[DEFAULT_ACCENT] };

/** True when someone on this device has explicitly picked a colour (not just the default). */
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
  if (selection.mode && selection.mode !== getThemePreference()) {
    applyThemePreference(selection.mode, 'sync');
  }
  if (sameThemeSelection(selection, getThemeSelection()) && hasStoredThemeAccent()) {
    if (selection.updatedAt && selection.updatedAt > getThemeUpdatedAt()) writeStorage(THEME_UPDATED_AT_KEY, String(selection.updatedAt));
    return;
  }
  applyThemeAccent(selection.accent, selection.customColor, selection.updatedAt || Date.now(), 'sync');
}

/** Subscribes to colour choices made by the person on this device (used to save them). */
export function subscribeThemeUserChange(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(THEME_USER_EVENT, callback);
  return () => window.removeEventListener(THEME_USER_EVENT, callback);
}

/**
 * Recolours the page for a colour being picked, without saving or notifying anyone.
 * The final colour is saved once with applyThemeAccent when the picker closes.
 */
export function previewThemeAccentColor(hex: string) {
  if (typeof window === 'undefined') return;
  const color = normalizeHexColor(hex);
  if (!color) return;
  const root = document.documentElement;
  const resume = suspendThemeTransitions();
  root.dataset.accent = 'brand';
  for (const [name, value] of Object.entries(computeAccentVariables(color))) {
    root.style.setProperty(name, value);
  }
  resume();
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

// Colour changes should snap, not fade: while suspended, no element animates colour transitions.
// This also removes transition bookkeeping for every element during live colour previews.
const NO_TRANSITIONS_ID = 'latewatch-theme-no-transitions';
let suspendCount = 0;

/** Suspends all CSS transitions until the returned function is called (nestable). */
export function suspendThemeTransitions() {
  if (typeof document === 'undefined') return () => {};
  suspendCount += 1;
  if (!document.getElementById(NO_TRANSITIONS_ID)) {
    const style = document.createElement('style');
    style.id = NO_TRANSITIONS_ID;
    // Elements marked data-keep-transition keep animating.
    style.textContent = '*:not([data-keep-transition]),*::before,*::after{transition:none!important}';
    document.head.appendChild(style);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspendCount -= 1;
    if (suspendCount > 0) return;
    // Wait for the new colours to be painted before transitions come back.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (suspendCount === 0) document.getElementById(NO_TRANSITIONS_ID)?.remove();
    }));
  };
}

function applyAccentToDocument() {
  const resume = suspendThemeTransitions();
  try {
    applyAccentVariables();
  } finally {
    resume();
  }
}

function applyAccentVariables() {
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

export function applyThemeAccent(
  accent: ThemeAccent,
  customColor?: string,
  updatedAt = Date.now(),
  source: 'user' | 'sync' = 'user',
) {
  if (typeof window === 'undefined') return;

  // Remember the custom colour even while a preset is active, so it is still there to return to.
  const color = normalizeHexColor(customColor);
  if (color) writeStorage(THEME_CUSTOM_COLOR_KEY, color);
  else if (accent === 'custom') writeStorage(THEME_CUSTOM_COLOR_KEY, getThemeCustomColor());
  writeStorage(THEME_ACCENT_KEY, accent);
  writeStorage(THEME_UPDATED_AT_KEY, String(updatedAt));
  applyAccentToDocument();
  window.dispatchEvent(new Event(THEME_EVENT));
  if (source === 'user') window.dispatchEvent(new Event(THEME_USER_EVENT));
}

export function applyThemePreference(theme: ThemePreference, source: 'user' | 'sync' = 'user') {
  if (typeof window === 'undefined') return;

  // 'system' is stored explicitly so a deliberate choice is remembered (and synced) like the others.
  writeStorage('theme', theme);
  if (source === 'user') writeStorage(THEME_UPDATED_AT_KEY, String(Date.now()));

  const resume = suspendThemeTransitions();
  document.documentElement.classList.toggle('dark', getIsDarkTheme());
  applyAccentToDocument();
  resume();
  window.dispatchEvent(new Event(THEME_EVENT));
  if (source === 'user') window.dispatchEvent(new Event(THEME_USER_EVENT));
}

/** Inline script for the root layout: applies mode and accent before first paint (no colour flash). */
export function buildThemeBootScript() {
  return `(function() {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
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
      // Saved before these colours existed: stand-ins until the page recomputes them, so another
      // accent doesn't show the default's tint for a moment.
      var standIns = { '--brand-tint': '--brand', '--brand-dark-solid': '--brand-light', '--brand-dark-solid-foreground': '--brand-light-foreground' };
      for (var missing in standIns) {
        var standIn = saved.variables[standIns[missing]];
        if (!saved.variables[missing] && /^#[0-9a-f]{6}$/i.test(standIn)) root.style.setProperty(missing, standIn);
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
