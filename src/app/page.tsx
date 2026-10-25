'use client';

import Link from 'next/link';
import { ArrowRight, LayoutDashboard, LogIn } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ChoiceCard, ChoicePanel, PortalPickers, useApplyDarkMode } from '@/components/layout/portal-ui';
import { cn } from '@/lib/utils';

type Now = { date: string; time: string };

function formatNow(now: Date): Now {
  return {
    date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' }),
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

// Today's time and date, ticking. Null until mounted: the server doesn't know the visitor's clock.
function useNow() {
  const [now, setNow] = useState<Now | null>(null);

  useEffect(() => {
    const tick = () => setNow(formatNow(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

// The time-and-date card. Until the time is known an invisible placeholder keeps its size.
function ClockCard({ large, now }: { large?: boolean; now: Now | null }) {
  return (
    <div className={cn(
      'relative flex w-full flex-col items-center justify-center overflow-hidden border border-primary/25 bg-gradient-to-br text-center',
      large ? 'min-h-[400px] rounded-[28px] from-primary/25 to-primary/5' : 'rounded-[28px] from-primary/20 to-primary/5 px-6 py-9',
    )}>
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', large ? '-right-14 -top-14 h-52 w-52' : '-right-10 -top-10 h-36 w-36')} />
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', large ? '-bottom-16 -left-12 h-40 w-40' : '-bottom-12 -left-8 h-28 w-28')} />
      <div className={now ? 'relative' : 'invisible'}>
        {/* leading-none after the size: cn drops a line height that comes before a font size. */}
        <time className={cn('block font-bold tracking-tight tabular-nums', large ? 'text-[104px]' : 'text-[64px]', 'leading-none')}>
          {now?.time ?? '00:00'}
        </time>
        <p className={cn('font-medium text-muted-foreground', large ? 'mt-4 text-lg' : 'mt-3 text-base')}>
          {now?.date ?? 'Today'}
        </p>
      </div>
    </div>
  );
}

// Computers: each portal is a big block filling half of the card's right side.
function LargeChoiceCard({ highlight, href, icon, title }: {
  highlight?: boolean;
  href: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-1 items-center gap-6 rounded-[28px] border px-8 transition-[filter] hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        highlight ? 'border-primary/35 bg-gradient-to-br from-primary/30 to-primary/10' : 'border-border bg-background/40',
      )}
    >
      <span className={cn(
        'flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[22px]',
        highlight ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25' : 'bg-foreground/5 text-primary',
      )}>
        {icon}
      </span>
      <span className="min-w-0 text-[26px] font-semibold leading-tight tracking-tight">{title}</span>
      <span className={cn(
        'ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-transform group-hover:translate-x-1',
        highlight ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-border text-muted-foreground',
      )}>
        <ArrowRight className="h-5 w-5" />
      </span>
    </Link>
  );
}

// Portal home. Phones and tablets: the clock on top, the two portals in the bottom panel (like the
// admin portal's phone screen). Computers: one wide card, the clock on the left and the two
// portals as big blocks on the right.
export default function Home() {
  useApplyDarkMode();
  const now = useNow();

  return (
    <main className="relative min-h-dvh bg-background text-foreground">
      <PortalPickers />

      <div className="flex min-h-dvh flex-col lg:hidden">
        <div className="flex min-h-0 flex-1 items-center px-6 pb-8 pt-24">
          <ClockCard now={now} />
        </div>
        <ChoicePanel label="Choose a portal">
          <ChoiceCard highlight href="/check-in" icon={<LogIn className="h-[22px] w-[22px]" />} title="Attendance Portal" />
          <ChoiceCard href="/dashboard" icon={<LayoutDashboard className="h-[22px] w-[22px]" />} title="Admin Portal" />
        </ChoicePanel>
      </div>

      <div className="hidden min-h-dvh items-center justify-center p-10 lg:flex">
        <div className="grid w-full max-w-5xl grid-cols-2 gap-3 rounded-[36px] border border-border bg-card p-3 shadow-xl">
          <ClockCard large now={now} />
          <nav className="flex flex-col gap-3" aria-label="Choose a portal">
            <LargeChoiceCard highlight href="/check-in" icon={<LogIn className="h-8 w-8" />} title="Attendance Portal" />
            <LargeChoiceCard href="/dashboard" icon={<LayoutDashboard className="h-8 w-8" />} title="Admin Portal" />
          </nav>
        </div>
      </div>
    </main>
  );
}
