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
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const fetchingRef = useRef(false);

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
      if (!nextNotifications) {
        return;
      }

      const readIdsRaw = typeof window !== 'undefined'
        ? localStorage.getItem('readNotificationIds') || '[]'
        : '[]';
      const readIds = new Set<string>(JSON.parse(readIdsRaw));

      const updated = nextNotifications.map((n: Notification) => ({
        ...n,
        read: readIds.has(n.id) && n.entityType !== 'system',
      }));

      setNotifications(updated);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // Initialize notifications once
  useEffect(() => {
    if (!isInitialized) {
      setIsInitialized(true);
      fetchNotifications();
    }
  }, [isInitialized, fetchNotifications]);

  // Poll every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Realtime refresh via Ably (Vercel-safe). Falls back to polling if Ably isn't configured.
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const ably = await getAblyRealtime();
        const channel = ably.channels.get('latewatch:dashboard');
        const onInvalidate = () => fetchNotifications();
        await channel.subscribe('invalidate', onInvalidate);
        cleanup = () => {
          channel.unsubscribe('invalidate', onInvalidate);
        };
      } catch {
        // ignore
      }
    })();

    return () => cleanup?.();
  }, [fetchNotifications]);

  const markAsRead = useCallback((id: string) => {
    const notif = notifications.find((n) => n.id === id);
    if (notif?.entityType === 'system') {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      return;
    }

    const readIds = new Set<string>(JSON.parse(localStorage.getItem('readNotificationIds') || '[]'));
    readIds.add(id);
    localStorage.setItem('readNotificationIds', JSON.stringify(Array.from(readIds)));
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, [notifications]);

  const markAllAsRead = useCallback(() => {
    const nonSystemIds = notifications.filter((n) => n.entityType !== 'system').map((n) => n.id);
    const existingIds = new Set<string>(JSON.parse(localStorage.getItem('readNotificationIds') || '[]'));
    nonSystemIds.forEach(id => existingIds.add(id));
    localStorage.setItem('readNotificationIds', JSON.stringify(Array.from(existingIds)));
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, fetchNotifications, markAsRead, markAllAsRead }}>
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