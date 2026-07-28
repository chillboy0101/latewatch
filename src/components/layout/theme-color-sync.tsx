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
      // Replace the theme-color meta node entirely (not just its content):
      // iOS Safari re-reads theme-color on a fresh node, updating the status bar
      // live without a page reload. Also drop media-based metas, which would win
      // over ours whenever the OS preference matched.
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((m) => m.remove());
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', color);
      document.head.appendChild(meta);
    };

    apply();
    return subscribeThemeChange(apply);
  }, []);

  return null;
}
