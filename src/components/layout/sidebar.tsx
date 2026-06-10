// components/layout/sidebar.tsx
'use client';

import { type FocusEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LateWatchMark } from '@/components/brand/latewatch-logo';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
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
  HandCoins,
  type LucideIcon,
} from 'lucide-react';

type SidebarMode = 'auto' | 'fixed';
type NavigationChild = { name: string; href: string };
type NavigationLink = NavigationChild & { icon: LucideIcon };
type NavigationGroup = { name: string; icon: LucideIcon; children: NavigationChild[] };
type NavigationItem = NavigationLink | NavigationGroup;

const SIDEBAR_MODE_STORAGE_KEY = 'latewatch-sidebar-mode';
const ATTENDANCE_NAV_ID = 'sidebar-attendance-subnav';
const SIDEBAR_MOTION_CLASS = 'duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';
const SIDEBAR_LABEL_MOTION_CLASS = 'duration-200 ease-out motion-reduce:transition-none';
let rememberedAutoExpanded = false;

const attendanceChildren = [
  { name: 'Overview', href: '/attendance' },
  { name: 'Reminders', href: '/attendance/reminders' },
  { name: 'Devices', href: '/attendance/devices' },
  { name: 'Security Alerts', href: '/attendance/security-alerts' },
];

const navigation: NavigationItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Staff', href: '/staff', icon: Users },
  { name: 'Emergency', href: '/emergency-contacts', icon: PhoneCall },
  { name: 'Attendance', icon: ClipboardCheck, children: attendanceChildren },
  { name: 'Location', href: '/location', icon: MapPin },
  { name: 'Entries', href: '/entries', icon: Table2 },
  { name: 'Exports', href: '/exports', icon: Download },
  { name: 'Payments', href: '/payments', icon: ReceiptText },
  { name: 'Contributions', href: '/contributions', icon: HandCoins },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Audit Trail', href: '/audit-trail', icon: Shield },
];

const navigationLeaves = navigation.flatMap((item) => ('children' in item ? item.children : [item]));

function isSidebarMode(value: string | null): value is SidebarMode {
  return value === 'auto' || value === 'fixed';
}

