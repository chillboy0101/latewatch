'use client';

import { LayoutDashboard, LogIn } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChoiceCard, ChoicePanel, PortalPickers, useApplyDarkMode } from '@/components/layout/portal-ui';
import { ACCRA_TIME_ZONE } from '@/lib/date-key';
import { getHomeView, getServerHomeView, subscribeDeviceKind } from '@/lib/device-kind';
import { cn } from '@/lib/utils';

// Office time: attendance is judged in Accra time, so the clock shows it on every device.
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit', timeZone: ACCRA_TIME_ZONE });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: ACCRA_TIME_ZONE, weekday: 'long' });

type Now = { date: string; hours: number; minutes: number; seconds: number };

// Ticks every second (the minute hand creeps with the seconds). Null until mounted: the server doesn't know the time the
// visitor will see.
function useNow() {
  const [now, setNow] = useState<Now | null>(null);

  useEffect(() => {
    const tick = () => {
      const date = new Date();
      const [hours, minutes, seconds] = timeFormat.format(date).split(':').map(Number);
      setNow({ date: dateFormat.format(date), hours: hours % 24, minutes, seconds });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

const CLOCK_SIZES = {
  compact: { card: 'from-primary/20 px-6 py-8', circleA: '-right-10 -top-10 h-36 w-36', circleB: '-bottom-12 -left-8 h-28 w-28', date: 'mt-4 text-base', face: 'size-48' },
  large: { card: 'min-h-[400px] from-primary/25', circleA: '-right-14 -top-14 h-52 w-52', circleB: '-bottom-16 -left-12 h-40 w-40', date: 'mt-5 text-lg', face: 'size-64' },
};

const TICKS = Array.from({ length: 60 }, (_, index) => index);

// A clock hand from the centre of the 200×200 face, pointing at `angle` degrees from 12 o'clock.
function Hand({ angle, className, length, tail = 0, width }: { angle: number; className: string; length: number; tail?: number; width: number }) {
  return (
    <line
      className={className}
      strokeLinecap="round"
      strokeWidth={width}
      transform={`rotate(${angle} 100 100)`}
      x1="100"
      x2="100"
      y1={100 + tail}
      y2={100 - length}
    />
  );
}

// The second hand sweeps smoothly instead of ticking: its angle is set on every animation frame
// straight on the element, so the card doesn't re-render 60 times a second. Accra is on UTC, so the
// seconds come straight from the epoch time.
function SweepHand() {
  const ref = useRef<SVGLineElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      ref.current?.setAttribute('transform', `rotate(${(Date.now() % 60_000) * 0.006} 100 100)`);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <line className="stroke-primary" ref={ref} strokeLinecap="round" strokeWidth={1.75} x1="100" x2="100" y1="120" y2="20" />;
}

// The analogue face: minute ticks, longer hour marks, and hour, minute and second hands.
function AnalogClock({ className, now }: { className: string; now: Now | null }) {
  const hours = now ? (now.hours % 12) * 30 + now.minutes * 0.5 : 0;
  const minutes = now ? now.minutes * 6 + now.seconds * 0.1 : 0;

  return (
    <svg aria-hidden className={cn('shrink-0', className)} viewBox="0 0 200 200">
      <circle className="fill-card/70 stroke-primary/25" cx="100" cy="100" r="96" strokeWidth="2" />
      {TICKS.map((index) => {
        const hourMark = index % 5 === 0;
        return (
          <line
            className={hourMark ? 'stroke-foreground/70' : 'stroke-foreground/20'}
            key={index}
            strokeLinecap="round"
            strokeWidth={hourMark ? 3 : 1.5}
            transform={`rotate(${index * 6} 100 100)`}
            x1="100"
            x2="100"
            y1="12"
            y2={hourMark ? 26 : 19}
          />
        );
      })}
      <g className={now ? undefined : 'invisible'}>
        <Hand angle={hours} className="stroke-foreground" length={48} tail={10} width={6} />
        <Hand angle={minutes} className="stroke-foreground" length={72} tail={12} width={4} />
        <SweepHand />
        <circle className="fill-primary" cx="100" cy="100" r="5" />
        <circle className="fill-card" cx="100" cy="100" r="2" />
      </g>
    </svg>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

// The clock-and-date card. It keeps its own ticking state, so only the card re-renders each second.
function ClockCard({ size }: { size: keyof typeof CLOCK_SIZES }) {
  const now = useNow();
  const sizes = CLOCK_SIZES[size];

  return (
    <div className={cn('relative flex w-full flex-col items-center justify-center overflow-hidden rounded-[28px] border border-primary/25 bg-gradient-to-br to-primary/5 text-center', sizes.card)}>
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', sizes.circleA)} />
      <span aria-hidden className={cn('absolute rounded-full bg-primary/10', sizes.circleB)} />
      <div className="relative flex flex-col items-center">
        <AnalogClock className={sizes.face} now={now} />
        {now && <time className="sr-only">{`${pad(now.hours)}:${pad(now.minutes)}`}</time>}
        <p className={cn('font-medium text-muted-foreground', sizes.date, !now && 'invisible')}>{now?.date ?? 'Today'}</p>
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
