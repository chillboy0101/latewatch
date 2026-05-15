// components/layout/sidebar.tsx
'use client';

import { type FocusEvent, useCallback, useEffect, useState } from 'react';
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
  ReceiptText,
} from 'lucide-react';

type SidebarMode = 'auto' | 'fixed';

const SIDEBAR_MODE_STORAGE_KEY = 'latewatch-sidebar-mode';
const SIDEBAR_MOTION_CLASS = 'duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';
const SIDEBAR_LABEL_MOTION_CLASS = 'duration-200 ease-out motion-reduce:transition-none';
let rememberedAutoExpanded = false;

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Staff', href: '/staff', icon: Users },
  { name: 'Emergency', href: '/emergency-contacts', icon: PhoneCall },
  { name: 'Attendance', href: '/attendance', icon: ClipboardCheck },
  { name: 'Location', href: '/wifi', icon: MapPin },
  { name: 'Lateness Entries', href: '/entries', icon: Table2 },
  { name: 'Lateness Exports', href: '/exports', icon: Download },
  { name: 'Penalty Payments', href: '/payments', icon: ReceiptText },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Audit Trail', href: '/audit-trail', icon: Shield },
];

function isSidebarMode(value: string | null): value is SidebarMode {
  return value === 'auto' || value === 'fixed';
}

export function Sidebar() {
  const pathname = usePathname();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('auto');
  const [isAutoExpanded, setIsAutoExpanded] = useState(() => rememberedAutoExpanded);
  const [hasLoadedSidebarMode, setHasLoadedSidebarMode] = useState(false);
  const isFixed = sidebarMode === 'fixed';
  const isExpanded = isFixed || isAutoExpanded;
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

  const setAutoExpanded = useCallback((value: boolean) => {
    rememberedAutoExpanded = value;
    setIsAutoExpanded(value);
  }, []);

  function expandAutoSidebar() {
    if (sidebarMode === 'auto') setAutoExpanded(true);
  }

  function collapseAutoSidebar() {
    if (sidebarMode === 'auto') setAutoExpanded(false);
  }

  useEffect(() => {
    if (sidebarMode !== 'auto') return;

    function collapseAutoSidebarForWindowExit() {
      setAutoExpanded(false);
    }

    function collapseAutoSidebarForHiddenDocument() {
      if (document.visibilityState === 'hidden') {
        collapseAutoSidebarForWindowExit();
      }
    }

    window.addEventListener('blur', collapseAutoSidebarForWindowExit);
    document.addEventListener('visibilitychange', collapseAutoSidebarForHiddenDocument);

    return () => {
      window.removeEventListener('blur', collapseAutoSidebarForWindowExit);
      document.removeEventListener('visibilitychange', collapseAutoSidebarForHiddenDocument);
    };
  }, [setAutoExpanded, sidebarMode]);

  function handleSidebarBlur(event: FocusEvent<HTMLDivElement>) {
    if (sidebarMode !== 'auto') return;

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;

    setAutoExpanded(false);
  }

  function toggleSidebarMode() {
    const nextMode = sidebarMode === 'fixed' ? 'auto' : 'fixed';
    setSidebarMode(nextMode);
    if (nextMode === 'auto') setAutoExpanded(false);
  }

  const labelClassName = cn(
    'min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,transform] will-change-[opacity,transform]',
    SIDEBAR_LABEL_MOTION_CLASS,
    isExpanded
      ? 'translate-x-0 opacity-100'
      : 'pointer-events-none -translate-x-1 opacity-0',
  );

  const itemClassName = cn(
    'flex h-10 w-full items-center justify-start gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150 ease-out',
  );

  const toggleButtonClassName = cn(
    'absolute bottom-3 left-[14px] flex h-9 w-9 items-center justify-center rounded-md border border-border/80 bg-card text-muted shadow-sm transition-[transform,background-color,color] will-change-transform hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35',
    SIDEBAR_MOTION_CLASS,
    isExpanded ? 'translate-x-48' : 'translate-x-0',
  );

  return (
    <div className={cn('relative h-full shrink-0 transition-[width] will-change-[width]', SIDEBAR_MOTION_CLASS, isFixed ? 'w-64' : 'w-16')}>
      <div
        onMouseEnter={expandAutoSidebar}
        onMouseLeave={collapseAutoSidebar}
        onFocusCapture={expandAutoSidebar}
        onBlurCapture={handleSidebarBlur}
        style={{
          clipPath: isExpanded ? 'inset(0 0 0 0)' : 'inset(0 12rem 0 0)',
        }}
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex h-full w-64 flex-col overflow-hidden border-r border-border bg-card transition-[clip-path,box-shadow] will-change-[clip-path]',
          SIDEBAR_MOTION_CLASS,
          !isFixed && isAutoExpanded && 'shadow-xl',
        )}
      >
        <div className="flex h-16 items-center border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <LateWatchMark size="sm" />
            <span className={cn('text-lg font-semibold leading-tight', labelClassName)}>
              LateWatch
            </span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
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
        <div className="space-y-2 border-t border-border px-2 pb-16 pt-3">
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
        </div>
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={toggleSidebarMode}
          className={toggleButtonClassName}
        >
          {isFixed ? (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          )}
        </button>
      </div>
    </div>
  );
}
