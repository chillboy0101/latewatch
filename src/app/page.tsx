'use client';

import { LayoutDashboard, LogIn } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChoiceCard, ChoicePanel, PortalPickers, useApplyDarkMode } from '@/components/layout/portal-ui';
import { ACCRA_TIME_ZONE } from '@/lib/date-key';
import { getHomeView, getServerHomeView, subscribeDeviceKind } from '@/lib/device-kind';
import { cn } from '@/lib/utils';

// Office time: attendance is judged in Accra time, so the clock shows it on every device.
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ACCRA_TIME_ZONE });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: ACCRA_TIME_ZONE, weekday: 'long' });

type Now = { date: string; time: string };

// Ticks every second but only changes state when the minute (or day) changes. Null until mounted:
// the server doesn't know the time the visitor will see.
function useNow() {
  const [now, setNow] = useState<Now | null>(null);

  useEffect(() => {
    const tick = () => {
      const date = new Date();
      const next = { date: dateFormat.format(date), time: timeFormat.format(date) };
      setNow((previous) => (previous?.time === next.time && previous.date === next.date ? previous : next));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

const CLOCK_SIZES = {
  compact: { card: 'from-primary/20 px-6 py-9', circleA: '-right-10 -top-10 h-36 w-36', circleB: '-bottom-12 -left-8 h-28 w-28', date: 'mt-3 text-base', time: 'text-[64px]' },
  large: { card: 'min-h-[400px] from-primary/25', circleA: '-right-14 -top-14 h-52 w-52', circleB: '-bottom-16 -left-12 h-40 w-40', date: 'mt-4 text-lg', time: 'text-[104px]' },
};

// The time-and-date card. It keeps its own ticking state, so only the card re-renders each minute.
// Until the time is known an invisible placeholder keeps its size.
function ClockCard({ size }: { size: keyof typeof CLOCK_SIZES }) {
  const now = useNow();
  const sizes = CLOCK_SIZES[size];

  return (
    <div className={cn('relative flex w-full flex-col items-center justify-center overflow-hidden rounded-[28px] border border-primary/25 bg-gradient-to-br to-primary/5 text-center', sizes.card)}>
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', sizes.circleA)} />
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', sizes.circleB)} />
      <div className={now ? 'relative' : 'invisible'}>
        {/* leading-none after the size: cn drops a line height that comes before a font size. */}
        <time className={cn('block font-bold tracking-tight tabular-nums', sizes.time, 'leading-none')}>{now?.time ?? '00:00'}</time>
        <p className={cn('font-medium text-muted-foreground', sizes.date)}>{now?.date ?? 'Today'}</p>
      </div>
    </div>
  );
}

// Portal home. Phones (and narrow windows): the clock on top, the two portals in the bottom panel,
// like the admin portal's phone screen. Computers: one wide card, the clock on the left and the two
// portals as big blocks on the right. Only the chosen layout is rendered; before the browser has
// answered (server render and hydration) both are present and CSS shows the one that fits the width.
export default function Home() {
  useApplyDarkMode();
  const view = useSyncExternalStore(subscribeDeviceKind, getHomeView, getServerHomeView);

  return (
    <main className="relative min-h-dvh bg-background text-foreground">
      <PortalPickers />

      {view !== 'wide' && (
        <div className={cn('flex min-h-dvh flex-col', view === null && 'lg:hidden')}>
          <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 items-center px-6 pb-8 pt-24">
            <ClockCard size="compact" />
          </div>
          <ChoicePanel label="Choose a portal">
            <ChoiceCard highlight href="/check-in" icon={<LogIn className="h-[22px] w-[22px]" />} title="Attendance Portal" />
            <ChoiceCard href="/dashboard" icon={<LayoutDashboard className="h-[22px] w-[22px]" />} title="Admin Portal" />
          </ChoicePanel>
        </div>
      )}

      {view !== 'compact' && (
        // py-24 keeps the card clear of the theme and mode buttons on short windows.
        <div className={cn('min-h-dvh items-center justify-center px-10 py-24', view === null ? 'hidden lg:flex' : 'flex')}>
          <div className="grid w-full max-w-5xl grid-cols-2 gap-3 rounded-[36px] border border-border bg-card p-3 shadow-xl">
            <ClockCard size="large" />
            <nav className="flex flex-col gap-3" aria-label="Choose a portal">
              <ChoiceCard highlight size="large" href="/check-in" icon={<LogIn className="h-8 w-8" />} title="Attendance Portal" />
              <ChoiceCard size="large" href="/dashboard" icon={<LayoutDashboard className="h-8 w-8" />} title="Admin Portal" />
            </nav>
          </div>
        </div>
      )}
    </main>
  );
}