export function Sidebar() {
  const pathname = usePathname();
  const activeNavigation = navigationLeaves
    .filter((item) => pathname === item.href || pathname?.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const attendanceSectionActive = attendanceChildren.some((item) => activeNavigation?.href === item.href);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('auto');
  const [isAutoExpanded, setIsAutoExpanded] = useState(() => rememberedAutoExpanded);
  const [attendanceDisclosureOpen, setAttendanceDisclosureOpen] = useState(() => attendanceSectionActive);
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

  useEffect(() => {
    if (!isExpanded) {
      setAttendanceDisclosureOpen(false);
      return;
    }

    if (attendanceSectionActive) setAttendanceDisclosureOpen(true);
  }, [attendanceSectionActive, isExpanded]);

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

  function toggleAttendanceDisclosure() {
    setAttendanceDisclosureOpen((open) => !open);
  }

  const labelClassName = cn(
    'min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,width]',
    SIDEBAR_LABEL_MOTION_CLASS,
    isExpanded
      ? 'w-auto opacity-100'
      : 'pointer-events-none w-0 opacity-0',
  );

  const itemClassName = cn(
    'flex h-10 items-center rounded-md text-sm font-medium transition-colors duration-150 ease-out',
    isExpanded ? 'w-full justify-start' : 'w-12 justify-start',
  );

  const itemIconClassName = 'flex h-10 w-12 shrink-0 items-center justify-center';
  const activeItemClassName = 'bg-primary text-primary-foreground';
  const inactiveItemClassName = 'text-muted hover:bg-background hover:text-foreground';

  const toggleButtonClassName = cn(
    'absolute bottom-3 left-[14px] z-20 flex h-9 w-9 items-center justify-center rounded-md border border-border/80 bg-card text-muted shadow-sm transition-[transform,background-color,color] will-change-transform hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35',
    SIDEBAR_MOTION_CLASS,
    isExpanded ? 'translate-x-48' : 'translate-x-0',
  );

  return (
    <div
      className={cn(
        'relative h-full shrink-0 border-border transition-[width] will-change-[width]',
        SIDEBAR_MOTION_CLASS,
        isFixed ? 'w-64' : 'w-16',
        !isExpanded && 'border-r border-border',
      )}
    >
      <div
        onMouseEnter={expandAutoSidebar}
        onMouseLeave={collapseAutoSidebar}
        onFocusCapture={expandAutoSidebar}
        onBlurCapture={handleSidebarBlur}
        style={{
          clipPath: isExpanded ? 'inset(0 0 0 0)' : 'inset(0 12rem 0 0)',
        }}
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex h-full w-64 flex-col overflow-hidden bg-card transition-[clip-path,box-shadow] will-change-[clip-path]',
          SIDEBAR_MOTION_CLASS,
          isExpanded && 'border-r border-border',
          !isFixed && isAutoExpanded && 'shadow-xl',
        )}
      >
        <div className="flex h-16 shrink-0 items-center px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <LateWatchMark size="sm" />
            <span className={cn('text-lg font-semibold leading-tight', labelClassName)}>
              LateWatch
            </span>
          </div>
        </div>
        <nav
          aria-label="Admin navigation"
          className="sidebar-nav-scroll min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-3"
        >
          <ul className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;

              if ('children' in item) {
                const showChildren = isExpanded && attendanceDisclosureOpen;
                const attendanceParentActive = attendanceSectionActive && !isExpanded;
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      aria-controls={ATTENDANCE_NAV_ID}
                      aria-expanded={showChildren}
                      aria-label={item.name}
                      title={item.name}
                      onClick={toggleAttendanceDisclosure}
                      className={cn(
                        itemClassName,
                        'border-0 p-0 text-left',
                        attendanceParentActive ? activeItemClassName : inactiveItemClassName,
                      )}
                    >
                      <span className={itemIconClassName} aria-hidden="true">
                        <Icon className="h-5 w-5 shrink-0" />
                      </span>
                      <span className={cn(labelClassName, isExpanded && 'flex-1')}>{item.name}</span>
                      <ChevronDown
                        className={cn(
                          'h-4 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
                          showChildren && 'rotate-180',
                          isExpanded ? 'ml-auto mr-3 w-4 opacity-70' : 'm-0 w-0 opacity-0',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    <div
                      id={ATTENDANCE_NAV_ID}
                      aria-hidden={!showChildren}
                      className={cn(
                        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
                        showChildren ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                        !isExpanded && 'hidden',
                      )}
                    >
                      <ul className={cn('min-h-0 space-y-1 overflow-hidden', showChildren && 'pt-1')}>
                        {item.children.map((child) => {
                          const isChildActive = activeNavigation?.href === child.href;
                          return (
                            <li key={child.name}>
                              <Link
                                href={child.href}
                                aria-current={isChildActive ? 'page' : undefined}
                                aria-label={child.name}
                                title={child.name}
                                tabIndex={showChildren ? undefined : -1}
                                className={cn(
                                  itemClassName,
                                  'pl-12',
                                  isChildActive ? activeItemClassName : inactiveItemClassName,
                                )}
                              >
                                <span className={labelClassName}>{child.name}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </li>
                );
              }

              const isActive = activeNavigation?.href === item.href;
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.name}
                    title={item.name}
                    className={cn(
                      itemClassName,
                      isActive ? activeItemClassName : inactiveItemClassName,
                    )}
                  >
                    <span className={itemIconClassName} aria-hidden="true">
                      <Icon className="h-5 w-5 shrink-0" />
                    </span>
                    <span className={labelClassName}>{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="relative z-10 shrink-0 space-y-2 border-t border-border bg-card px-2 pb-14 pt-3">
          <Link
            href="/"
            aria-label="Main Portal"
            title="Main Portal"
            className={cn(
              itemClassName,
              'text-muted hover:bg-background hover:text-foreground',
            )}
          >
            <span className={itemIconClassName} aria-hidden="true">
              <Home className="h-5 w-5 shrink-0" />
            </span>
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
