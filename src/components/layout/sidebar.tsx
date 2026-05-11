// components/layout/sidebar.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LateWatchMark } from '@/components/brand/latewatch-logo';
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
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

type SidebarMode = 'auto' | 'fixed';

const SIDEBAR_MODE_STORAGE_KEY = 'latewatch-sidebar-mode';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Staff', href: '/staff', icon: Users },
  { name: 'Emergency', href: '/emergency-contacts', icon: PhoneCall },
  { name: 'Attendance', href: '/attendance', icon: ClipboardCheck },
  { name: 'Location', href: '/wifi', icon: MapPin },
  { name: 'Lateness Entries', href: '/entries', icon: Table2 },
  { name: 'Lateness Exports', href: '/exports', icon: Download },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Audit Trail', href: '/audit-trail', icon: Shield },
];

function isSidebarMode(value: string | null): value is SidebarMode {
  return value === 'auto' || value === 'fixed';
}

export function Sidebar() {
  const pathname = usePathname();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('auto');
  const [hasLoadedSidebarMode, setHasLoadedSidebarMode] = useState(false);
  const isFixed = sidebarMode === 'fixed';
  const toggleLabel = isFixed ? 'Use auto-hide sidebar' : 'Pin sidebar open';

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
      if (isSidebarMode(savedMode)) {
        setSidebarMode(savedMode);
      }
    } catch {
      // Storage can be blocked; keep the default auto-hide behavior.
    } finally {
      setHasLoadedSidebarMode(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedSidebarMode) return;

    try {
      localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, sidebarMode);
    } catch {
      // Storage can be blocked; the current in-memory mode still works.
    }
  }, [hasLoadedSidebarMode, sidebarMode]);

  function toggleSidebarMode() {
    setSidebarMode((mode) => (mode === 'fixed' ? 'auto' : 'fixed'));
  }

  const labelClassName = cn(
    'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
    isFixed
      ? 'max-w-44 translate-x-0 opacity-100'
      : 'max-w-0 -translate-x-1 opacity-0 group-hover/sidebar:max-w-44 group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100 group-focus-within/sidebar:max-w-44 group-focus-within/sidebar:translate-x-0 group-focus-within/sidebar:opacity-100',
  );

  const itemClassName = cn(
    'flex h-10 w-full items-center rounded-md text-sm font-medium transition-all duration-200 ease-out',
    isFixed
      ? 'gap-3 px-3'
      : 'justify-center gap-0 px-0 group-hover/sidebar:justify-start group-hover/sidebar:gap-3 group-hover/sidebar:px-3 group-focus-within/sidebar:justify-start group-focus-within/sidebar:gap-3 group-focus-within/sidebar:px-3',
  );

  return (
    <div className={cn('relative h-full shrink-0 transition-[width] duration-200 ease-out', isFixed ? 'w-64' : 'w-16')}>
      <div
        className={cn(
          'group/sidebar absolute inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-card transition-[width,box-shadow] duration-200 ease-out',
          isFixed
            ? 'w-64'
            : 'w-16 hover:w-64 focus-within:w-64 group-hover/sidebar:w-64 group-focus-within/sidebar:w-64 hover:shadow-xl focus-within:shadow-xl',
        )}
      >
        <div className={cn('flex h-16 items-center border-b border-border transition-all duration-200', isFixed ? 'px-6' : 'justify-center px-0 group-hover/sidebar:justify-start group-hover/sidebar:px-6 group-focus-within/sidebar:justify-start group-focus-within/sidebar:px-6')}>
          <div className={cn(
            'flex min-w-0 items-center transition-[gap] duration-200',
            isFixed
              ? 'gap-2.5'
              : 'gap-0 group-hover/sidebar:gap-2.5 group-focus-within/sidebar:gap-2.5',
          )}>
            <LateWatchMark size="sm" />
            <span className={cn('text-lg font-semibold leading-tight', labelClassName)}>
              LateWatch
            </span>
          </div>
        </div>
        <nav className={cn('flex-1 space-y-1 py-4 transition-[padding] duration-200', isFixed ? 'px-3' : 'px-2 group-hover/sidebar:px-3 group-focus-within/sidebar:px-3')}>
          {navigation.map((item) => {
            const isActive =
              pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.name}
                title={item.name}
                className={cn(
                  itemClassName,
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:bg-background hover:text-foreground',
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className={labelClassName}>{item.name}</span>
              </Link>
            );
          })}
        </nav>
        <div className={cn('space-y-2 border-t border-border py-3 transition-[padding] duration-200', isFixed ? 'px-3' : 'px-2 group-hover/sidebar:px-3 group-focus-within/sidebar:px-3')}>
          <Link
            href="/"
            aria-label="Main Portal"
            title="Main Portal"
            className={cn(
              itemClassName,
              'text-muted hover:bg-background hover:text-foreground',
            )}
          >
            <Home className="h-5 w-5 shrink-0" />
            <span className={labelClassName}>Main Portal</span>
          </Link>
          <button
            type="button"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggleSidebarMode}
            className={cn(
              itemClassName,
              'text-muted hover:bg-background hover:text-foreground',
            )}
          >
            {isFixed ? (
              <PanelLeftClose className="h-5 w-5 shrink-0" />
            ) : (
              <PanelLeftOpen className="h-5 w-5 shrink-0" />
            )}
            <span className={labelClassName}>{toggleLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
