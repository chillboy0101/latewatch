export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_EVENT = 'latewatch-theme-change';

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';

  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;

  return 'system';
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

export function applyThemePreference(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  if (theme === 'system') {
    localStorage.removeItem('theme');
  } else {
    localStorage.setItem('theme', theme);
  }

  document.documentElement.classList.toggle('dark', getIsDarkTheme());
  window.dispatchEvent(new Event(THEME_EVENT));
}
