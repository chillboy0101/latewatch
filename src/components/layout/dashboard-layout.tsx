// components/layout/dashboard-layout.tsx
'use client';

import { Sidebar } from './sidebar';
import { Header } from './header';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  userRole?: string;
}

export function DashboardLayout({ children, title, userRole }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header title={title} userRole={userRole} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
