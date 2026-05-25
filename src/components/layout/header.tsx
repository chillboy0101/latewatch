'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import {
  AlertTriangle,
  Bell,
  Inbox,
  Loader2,
  Moon,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { useNotifications, type Notification } from '@/contexts/notification-context';
import { applyThemePreference, getIsDarkTheme, subscribeThemeChange } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface HeaderProps {
  title?: string;
  userRole?: string;
}

function getTypeSurfaceClass(type: Notification['type']) {
  switch (type) {
    case 'alert':
      return 'bg-danger/10 text-danger';
    case 'success':
      return 'bg-success/10 text-success';
    case 'warning':
      return 'bg-warning/10 text-warning';
    default:
      return 'bg-primary/10 text-primary';
  }
}

function formatNotificationClockTime(createdAt: string, fallback: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return fallback;

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Header({ title, userRole }: HeaderProps) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const firstName = user?.firstName || 'User';
  const isDark = useSyncExternalStore(subscribeThemeChange, getIsDarkTheme, () => true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAllNotifications,
  } = useNotifications();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const toggleTheme = () => {
    applyThemePreference(isDark ? 'light' : 'dark');
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showNotifications) return;

    const unreadIds = notifications
      .filter((notification) => !notification.read)
      .map((notification) => notification.id);

    if (unreadIds.length > 0) {
      void markAllAsRead(unreadIds);
    }
  }, [markAllAsRead, notifications, showNotifications]);

  function toggleNotifications() {
    const opening = !showNotifications;
    setShowNotifications(opening);

    if (opening) {
      void fetchNotifications();
    }
  }

  function openNotification(notification: Notification) {
    if (!notification.read) void markAsRead(notification.id);
    setShowNotifications(false);
    router.push(notification.href || '/audit-trail');
  }

  async function handleClearAllNotifications() {
    if (notifications.length === 0 || clearingAll) return;

    setClearingAll(true);
    try {
      await clearAllNotifications();
    } finally {
      setClearingAll(false);
    }
  }

  async function handleDismissNotification(id: string) {
    if (dismissingId) return;

    setDismissingId(id);
    try {
      await dismissNotification(id);
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <header className="flex h-16 items-center justify-between bg-card px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-xl font-semibold">{title}</h1>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : 'Open notifications'}
            className="relative h-9 w-9"
            title="Open notifications"
            onClick={toggleNotifications}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-card">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>

          {showNotifications && (
            <div className="absolute right-0 top-full z-50 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold tracking-tight">Notifications</h3>
                    <span
                      key={notifications.length}
                      className="notification-count-pop text-sm font-semibold text-primary"
                    >
                      ({notifications.length})
                    </span>
                  </div>
                </div>
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 px-2 text-xs text-muted-foreground hover:text-danger"
                    onClick={() => { void handleClearAllNotifications(); }}
                    disabled={clearingAll}
                  >
                    {clearingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Clear all
                  </Button>
                )}
              </div>

              <div className="max-h-[28rem] overflow-y-auto py-1">
                {notifications.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                    <Inbox className="mx-auto mb-3 h-8 w-8 opacity-30" />
                    <p className="font-medium text-foreground">You&apos;re all caught up</p>
                    <p className="mt-1 text-xs">New activity will appear here.</p>
                  </div>
                ) : (
                  notifications.map((notification) => {
                    const isUrgent = notification.priority === 'critical' || notification.type === 'alert';
                    const isDismissing = dismissingId === notification.id;

                    return (
                    <div
                      key={notification.id}
                      className={cn(
                        'group flex gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/50',
                        !notification.read && 'bg-primary/5',
                        isUrgent && !notification.read && 'bg-danger/5',
                      )}
                    >
                      <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', getTypeSurfaceClass(notification.type))}>
                        {notification.type === 'alert' ? <AlertTriangle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      </div>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left outline-none"
                        onClick={() => openNotification(notification)}
                      >
                        <div className="flex items-center gap-2">
                          <p className={cn('truncate text-sm', notification.read ? 'font-medium' : 'font-semibold')}>
                            {notification.title}
                          </p>
                          {!notification.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{notification.message}</p>
                        <time
                          dateTime={notification.createdAt}
                          className="mt-2 block text-[11px] font-medium text-muted-foreground"
                        >
                          {formatNotificationClockTime(notification.createdAt, notification.time)}
                        </time>
                      </button>
                      <button
                        onClick={() => { void handleDismissNotification(notification.id); }}
                        type="button"
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-all hover:bg-danger/10 hover:text-danger hover:opacity-100 disabled:pointer-events-none disabled:opacity-50"
                        title="Clear notification"
                        disabled={isDismissing}
                      >
                        {isDismissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {isLoaded ? (
              <span className="font-medium text-foreground">
                Welcome, {firstName}
              </span>
            ) : (
              <span className="h-4 w-20 rounded bg-muted animate-pulse" />
            )}
          </span>
          {userRole && isLoaded && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {userRole.toUpperCase()}
            </span>
          )}
          <div className="h-8 w-8">
            {isLoaded ? (
              <UserButton />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
