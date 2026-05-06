'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Apple, ArrowRight, CheckCircle2, Download, ExternalLink, Smartphone } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type DeviceKind = 'android' | 'ios' | 'other';

function detectDeviceKind() {
  if (typeof window === 'undefined') return 'other';

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || '';
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;
  const isIpadOS = platform.includes('mac') && maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isIpadOS) return 'ios';
  if (/android/.test(userAgent)) return 'android';
  return 'other';
}

function guidanceForDevice(deviceKind: DeviceKind) {
  if (deviceKind === 'ios') {
    return {
      icon: Apple,
      title: 'Add on iPhone',
      steps: ['Open this page in Safari.', 'Tap Share.', 'Tap Add to Home Screen, then Add.'],
    };
  }

  if (deviceKind === 'android') {
    return {
      icon: Smartphone,
      title: 'Install on Android',
      steps: ['Open this page in Chrome.', 'Tap Install app if it appears.', 'If not, use the browser menu and tap Add to Home screen.'],
    };
  }

  return {
    icon: Smartphone,
    title: 'Install on your phone',
    steps: ['Open this page on your phone browser.', 'Use the browser menu.', 'Choose Install app or Add to Home Screen.'],
  };
}

export default function InstallPage() {
  const [deviceKind] = useState<DeviceKind>(() => detectDeviceKind());
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<'idle' | 'installed' | 'prompted'>('idle');
  const guidance = useMemo(() => guidanceForDevice(deviceKind), [deviceKind]);
  const GuidanceIcon = guidance.icon;
  const canPromptInstall = deviceKind === 'android' && installPrompt;

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function onInstalled() {
      setInstallPrompt(null);
      setInstallState('installed');
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;

    setInstallState('prompted');
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallState('installed');
      setInstallPrompt(null);
    } else {
      setInstallState('idle');
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-4 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col sm:min-h-[calc(100dvh-4rem)]">
        <header className="flex items-center justify-between">
          <LateWatchLogo subtitle="Attendance web app" />
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link href="/check-in">
              Open
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </header>

        <section className="flex flex-1 items-center py-8">
          <Card className="w-full overflow-hidden">
            <div className="space-y-5 p-5 sm:p-6">
              <div className="space-y-3 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <Download className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold leading-tight">Install LateWatch</h1>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    Add the attendance portal to your home screen, then open it whenever you need to check in or check out.
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-border bg-card/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <GuidanceIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold">{guidance.title}</h2>
                    <ol className="mt-2 space-y-2 text-sm leading-5 text-muted-foreground">
                      {guidance.steps.map((step) => (
                        <li key={step} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>

              {installState === 'installed' && (
                <div className="rounded-md border border-success/25 bg-success/10 px-3 py-2 text-sm font-medium text-success">
                  LateWatch was added to this device.
                </div>
              )}

              <div className="grid gap-2">
                {canPromptInstall && (
                  <Button className="h-11 gap-2" onClick={installApp} disabled={installState === 'prompted'}>
                    <Download className={cn('h-5 w-5', installState === 'prompted' && 'animate-pulse')} />
                    {installState === 'prompted' ? 'Waiting for browser' : 'Install LateWatch'}
                  </Button>
                )}
                <Button asChild className="h-11 gap-2" variant={canPromptInstall ? 'outline' : 'default'}>
                  <Link href="/check-in">
                    Open Attendance
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
