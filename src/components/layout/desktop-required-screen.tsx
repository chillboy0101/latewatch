'use client';

import { Check, LayoutDashboard, LogIn } from 'lucide-react';
import { ChoiceCard, ChoicePanel, PortalPickers, useApplyDarkMode } from './portal-ui';
import { handwriting } from '@/lib/fonts';
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

// Phones opening an admin page: the admin portal needs a computer, so offer the attendance
// portal (or the portal chooser). The drawing and the message on top, a panel with the choices.
export function DesktopRequiredScreen() {
  useApplyDarkMode();

  return (
    <main className="relative flex min-h-dvh flex-col bg-background text-foreground">
      <PortalPickers />

      {/* The drawing and the message sit centred in the space between the header and the panel. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-9 px-6 pb-8 pt-24">
        <DevicesIllustration />
        <h1 className={cn(handwriting.className, 'text-center text-[44px] leading-[1.05]')}>
          Admin needs
          <span className="block" style={{ color: ink }}>a computer</span>
        </h1>
      </div>

      <ChoicePanel label="Where to go">
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
      </ChoicePanel>
    </main>
  );
}
