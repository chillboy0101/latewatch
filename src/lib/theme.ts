export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeAccent = 'blue' | 'pink' | 'red' | 'green' | 'violet';

const THEME_EVENT = 'latewatch-theme-change';
const THEME_ACCENT_KEY = 'theme-accent';

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';

  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;

  return 'system';
}

export function getThemeAccent(): ThemeAccent {
  if (typeof window === 'undefined') return 'blue';

  const saved = localStorage.getItem(THEME_ACCENT_KEY);
  return saved === 'pink' || saved === 'red' || saved === 'green' || saved === 'violet' ? saved : 'blue';
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

export function applyThemeAccent(accent: ThemeAccent) {
  if (typeof window === 'undefined') return;

  localStorage.setItem(THEME_ACCENT_KEY, accent);
  document.documentElement.dataset.accent = accent;
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function applyThemePreference(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  if (theme === 'system') {
    localStorage.removeItem('theme');
  } else {
    localStorage.setItem('theme', theme);
  }

  document.documentElement.classList.toggle('dark', getIsDarkTheme());
  document.documentElement.dataset.accent = getThemeAccent();
  window.dispatchEvent(new Event(THEME_EVENT));
}

if (typeof window !== 'undefined') {
  document.documentElement.dataset.accent = getThemeAccent();
}
