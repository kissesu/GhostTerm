/**
 * @file notificationsStore.ts
 * @description 通知系统 Zustand store（Phase 12）。
 *
 *              数据形状：notifications: Notification[]，按 createdAt DESC
 *              对外暴露 unreadCount derived getter（同步计算 isRead=false 数量）
 *
 *              Action 列表：
 *                - load()                    REST 拉取（首次进入 / 刷新）
 *                - pushNotification(notif)   WS 接到推送时调用 → prepend 到列表头
 *                - markRead(id)              单条标读（乐观更新 + 调后端，失败回滚）
 *                - markAllRead()             全部标读
 *                - clear()                   登出 / 切用户清空
 *
 *              memory rule (`feedback_react19_zustand5_selector_stable_ref`)：
 *              选择器返回数组直接引用，组件用 useMemo 做 filter/sort 派生，
 *              不在 selector 内 .filter()，否则每次渲染创建新数组导致死循环。
 *
 *              错误处理：
 *              - load 失败 → 记 error 字段；UI 自行决定是否重试
 *              - markRead 失败 → 回滚 isRead 状态（UX 一致：让用户看到操作未生效）
 *              - 不做静默吞错 / 自动重试（v2 part5 §NC2）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import {
  listNotifications as apiList,
  markAllNotificationsRead as apiMarkAll,
  markNotificationRead as apiMarkRead,
  type Notification,
} from '../api/notifications';
import { ProgressApiError } from '../api/client';

interface NotificationsState {
  /** 当前用户最近通知列表（按 createdAt DESC） */
  notifications: Notification[];

  /** 当前是否在拉取（UI 展示 loading 占位） */
  loading: boolean;

  /** 最近一次操作的错误消息 */
  error: string | null;

  // ============ actions ============

  /** 拉取最近通知，写入 notifications 字段 */
  load: () => Promise<void>;

  /** WS 推送到达时调用：把新通知 prepend 到列表头部 */
  pushNotification: (notification: Notification) => void;

  /** 单条标读：乐观更新 + 调后端，失败回滚 */
  markRead: (notificationId: number) => Promise<void>;

  /** 全部标读：乐观更新 + 调后端，失败回滚 */
  markAllRead: () => Promise<void>;

  /** 同步选择器：未读数（基于 notifications 同步计算） */
  getUnreadCount: () => number;

  /** 清空所有缓存（登出 / 切用户调用） */
  clear: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  loading: false,
  error: null,

  // ----------------------------------------------------------
  // load
  // ----------------------------------------------------------
  async load() {
    set({ loading: true, error: null });
    try {
      const list = await apiList(false);
      set({ notifications: list, loading: false });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
    }
  },

  // ----------------------------------------------------------
  // pushNotification（WS 推送入口）
  // ----------------------------------------------------------
  pushNotification(notification) {
    set((state) => {
      // 去重：若已有同 id 通知则忽略（防止 outbox 重发）
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }
      // prepend：最新通知在最上方
      return { notifications: [notification, ...state.notifications] };
    });
  },

  // ----------------------------------------------------------
  // markRead（乐观更新 + 调后端）
  // ----------------------------------------------------------
  async markRead(notificationId) {
    const prev = get().notifications;
    // 乐观更新：立即标 isRead=true + readAt=now
    const nowIso = new Date().toISOString();
    set({
      notifications: prev.map((n) =>
        n.id === notificationId ? { ...n, isRead: true, readAt: nowIso } : n,
      ),
    });

    try {
      await apiMarkRead(notificationId);
    } catch (err) {
      // 失败回滚到之前状态
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ notifications: prev, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // markAllRead
  // ----------------------------------------------------------
  async markAllRead() {
    const prev = get().notifications;
    const nowIso = new Date().toISOString();
    set({
      notifications: prev.map((n) =>
        n.isRead ? n : { ...n, isRead: true, readAt: nowIso },
      ),
    });

    try {
      await apiMarkAll();
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ notifications: prev, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // getUnreadCount —— 派生量同步计算
  // 备注：不做 useMemo 缓存，因为 zustand selector 已是 referential 比较
  // ----------------------------------------------------------
  getUnreadCount() {
    return get().notifications.filter((n) => !n.isRead).length;
  },

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  clear() {
    set({ notifications: [], loading: false, error: null });
  },
}));
