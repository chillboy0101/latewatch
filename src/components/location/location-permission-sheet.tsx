'use client';

import { useState } from 'react';
import { Loader2, MapPin, MapPinOff, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { detectPhoneOs } from '@/lib/phone-os';
import { cn } from '@/lib/utils';

export type LocationSheetMode = 'ask' | 'blocked';

// Steps to turn location back on after it was blocked. A home-screen app uses its browser's setting.
const FIX_STEPS: Record<'ios' | 'android', string[]> = {
  ios: [
    'Open Settings › Privacy & Security',
    'Tap Location Services › Safari Websites',
    'Pick While Using the App',
  ],
  android: [
    'Open Chrome › ⋮ › Settings',
    'Tap Site settings › Location',
    'Allow this site',
  ],
};

// Asks for location before the browser does (mode "ask"), or shows how to turn it back on once it
// was blocked (mode "blocked").
export function LocationPermissionSheet({
  mode,
  onAllow,
  onOpenChange,
  onRetry,
  open,
}: {
  mode: LocationSheetMode;
  onAllow: () => void;
  onOpenChange: (open: boolean) => void;
  // Resolves true once location works again.
  onRetry: () => Promise<boolean>;
  open: boolean;
}) {
  const [phone, setPhone] = useState<'ios' | 'android'>(() => (detectPhoneOs() === 'android' ? 'android' : 'ios'));
  const [retrying, setRetrying] = useState(false);
  const [stillOff, setStillOff] = useState(false);
  const blocked = mode === 'blocked';

  const handleOpenChange = (next: boolean) => {
    if (!next) setStillOff(false);
    onOpenChange(next);
  };

  const retry = async () => {
    setRetrying(true);
    setStillOff(false);
    try {
      const ok = await onRetry();
      if (!ok) setStillOff(true);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex flex-col items-center gap-4 pt-5 text-center">
          <div
            aria-hidden
            className={cn(
              'relative flex size-20 shrink-0 items-center justify-center',
              blocked ? 'text-warning' : 'text-primary',
            )}
          >
            <span className="absolute inset-0 rounded-full bg-current opacity-15" />
            <span className="relative flex size-[76%] items-center justify-center rounded-full bg-current/20 ring-1 ring-current/30">
              {blocked ? <MapPinOff className="size-[50%]" /> : <MapPin className="size-[50%]" />}
            </span>
          </div>
          <div className="grid gap-1.5">
            <DrawerTitle className="text-2xl font-bold leading-tight">
              {blocked ? 'Location is off' : 'Turn on location'}
            </DrawerTitle>
            <DrawerDescription className="text-[15px] text-muted-foreground">
              {blocked ? 'Turn it on to check in.' : 'Needed to check in.'}
            </DrawerDescription>
          </div>

          {blocked ? (
            <>
              <div role="tablist" aria-label="Phone" className="grid w-full grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
                {(['ios', 'android'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    aria-selected={phone === kind}
                    onClick={() => setPhone(kind)}
                    className={cn(
                      'h-10 rounded-lg text-sm transition-colors',
                      phone === kind ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {kind === 'ios' ? 'iPhone' : 'Android'}
                  </button>
                ))}
              </div>
              <ol className="w-full divide-y divide-border rounded-2xl border border-border bg-card px-4 text-left">
                {FIX_STEPS[phone].map((step, index) => (
                  <li key={step} className="flex min-h-12 items-center gap-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              {stillOff && (
                <p role="status" className="text-sm font-medium text-warning">Still off. Follow the steps, then try again.</p>
              )}
            </>
          ) : null}

          <div className="grid w-full gap-1.5">
            {blocked ? (
              <Button className="h-14 w-full gap-2.5 rounded-2xl text-base font-semibold" disabled={retrying} onClick={() => void retry()} type="button">
                {retrying ? <Loader2 className="size-5 animate-spin" /> : <RotateCw className="size-5" />}
                Try again
              </Button>
            ) : (
              <Button className="h-14 w-full gap-2.5 rounded-2xl text-base font-semibold" onClick={onAllow} type="button">
                <MapPin className="size-5" />
                Allow location
              </Button>
            )}
            <Button className="h-11 w-full text-[15px] text-muted-foreground" onClick={() => handleOpenChange(false)} type="button" variant="ghost">
              {blocked ? 'Close' : 'Not now'}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
