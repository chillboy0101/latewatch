'use client';

import { usePathname } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';

const WORKSPACE_TITLES: Record<string, string> = {
  'audit-trail': 'Audit Trail',
  attendance: 'Attendance',
  calendar: 'Calendar',
  contributions: 'Contributions',
  dashboard: 'Dashboard',
  entries: 'Entries',
  'emergency-contacts': 'Emergency Contacts',
  exports: 'Exports',
  payments: 'Payments',
  settings: 'Settings',
  staff: 'Staff',
};

export function getWorkspaceTitle(pathname: string | null) {
  const firstSegment = pathname?.split('/').filter(Boolean)[0];
  if (!firstSegment) return null;

  return WORKSPACE_TITLES[firstSegment] ?? null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const title = getWorkspaceTitle(pathname);

  if (!title) return <>{children}</>;

  return <DashboardLayout title={title}>{children}</DashboardLayout>;
}
