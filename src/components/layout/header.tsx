'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { Bell, Sun, Moon, Check, AlertTriangle, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useRef } from 'react';
import { useNotifications } from '@/contexts/notification-context';

interface HeaderProps {
  title?: string;
  userRole?: string;
}

export function Header({ title, userRole }: HeaderProps) {
  const { user, isLoaded } = useUser();
  const firstName = user?.firstName || 'User';
  const [isDark, setIsDark] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
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

  // Apply theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    } else {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-xl font-semibold">{title}</h1>}
      </div>
      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 relative"
            onClick={() => {
              setShowNotifications(!showNotifications);
              if (!showNotifications) fetchNotifications();
            }}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-primary-foreground bg-danger">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>

          {showNotifications && (
            <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border border-border bg-card shadow-lg">
              <div className="flex items-center justify-between border-b border-border p-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  {notifications.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {unreadCount > 0 ? `${unreadCount} new` : `${notifications.length} total`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="rounded px-2 py-1 text-xs text-primary hover:bg-accent transition-colors"
                    >
                      Mark all read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={() => {
                        clearAllNotifications();
                      }}
                      className="rounded px-2 py-1 text-xs text-danger hover:bg-danger/10 transition-colors flex items-center gap-1"
                      title="Clear all notifications"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear all
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No notifications
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`group flex gap-3 border-b border-border p-3 hover:bg-accent/50 transition-colors ${
                        !notif.read
                          ? notif.type === 'alert'
                            ? 'bg-danger/5'
                            : 'bg-primary/5'
                          : ''
                      }`}
                    >
                      <div
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          notif.type === 'alert'
                            ? 'bg-danger'
                            : notif.type === 'success'
                            ? 'bg-success'
                            : notif.type === 'warning'
                            ? 'bg-warning'
                            : 'bg-primary'
                        }`}
                      />
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          if (!notif.read) markAsRead(notif.id);
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {notif.type === 'alert' && <AlertTriangle className="h-3 w-3 text-danger" />}
                          <p className="text-sm font-medium">{notif.title}</p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{notif.message}</p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">{notif.time}</p>
                      </div>
                      <div className="flex items-start gap-1 shrink-0">
                        {!notif.read && (
                          <button
                            onClick={() => markAsRead(notif.id)}
                            className="p-0.5 rounded hover:bg-accent transition-colors"
                            title="Mark as read"
                          >
                            <Check className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                          </button>
                        )}
                        <button
                          onClick={() => dismissNotification(notif.id)}
                          className="p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-danger/10 transition-all"
                          title="Dismiss notification"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-danger" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-sm text-muted-foreground">
            {isLoaded ? (
              <span className="font-medium text-foreground">
                Welcome, {firstName}
              </span>
            ) : (
              <span className="w-20 h-4 bg-muted rounded animate-pulse" />
            )}
          </span>
          {userRole && isLoaded && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {userRole.toUpperCase()}
            </span>
          )}
          <div className="w-8 h-8">
            {isLoaded ? (
              <UserButton />
            ) : (
              <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}