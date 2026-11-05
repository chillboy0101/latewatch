'use client';

import { useEffect } from 'react';
import { mayReloadAfterCrash, reportClientError } from '@/lib/client-error-report';

// Anything that breaks while a screen is drawn lands here, instead of Next's bare "This page
// couldn't load". It reports what happened (so the cause can be found and fixed) and reloads the
// screen once, so a crash from tapping quickly between screens doesn't leave anyone stuck. If the
// screen breaks again straight after, it stays here and offers a reload or the portal home. Next
// also builds the static 500 page from this file, so the choices are plain links that work
// without a script.

// It replaces the whole app (and its stylesheet), so it brings its own few styles.
const css = `
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #ffffff; color: #171717;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 22rem; padding: 1.5rem; text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 1.375rem; }
  p { margin: 0 0 1.5rem; line-height: 1.45; opacity: 0.75; }
  .actions { display: flex; justify-content: center; gap: 0.75rem; }
  .button { display: inline-block; padding: 0.75rem 1.25rem; border: 1px solid transparent; border-radius: 0.75rem;
    background: #171717; color: #ffffff; font-weight: 600; text-decoration: none; }
  .button.plain { border-color: rgb(0 0 0 / 0.15); background: transparent; color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #fafafa; }
    .button { background: #fafafa; color: #0a0a0a; }
    .button.plain { border-color: rgb(255 255 255 / 0.2); background: transparent; color: inherit; }
  }
`;

export default function GlobalError({ error }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    reportClientError(error);
    // Decided once the page is on screen, so the server-made page and the browser's first render
    // are the same: reload once, unless this is the reload breaking again.
    if (mayReloadAfterCrash()) window.location.reload();
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>LateWatch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>This screen hit a problem. Reload to try again, or go to the portal home.</p>
          <div className="actions">
            {/* Full page loads on purpose: the app's own navigation may be what broke. An empty
                href is this same address. */}
            <a className="button" href="">Reload</a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="button plain" href="/">Portal home</a>
          </div>
        </main>
      </body>
    </html>
  );
}
