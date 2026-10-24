// components/layout/dashboard-layout.tsx
'use client';

import { createContext, useContext } from 'react';
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

  if (isInsideDashboardShell) {
    return <>{children}</>;
  }

  return (
    <DashboardShellContext.Provider value={true}>
      <DesktopRequiredScreen />
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
