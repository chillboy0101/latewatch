'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReminderToast {
  body: string;
  id: number;
  tag: string;
  title: string;
  url: string;
}

const AUTO_DISMISS_MS = 12000;
const MAX_VISIBLE = 3;

/**
 * Renders reminder pushes in-app. Two paths:
 *  1. Live: the service worker mirrors a push to open tabs while the app is
 *     focused (`latewatch-push-reminder`).
 *  2. On open/focus: reads notifications the service worker already displayed
 *     (getNotifications) and shows them in-app, then closes the OS copy — so a
 *     reminder that arrived while the app was closed appears when it is reopened.
 * Mounted app-wide in the root layout.
 */
export function PushReminderToast() {
  const [toasts, setToasts] = useState<ReminderToast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((input: { body: string; tag: string; title: string; url: string }) => {
    const id = Date.now() + Math.random();
    setToasts((current) => {
      if (input.tag && current.some((toast) => toast.tag === input.tag)) return current;
      return [{ id, ...input }, ...current].slice(0, MAX_VISIBLE);
    });
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'latewatch-push-reminder') return;
      addToast({
        body: String(data.body || 'Open LateWatch to update your attendance.'),
        tag: String(data.tag || ''),
        title: String(data.title || 'LateWatch reminder'),
        url: String(data.url || '/check-in'),
      });
    };

    const syncFromDisplayedNotifications = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const notifications = await registration.getNotifications();
        for (const notification of notifications) {
          const notificationData = notification.data as { reminderType?: string; url?: string } | null;
          if (!notificationData || notificationData.reminderType == null) continue;
          addToast({
            body: notification.body || 'Open LateWatch to update your attendance.',
            tag: notification.tag || '',
            title: notification.title || 'LateWatch reminder',
            url: notificationData.url || '/check-in',
          });
          notification.close();
        }
      } catch {
        // Notifications API can be unavailable; ignore.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void syncFromDisplayedNotifications();
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    void syncFromDisplayedNotifications();

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border border-primary/30',
            'bg-gradient-to-br from-primary/12 via-card to-card shadow-lg',
          )}
          role="status"
        >
          <div className="flex items-start gap-3 p-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{toast.title}</p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{toast.body}</p>
              <Link
                href={toast.url}
                onClick={() => dismiss(toast.id)}
                className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline"
              >
                Open
              </Link>
            </div>
            <button
              type="button"
              aria-label="Dismiss reminder"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
