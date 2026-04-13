// components/layout/header.tsx
'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { Bell, Sun, Moon, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useRef } from 'react';

interface HeaderProps {
  title?: string;
  userRole?: string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'info' | 'success' | 'warning';
}

export function Header({ title, userRole }: HeaderProps) {
  const { user, isLoaded } = useUser();
  const firstName = user?.firstName || 'User';
  const [isDark, setIsDark] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: '1',
      title: 'New Staff Added',
      message: 'Alice Johnson was added to the system',
      time: '2 min ago',
      read: false,
      type: 'success',
    },
    {
      id: '2',
      title: 'Weekly Export Ready',
      message: 'Your weekly report has been generated',
      time: '1 hour ago',
      read: false,
      type: 'info',
    },
    {
      id: '3',
      title: 'Holiday Reminder',
      message: 'Good Friday is upcoming on April 3, 2026',
      time: '3 hours ago',
      read: true,
      type: 'warning',
    },
  ]);
  const notifRef = useRef<HTMLDivElement>(null);

  // Check initial theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkMode = savedTheme === 'dark' || (!savedTheme && prefersDark);
    setIsDark(isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Close notifications dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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
          <Button variant="ghost" size="icon" className="h-9 w-9 relative" onClick={() => setShowNotifications(!showNotifications)}>
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>

          {showNotifications && (
            <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-card shadow-lg">
              <div className="flex items-center justify-between border-b border-border p-3">
                <h3 className="font-semibold text-sm">Notifications</h3>
                <div className="flex gap-1">
                  {notifications.length > 0 && (
                    <>
                      <button
                        onClick={markAllAsRead}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        Mark all read
                      </button>
                      <button
                        onClick={clearNotifications}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        Clear all
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No notifications
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`flex gap-3 border-b border-border p-3 ${
                        !notif.read ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          notif.type === 'success'
                            ? 'bg-success'
                            : notif.type === 'warning'
                            ? 'bg-warning'
                            : 'bg-primary'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{notif.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{notif.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{notif.time}</p>
                      </div>
                      {!notif.read && (
                        <button
                          onClick={() => markAsRead(notif.id)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Info - Stable with loading state */}
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
          {/* Clerk UserButton - wrapped to prevent flickering */}
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
