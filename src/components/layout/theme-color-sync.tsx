'use client';

import { useEffect } from 'react';
import { getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';

const DARK_BACKGROUND = '#0a0a0a';
const LIGHT_BACKGROUND = '#ffffff';

/**
 * Keeps the browser/PWA status bar (`<meta name="theme-color">`) in sync with
 * the app's manual theme toggle. Without this, the media-query theme-color
 * follows the OS, so an app-dark / OS-light combination leaves a white status
 * bar. Manages a single dedicated meta tag (no `media`) that overrides the
 * media-based ones.
 */
export function ThemeColorSync() {
  useEffect(() => {
    const apply = () => {
      const color = getIsDarkTheme() ? DARK_BACKGROUND : LIGHT_BACKGROUND;
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', color);
    };

    apply();
    return subscribeThemeChange(apply);
  }, []);

  return null;
}
