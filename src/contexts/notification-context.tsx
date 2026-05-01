'use client';

import { useAuth } from '@clerk/nextjs';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { subscribeRealtimeChannel, type RealtimeStatus } from '@/lib/realtime-client';

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'alert';
  priority: 'low' | 'normal' | 'high' | 'critical';
  category: 'audit' | 'attendance' | 'calendar' | 'exports' | 'staff' | 'system';
  entityType: string;
  entityId: string;
  entityLabel: string;
  action: string;
  actionLabel: string;
  actorEmail: string;
  createdAt: string;
  href: string;
}

interface NotificationContextType {
  actionRequiredCount: number;
  fetchNotifications: () => Promise<Notification[]>;
  lastUpdatedAt: Date | null;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: (ids?: string[]) => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  notifications: Notification[];
  realtimeStatus: RealtimeStatus;
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const POLL_INTERVAL = 60_000;
const DEBOUNCE_MS = 1_000;

async function persistNotificationState(action: string, ids: string[]) {
  if (ids.length === 0) return;

  const response = await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ids }),
  });

  if (!response.ok) {
    throw new Error(`Notification update failed: ${response.status}`);
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const notificationsRef = useRef<Notification[]>([]);
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetNotificationState = useCallback(() => {
    notificationsRef.current = [];
    setNotifications([]);
    setLastUpdatedAt(null);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!isLoaded) return notificationsRef.current;

    if (!isSignedIn) {
      resetNotificationState();
      setRealtimeStatus('offline');
      return [];
    }

    if (fetchingRef.current) return notificationsRef.current;
    fetchingRef.current = true;

    try {
      const response = await fetch('/api/notifications?limit=50', { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (response.status === 401 || !contentType.includes('application/json')) {
        resetNotificationState();
        return [];
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const data = await response.json();
      const nextNotifications = Array.isArray(data?.notifications) ? data.notifications as Notification[] : [];
      notificationsRef.current = nextNotifications;
      setNotifications(nextNotifications);
      setLastUpdatedAt(data?.generatedAt ? new Date(data.generatedAt) : new Date());
      return nextNotifications;
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      return notificationsRef.current;
    } finally {
      fetchingRef.current = false;
    }
  }, [isLoaded, isSignedIn, resetNotificationState]);

  const debouncedFetch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchNotifications();
    }, DEBOUNCE_MS);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      resetNotificationState();
      setRealtimeStatus('offline');
      return;
    }

    fetchNotifications();
  }, [fetchNotifications, isLoaded, isSignedIn, resetNotificationState]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };

    const handleFocus = () => fetchNotifications();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchNotifications, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setRealtimeStatus('offline');
      return;
    }

    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'notifications',
        events: ['invalidate'],
        onEvent: debouncedFetch,
        onStatus: setRealtimeStatus,
      });

      if (mounted) {
        cleanup = unsubscribe;
      } else {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      cleanup?.();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [debouncedFetch, isLoaded, isSignedIn]);

  const markAsRead = useCallback(async (id: string) => {
    if (pendingReadIdsRef.current.has(id)) return;
    pendingReadIdsRef.current.add(id);

    setNotifications((prev) => {
      const next = prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      );
      notificationsRef.current = next;
      return next;
    });

    try {
      await persistNotificationState('mark_read', [id]);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      fetchNotifications();
    } finally {
      pendingReadIdsRef.current.delete(id);
    }
  }, [fetchNotifications]);

  const markAllAsRead = useCallback(async (ids?: string[]) => {
    const unreadIds = Array.from(new Set(
      ids && ids.length > 0
        ? ids
        : notificationsRef.current.filter((notification) => !notification.read).map((notification) => notification.id)
    )).filter((id) => !pendingReadIdsRef.current.has(id));
    if (unreadIds.length === 0) return;
    const unreadIdSet = new Set(unreadIds);
    unreadIds.forEach((id) => pendingReadIdsRef.current.add(id));

    setNotifications((prev) => {
      const next = prev.map((notification) =>
        unreadIdSet.has(notification.id) ? { ...notification, read: true } : notification
      );
      notificationsRef.current = next;
      return next;
    });

    try {
      await persistNotificationState('mark_all_read', unreadIds);
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      fetchNotifications();
    } finally {
      unreadIds.forEach((id) => pendingReadIdsRef.current.delete(id));
    }
  }, [fetchNotifications]);

  const dismissNotification = useCallback(async (id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((notification) => notification.id !== id);
      notificationsRef.current = next;
      return next;
    });

    try {
      await persistNotificationState('dismiss', [id]);
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const clearAllNotifications = useCallback(async () => {
    const ids = notificationsRef.current.map((notification) => notification.id);
    if (ids.length === 0) return;

    notificationsRef.current = [];
    setNotifications([]);

    try {
      await persistNotificationState('clear_all', ids);
    } catch (error) {
      console.error('Failed to clear notifications:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const value = useMemo(() => {
    const unreadCount = notifications.filter((notification) => !notification.read).length;
    const actionRequiredCount = notifications.filter((notification) =>
      notification.priority === 'critical' || notification.type === 'alert'
    ).length;

    return {
      actionRequiredCount,
      fetchNotifications,
      lastUpdatedAt,
      markAsRead,
      markAllAsRead,
      dismissNotification,
      clearAllNotifications,
      notifications,
      realtimeStatus,
      unreadCount,
    };
  }, [
    clearAllNotifications,
    dismissNotification,
    fetchNotifications,
    lastUpdatedAt,
    markAllAsRead,
    markAsRead,
    notifications,
    realtimeStatus,
  ]);

  return (
    <NotificationContext.Provider value={value}>
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
