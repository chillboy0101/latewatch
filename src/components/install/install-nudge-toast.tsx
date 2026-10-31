'use client';

import { useEffect, useState, type FocusEvent } from 'react';
import Link from 'next/link';
import { Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { detectPhoneOs } from '@/lib/phone-os';
import { useSwipeToDismiss } from '@/lib/use-swipe-to-dismiss';

const DISMISSED_KEY = 'latewatch-install-nudge-dismissed';
const SEEN_KEY = 'latewatch-install-nudge-seen';
const AUTO_HIDE_MS = 8_000;

function isInstalled() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia('(display-mode: standalone)').matches;
}

// A phone browser (not the home-screen app) that hasn't closed the banner and hasn't seen it today.
// Marks today as seen when it says yes, so the banner shows at most once a day.
export function takeInstallNudgeTurn() {
  if (detectPhoneOs() === 'other' || isInstalled()) return false;
  try {
    if (localStorage.getItem(DISMISSED_KEY) === '1') return false;
    const today = new Date().toDateString();
    if (localStorage.getItem(SEEN_KEY) === today) return false;
    localStorage.setItem(SEEN_KEY, today);
  } catch {
    // Storage blocked: show it; it may show again next time, which is harmless.
  }
  return true;
}

// "Add to Home Screen" banner, in the same stack as the receipt banners and sized like a phone
// notification. Closing it (× or a swipe) hides it for good; left alone it slides away after a few
// seconds, but not while one of its buttons has focus.
export function InstallNudgeToast({ onHide }: { onHide: () => void }) {
  const [focused, setFocused] = useState(false);
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Storage blocked: it may show again another day.
    }
    onHide();
  };
  const { swipeHandlers, swipeStyle } = useSwipeToDismiss(dismiss);

  useEffect(() => {
    if (focused) return;
    const timeout = window.setTimeout(onHide, AUTO_HIDE_MS);
    return () => window.clearTimeout(timeout);
  }, [focused, onHide]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div
      {...swipeHandlers}
      style={swipeStyle}
      onBlur={onBlur}
      onFocus={() => setFocused(true)}
      className="pointer-events-auto flex w-full max-w-md select-none flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card/90 p-3.5 shadow-lg ring-1 ring-border/60 backdrop-blur-md animate-in fade-in-0 slide-in-from-top-2 duration-300 ease-out"
      role="status"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone className="h-6 w-6" />
        </div>
        <p className="min-w-0 flex-1 text-base font-semibold text-foreground">Add to Home Screen</p>
        <button
          aria-label="Close"
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          onClick={dismiss}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <Button asChild className="h-11 w-full rounded-xl text-[15px] font-semibold">
        <Link href="/install" onClick={onHide}>Show me</Link>
      </Button>
    </div>
  );
}
