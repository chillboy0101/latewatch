'use client';

import { LayoutDashboard, LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChoiceCard, ChoicePanel, PortalPickers, useApplyDarkMode } from '@/components/layout/portal-ui';

function formatNow(now: Date) {
  return {
    date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' }),
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

// Today's time and date, ticking. Rendered after mount (the server doesn't know the visitor's
// clock); until then an invisible placeholder keeps the card's size.
function LiveClock() {
  const [now, setNow] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    const tick = () => setNow(formatNow(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-[28px] border border-primary/25 bg-gradient-to-br from-primary/20 to-primary/5 px-6 py-9 text-center">
      <span aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/10" />
      <span aria-hidden className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-primary/10" />
      <p className={now ? 'relative' : 'invisible'}>
        <time className="block text-[64px] font-bold leading-none tracking-tight tabular-nums">{now?.time ?? '00:00'}</time>
        <span className="mt-3 block text-base font-medium text-muted-foreground">{now?.date ?? 'Today'}</span>
      </p>
    </div>
  );
}

// Portal home: the clock on top, the two portals in the bottom panel (like the admin portal's
// phone screen). On wide screens the two sit together in a centred column.
export default function Home() {
  useApplyDarkMode();

  return (
    <main className="relative flex min-h-dvh flex-col bg-background text-foreground lg:items-center lg:justify-center">
      <PortalPickers />
      <div className="flex min-h-dvh w-full flex-col lg:min-h-0 lg:max-w-[440px]">
        <div className="flex min-h-0 flex-1 items-center px-6 pb-8 pt-24 lg:flex-none lg:px-0 lg:pt-0">
          <LiveClock />
        </div>
        <ChoicePanel label="Choose a portal">
          <ChoiceCard highlight href="/check-in" icon={<LogIn className="h-[22px] w-[22px]" />} title="Attendance Portal" />
          <ChoiceCard href="/dashboard" icon={<LayoutDashboard className="h-[22px] w-[22px]" />} title="Admin Portal" />
        </ChoicePanel>
      </div>
    </main>
  );
}
