// components/layout/dashboard-layout.tsx
'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Monitor, Smartphone } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
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
      <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-8 text-foreground lg:hidden">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-sm">
          <LateWatchLogo markSize="md" />
          <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-background text-primary">
                <Monitor className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold">Desktop required</h1>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The admin portal is optimized for laptop and desktop screens.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <Link
              href="/check-in"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/35"
            >
              <Smartphone className="h-4 w-4" />
              Open Attendance Portal
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/35"
            >
              <LayoutDashboard className="h-4 w-4" />
              Portal Home
            </Link>
          </div>
        </div>
      </div>
      <div className="hidden h-screen w-full overflow-hidden lg:flex">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={title} userRole={userRole} />
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">{children}</main>
        </div>
      </div>
    </DashboardShellContext.Provider>
  );
}
