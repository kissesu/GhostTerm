/**
 * @file notificationsStore.test.ts
 * @description Phase 12 notificationsStore 单测：
 *               - load 成功 / 失败
 *               - pushNotification append + 去重
 *               - markRead 乐观更新 + 失败回滚
 *               - markAllRead
 *               - getUnreadCount 派生计算
 *               - clear
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// mock api 模块
// ============================================
vi.mock('../../api/notifications', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  ProgressApiError: class extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: unknown;
    constructor(status: number, code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'ProgressApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  getBaseUrl: () => 'http://test',
}));

import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '../../api/notifications';
import { ProgressApiError } from '../../api/client';
import { useNotificationsStore } from '../notificationsStore';

const mockedList = vi.mocked(listNotifications);
const mockedMarkRead = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);

const sampleNotif = (id: number, overrides: Partial<Notification> = {}): Notification => ({
  id,
  userId: 1,
  type: 'ball_passed',
  projectId: 100,
  title: `notif ${id}`,
  body: `body ${id}`,
  isRead: false,
  createdAt: `2026-04-29T${String(10 + id).padStart(2, '0')}:00:00Z`,
  readAt: null,
  ...overrides,
});

beforeEach(() => {
  useNotificationsStore.getState().clear();
  mockedList.mockReset();
  mockedMarkRead.mockReset();
  mockedMarkAll.mockReset();
});

// ============================================
// load
// ============================================
describe('notificationsStore.load', () => {
  it('成功加载后写入 notifications 并清 loading', async () => {
    const items = [sampleNotif(1), sampleNotif(2)];
    mockedList.mockResolvedValueOnce(items);

    await useNotificationsStore.getState().load();

    const state = useNotificationsStore.getState();
    expect(state.notifications).toEqual(items);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('load 失败时记 error，loading 复位', async () => {
    const apiErr = new ProgressApiError(500, 'internal', '后端炸了');
    mockedList.mockRejectedValueOnce(apiErr);

    await useNotificationsStore.getState().load();

    const state = useNotificationsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('后端炸了');
  });
});

// ============================================
// pushNotification
// ============================================
describe('notificationsStore.pushNotification', () => {
  it('prepend 到列表头部', () => {
    useNotificationsStore.setState({ notifications: [sampleNotif(1)] });

    useNotificationsStore.getState().pushNotification(sampleNotif(2));

    const list = useNotificationsStore.getState().notifications;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(2);
    expect(list[1].id).toBe(1);
  });

  it('同 id 通知去重（防止 outbox 重发）', () => {
    useNotificationsStore.setState({ notifications: [sampleNotif(1)] });

    useNotificationsStore.getState().pushNotification(sampleNotif(1));

    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });
});

// ============================================
// markRead
// ============================================
describe('notificationsStore.markRead', () => {
  it('乐观更新：立即 isRead=true，readAt 非空', async () => {
    useNotificationsStore.setState({
      notifications: [sampleNotif(1, { isRead: false })],
    });
    mockedMarkRead.mockResolvedValueOnce();

    await useNotificationsStore.getState().markRead(1);

    const list = useNotificationsStore.getState().notifications;
    expect(list[0].isRead).toBe(true);
    expect(list[0].readAt).not.toBeNull();
  });

  it('失败时回滚到旧状态', async () => {
    useNotificationsStore.setState({
      notifications: [sampleNotif(1, { isRead: false })],
    });
    const apiErr = new ProgressApiError(500, 'internal', 'oops');
    mockedMarkRead.mockRejectedValueOnce(apiErr);

    await expect(useNotificationsStore.getState().markRead(1)).rejects.toBe(apiErr);

    const list = useNotificationsStore.getState().notifications;
    expect(list[0].isRead).toBe(false);
    expect(list[0].readAt).toBeNull();
    expect(useNotificationsStore.getState().error).toBe('oops');
  });
});

// ============================================
// markAllRead
// ============================================
describe('notificationsStore.markAllRead', () => {
  it('所有未读项变已读', async () => {
    useNotificationsStore.setState({
      notifications: [
        sampleNotif(1, { isRead: false }),
        sampleNotif(2, { isRead: true }),
        sampleNotif(3, { isRead: false }),
      ],
    });
    mockedMarkAll.mockResolvedValueOnce();

    await useNotificationsStore.getState().markAllRead();

    const list = useNotificationsStore.getState().notifications;
    expect(list.every((n) => n.isRead)).toBe(true);
  });
});

// ============================================
// getUnreadCount —— 派生计算
// ============================================
describe('notificationsStore.getUnreadCount', () => {
  it('未读数等于 isRead=false 的条数', () => {
    useNotificationsStore.setState({
      notifications: [
        sampleNotif(1, { isRead: false }),
        sampleNotif(2, { isRead: true }),
        sampleNotif(3, { isRead: false }),
      ],
    });

    expect(useNotificationsStore.getState().getUnreadCount()).toBe(2);
  });

  it('全已读时返回 0', () => {
    useNotificationsStore.setState({
      notifications: [
        sampleNotif(1, { isRead: true }),
        sampleNotif(2, { isRead: true }),
      ],
    });

    expect(useNotificationsStore.getState().getUnreadCount()).toBe(0);
  });

  it('空列表时返回 0', () => {
    expect(useNotificationsStore.getState().getUnreadCount()).toBe(0);
  });
});

// ============================================
// clear
// ============================================
describe('notificationsStore.clear', () => {
  it('清空 notifications 和 error', () => {
    useNotificationsStore.setState({
      notifications: [sampleNotif(1)],
      error: 'old',
    });

    useNotificationsStore.getState().clear();

    const state = useNotificationsStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.error).toBeNull();
  });
});
