// components/layout/sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { cn } from '@/lib/utils';
import {
  Home,
  LayoutDashboard,
  Users,
  Table2,
  Download,
  Calendar,
  ClipboardCheck,
  PhoneCall,
  Shield,
  Wifi,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Staff', href: '/staff', icon: Users },
  { name: 'Emergency', href: '/emergency-contacts', icon: PhoneCall },
  { name: 'Attendance', href: '/attendance', icon: ClipboardCheck },
  { name: 'WiFi', href: '/wifi', icon: Wifi },
  { name: 'Lateness Entries', href: '/entries', icon: Table2 },
  { name: 'Lateness Exports', href: '/exports', icon: Download },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Audit Trail', href: '/audit-trail', icon: Shield },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center border-b border-border px-6">
        <LateWatchLogo markSize="sm" />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted hover:bg-background hover:text-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
        >
          <Home className="h-5 w-5" />
          Main Portal
        </Link>
      </div>
    </div>
  );
}
