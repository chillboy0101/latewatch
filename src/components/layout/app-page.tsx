'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { canGoBack, forwardPath, navigateBack, navigateToForward, parentPath, recordPathname } from '@/lib/app-nav';

// How close to the edge a swipe has to start, and how far (share of the width) or fast (px per ms)
// it has to travel to count.
const EDGE_PX = 24;
const COMMIT_SHARE = 0.35;
const COMMIT_VELOCITY = 0.45;
const SLIDE_OUT_MS = 220;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function clearDrag(page: HTMLElement) {
  page.style.removeProperty('transform');
  page.style.removeProperty('transition');
  page.style.removeProperty('box-shadow');
  page.style.removeProperty('will-change');
}

// Wraps every screen. It records each screen visited (for the back stack and the slides), and in
// the installed app it adds the edge swipes: drag from the left edge and the screen follows the
// finger and slides away to the previous screen; drag from the right edge to reopen the screen just
// left by going back. (Home-screen web apps get no system swipes; in Safari the browser's own are
// left alone.)
export function AppPage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const dragResetTimer = useRef<number | null>(null);

  useEffect(() => {
    // A finished swipe left this screen pushed off to the side: put it back for the new screen.
    if (dragResetTimer.current !== null) window.clearTimeout(dragResetTimer.current);
    dragResetTimer.current = null;
    if (pageRef.current) clearDrag(pageRef.current);
    recordPathname(pathname);
  }, [pathname]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !isInstalledApp() || !window.matchMedia('(pointer: coarse)').matches) return;

    // 1: from the left edge, back. -1: from the right edge, forward (the page moves left).
    let direction: 1 | -1 = 1;
    let start: { time: number; x: number; y: number } | null = null;
    let dragging = false;
    let offset = 0;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1) return;
      if (touch.clientX <= EDGE_PX) {
        // Nowhere to go back to: no swipe.
        if (!canGoBack() && !parentPath(window.location.pathname)) return;
        direction = 1;
      } else if (touch.clientX >= window.innerWidth - EDGE_PX) {
        // No screen left by going back: no swipe.
        if (!forwardPath()) return;
        direction = -1;
      } else {
        return;
      }
      // A sheet or dialog is open (back closes that instead).
      if (document.querySelector('[role="dialog"]')) return;
      if (dragResetTimer.current !== null) window.clearTimeout(dragResetTimer.current);
      dragResetTimer.current = null;
      start = { time: event.timeStamp, x: touch.clientX, y: touch.clientY };
      dragging = false;
      offset = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!dragging) {
        // A mostly vertical move is a scroll, not a swipe.
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          start = null;
          return;
        }
        if (dx * direction < 8) return;
        dragging = true;
        page.style.transition = 'none';
        page.style.willChange = 'transform';
        page.style.boxShadow = `${-12 * direction}px 0 32px rgb(0 0 0 / 0.18)`;
      }
      event.preventDefault();
      // How far the page has moved in the swipe's direction.
      offset = Math.max(0, dx * direction);
      page.style.transform = `translate3d(${offset * direction}px, 0, 0)`;
    };

    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const began = start;
      const wasDragging = dragging;
      start = null;
      dragging = false;
      if (!wasDragging) return;

      const velocity = offset / Math.max(1, event.timeStamp - began.time);
      page.style.transition = `transform ${SLIDE_OUT_MS}ms ${EASE}`;
      if (offset > window.innerWidth * COMMIT_SHARE || (velocity > COMMIT_VELOCITY && offset > 40)) {
        page.style.transform = `translate3d(${direction * 100}%, 0, 0)`;
        const swipe = direction;
        window.setTimeout(() => {
          // If the swipe doesn't change screen (back only left a stale same-screen entry), bring the
          // page back rather than leave it pushed off to the side. A screen change clears this first.
          dragResetTimer.current = window.setTimeout(() => {
            dragResetTimer.current = null;
            clearDrag(page);
          }, 2000);
          if (swipe === 1) navigateBack(router, parentPath(window.location.pathname) ?? '/', 'swipe-back');
          else navigateToForward(router);
        }, SLIDE_OUT_MS);
      } else {
        // Not far enough: spring back.
        page.style.transform = 'translate3d(0, 0, 0)';
        window.setTimeout(() => clearDrag(page), SLIDE_OUT_MS);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-app-page ref={pageRef}>
      {children}
    </div>
  );
}
