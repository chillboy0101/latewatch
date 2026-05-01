// components/layout/dashboard-layout.tsx
'use client';

import { createContext, useContext } from 'react';
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
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={title} userRole={userRole} />
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">{children}</main>
        </div>
      </div>
    </DashboardShellContext.Provider>
  );
}
