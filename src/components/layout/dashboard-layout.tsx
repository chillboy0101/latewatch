// components/layout/dashboard-layout.tsx
'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Monitor, Smartphone } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { ModePicker } from '@/components/theme/mode-picker';
import { ThemePicker } from '@/components/theme/theme-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sidebar } from './sidebar';
import { Header } from './header';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  userRole?: string;
}

const DashboardShellContext = createContext(false);

export function DashboardLayout({ children, title, userRole }: DashboardLayoutProps) {
  const isInsideDashboardShell = useContext(DashboardShellContext);

  if (isInsideDashboardShell) {
    return <>{children}</>;
  }

  return (
    <DashboardShellContext.Provider value={true}>
      {/* Phones: the admin portal needs a bigger screen. Styled like the attendance portal it points to. */}
      <main className="flex h-dvh flex-col overflow-hidden overscroll-none bg-background text-foreground lg:hidden">
        <div className="mx-auto flex h-full w-full max-w-xl flex-col px-3 py-3 sm:px-6 sm:py-4">
          <header className="flex h-12 shrink-0 items-center justify-between sm:h-14">
            <LateWatchLogo markSize="md" />
            <div className="flex items-center gap-2">
              <ThemePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" iconClassName="h-5 w-5" />
              <ModePicker buttonVariant="glass" buttonClassName="h-10 w-10 rounded-full" />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 py-3 sm:py-4">
            <Card className="flex h-full w-full flex-col overflow-hidden rounded-2xl">
              <div className="flex flex-1 flex-col p-3 sm:p-5">
                <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl border border-primary/25 bg-primary/10 p-6 text-center text-primary sm:gap-7 sm:p-8">
                  <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
                    <span aria-hidden className="absolute inset-0 rounded-full bg-current opacity-15" />
                    <span className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-current/20 ring-1 ring-current/30 sm:h-20 sm:w-20">
                      <Monitor className="h-9 w-9 sm:h-10 sm:w-10" />
                    </span>
                  </div>
                  <div className="flex max-w-xs flex-col items-center gap-3">
                    <h1 className="text-2xl font-bold leading-tight text-balance sm:text-3xl">Open on a computer</h1>
                    <p className="text-base leading-relaxed text-muted-foreground">
                      The admin portal is built for laptop and desktop screens. On this phone you can check in from the attendance portal.
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid shrink-0 gap-2.5 border-t border-border p-3 sm:p-5">
                <Button asChild className="h-14 w-full gap-2.5 rounded-2xl text-base font-semibold shadow-sm sm:h-16 sm:text-lg">
                  <Link href="/check-in">
                    <Smartphone className="h-5 w-5 sm:h-6 sm:w-6" />
                    Open Attendance Portal
                  </Link>
                </Button>
                <Button asChild variant="glass" className="h-12 w-full gap-2 rounded-2xl text-base font-medium">
                  <Link href="/">
                    <LayoutDashboard className="h-5 w-5" />
                    Portal Home
                  </Link>
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </main>
      <div className="relative hidden h-screen w-full overflow-hidden lg:flex">
        <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 top-16 z-50 h-px bg-border" />
        <Sidebar />
        {/* relative: page loaders centre in this column, so they track the sidebar's width. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Header title={title} userRole={userRole} />
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">{children}</main>
        </div>
      </div>
    </DashboardShellContext.Provider>
  );
}
