/**
 * @file notificationsStore.ts
 * @description 通知列表 + unreadCount 派生；markRead 乐观更新列表
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { Notification } from '../api/notifications';
import { listNotifications, markNotificationRead } from '../api/notifications';

interface NotificationsState {
  items: Notification[];
  loading: boolean;
  error: string | null;
  unreadCount: number;
  load: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  clear: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  unreadCount: 0,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await listNotifications();
      const unread = list.filter((n) => !n.read).length;
      set({ items: list, unreadCount: unread, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  markRead: async (id) => {
    await markNotificationRead(id);
    const items = get().items.map((n) => (n.id === id ? { ...n, read: true } : n));
    const unread = items.filter((n) => !n.read).length;
    set({ items, unreadCount: unread });
  },

  clear: () => set({ items: [], unreadCount: 0, loading: false, error: null }),
}));
