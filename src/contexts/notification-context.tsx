'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { getAblyRealtime } from '@/lib/ably-browser';

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'alert';
  entityType: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// ─── localStorage helpers ───────────────────────────────────────────────────

function getDismissedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set<string>(JSON.parse(localStorage.getItem('dismissedNotificationIds') || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>) {
  localStorage.setItem('dismissedNotificationIds', JSON.stringify(Array.from(ids)));
}

function getReadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set<string>(JSON.parse(localStorage.getItem('readNotificationIds') || '[]'));
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  localStorage.setItem('readNotificationIds', JSON.stringify(Array.from(ids)));
}

// ─── Provider ───────────────────────────────────────────────────────────────

const POLL_INTERVAL = 120_000; // 2 minutes – plenty for a dashboard app
const DEBOUNCE_MS = 3_000;    // debounce rapid Ably/SSE invalidations

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const fetchingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Core fetch ─────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const response = await fetch('/api/notifications?limit=20', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const data = await response.json();
      const nextNotifications = Array.isArray(data?.notifications) ? data.notifications : null;
      if (!nextNotifications) return;

      const readIds = getReadIds();
      const dismissedIds = getDismissedIds();

      // Filter out dismissed notifications and apply read state.
      // System notifications also respect the read/dismiss state now.
      const updated = nextNotifications
        .filter((n: Notification) => !dismissedIds.has(n.id))
        .map((n: Notification) => ({
          ...n,
          read: readIds.has(n.id),
        }));

      setNotifications(updated);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // Debounced fetch for realtime events (prevents rapid flickering)
  const debouncedFetch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchNotifications();
    }, DEBOUNCE_MS);
  }, [fetchNotifications]);

  // ─── Initialize once ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) {
      setIsInitialized(true);
      fetchNotifications();
    }
  }, [isInitialized, fetchNotifications]);

  // ─── Poll (long interval – just a safety net) ────────────────────────
  useEffect(() => {
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // ─── Realtime via Ably ────────────────────────────────────────────────
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const ably = await getAblyRealtime();
        const channel = ably.channels.get('latewatch:dashboard');
        const onInvalidate = () => debouncedFetch();
        await channel.subscribe('invalidate', onInvalidate);
        cleanup = () => {
          channel.unsubscribe('invalidate', onInvalidate);
        };
      } catch {
        // Ably not configured – rely on polling
      }
    })();

    return () => {
      cleanup?.();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [debouncedFetch]);

  // ─── Mark single notification as read ─────────────────────────────────
  const markAsRead = useCallback((id: string) => {
    const readIds = getReadIds();
    readIds.add(id);
    saveReadIds(readIds);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  // ─── Mark all as read ─────────────────────────────────────────────────
  const markAllAsRead = useCallback(() => {
    const readIds = getReadIds();
    setNotifications((prev) => {
      prev.forEach((n) => readIds.add(n.id));
      saveReadIds(readIds);
      return prev.map((n) => ({ ...n, read: true }));
    });
  }, []);

  // ─── Dismiss one notification (removes from list + persists) ──────────
  const dismissNotification = useCallback((id: string) => {
    const dismissedIds = getDismissedIds();
    dismissedIds.add(id);
    saveDismissedIds(dismissedIds);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ─── Clear all notifications ─────────────────────────────────────────
  const clearAllNotifications = useCallback(() => {
    setNotifications((prev) => {
      const dismissedIds = getDismissedIds();
      prev.forEach((n) => dismissedIds.add(n.id));
      saveDismissedIds(dismissedIds);
      return [];
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      dismissNotification,
      clearAllNotifications,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}