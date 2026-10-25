// components/layout/dashboard-layout.tsx
'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { getDeviceKind, getServerDeviceKind, subscribeDeviceKind } from '@/lib/device-kind';
import { DesktopRequiredScreen } from './desktop-required-screen';
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
  const deviceKind = useSyncExternalStore(subscribeDeviceKind, getDeviceKind, getServerDeviceKind);

  if (isInsideDashboardShell) {
    return <>{children}</>;
  }

  // Only one of the two is rendered, so on phones the admin pages never mount or fetch.
  if (deviceKind === null) {
    return <LoadingBuffer variant="screen" label="Loading page" description="Preparing the next screen." />;
  }

  if (deviceKind === 'phone') {
    return <DesktopRequiredScreen />;
  }

  return (
    <DashboardShellContext.Provider value={true}>
      <div className="relative flex h-screen w-full overflow-hidden">
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
