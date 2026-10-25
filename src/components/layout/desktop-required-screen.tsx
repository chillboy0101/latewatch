'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, LayoutDashboard, LogIn } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { ModePicker } from '@/components/theme/mode-picker';
import { ThemePicker } from '@/components/theme/theme-picker';
import { cn } from '@/lib/utils';

// Lines of the drawing: the theme colour lifted toward the text colour, so it reads in every theme
// and in light and dark mode.
const ink = 'color-mix(in oklab, var(--primary) 55%, var(--foreground))';

// A laptop (ticked: the right device) with a faded phone in front of it: "use a computer for this".
function DevicesIllustration() {
  return (
    <div aria-hidden className="relative h-[164px] w-[232px]">
      <div
        className="absolute left-0 top-0 h-[118px] w-[184px] rounded-[13px] border-2"
        style={{ background: `linear-gradient(160deg, color-mix(in oklab, ${ink} 14%, transparent), color-mix(in oklab, ${ink} 3%, transparent))`, borderColor: ink }}
      >
        <div className="absolute left-[18px] right-[54px] top-[18px] flex flex-col gap-[9px]">
          <span className="h-[9px] rounded-full" style={{ background: `color-mix(in oklab, ${ink} 32%, transparent)` }} />
          <span className="h-[9px] w-[68%] rounded-full" style={{ background: `color-mix(in oklab, ${ink} 32%, transparent)` }} />
          <span className="h-[9px] w-[44%] rounded-full" style={{ background: `color-mix(in oklab, ${ink} 58%, transparent)` }} />
        </div>
        <span className="absolute right-3 top-3 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      </div>
      <div className="absolute -left-3.5 top-[124px] h-3 w-[212px] rounded-b-xl rounded-t-sm" style={{ background: ink }} />
      <div
        className="absolute bottom-0 right-0 flex h-[104px] w-[58px] justify-center rounded-[14px] border-2 bg-background shadow-[-8px_10px_24px_rgba(0,0,0,0.3)]"
        style={{ borderColor: `color-mix(in oklab, ${ink} 45%, transparent)` }}
      >
        <span className="absolute top-[7px] h-[3px] w-4 rounded-full" style={{ background: `color-mix(in oklab, ${ink} 25%, transparent)` }} />
      </div>
    </div>
  );
}

function ChoiceCard({ highlight, href, icon, title }: {
  highlight?: boolean;
  href: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex h-[86px] items-center gap-4 rounded-[22px] border px-[18px] transition-[filter] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:brightness-95',
        highlight ? 'border-primary/35 bg-gradient-to-br from-primary/30 to-primary/10' : 'border-border bg-background/40',
      )}
    >
      <span className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
        highlight ? 'bg-primary text-primary-foreground' : 'bg-foreground/5 text-primary',
      )}>
        {icon}
      </span>
      <span className="min-w-0 text-[17.5px] font-semibold leading-tight">{title}</span>
      <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// Phones opening an admin page: the admin portal needs a computer, so offer the attendance
// portal (or the portal chooser). The drawing on top, a panel with the choices.
export function DesktopRequiredScreen() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-background text-foreground lg:hidden">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <LateWatchLogo markSize="md" />
        <div className="flex items-center gap-2">
          <ThemePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" iconClassName="h-5 w-5" />
          <ModePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" />
        </div>
      </header>

      {/* The drawing sits centred in the space between the header and the panel. */}
      <div className="flex min-h-0 flex-1 items-center justify-center pb-7 pt-24">
        <DevicesIllustration />
      </div>

      <section className="rounded-t-[32px] border-t border-border bg-card px-6 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3">
        <div aria-hidden className="mx-auto mb-6 h-[5px] w-10 rounded-full bg-foreground/15" />
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Admin needs a computer</h1>
        <nav className="mt-6 grid gap-3" aria-label="Where to go">
          <ChoiceCard
            highlight
            href="/check-in"
            icon={<LogIn className="h-[22px] w-[22px]" />}
            title="Attendance Portal"
          />
          <ChoiceCard
            href="/"
            icon={<LayoutDashboard className="h-[22px] w-[22px]" />}
            title="Portal Home"
          />
        </nav>
      </section>
    </main>
  );
}
