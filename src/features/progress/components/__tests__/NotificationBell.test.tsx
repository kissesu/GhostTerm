/**
 * @file NotificationBell.test.tsx
 * @description Phase 12 通知铃铛单测：
 *              - 0 未读 → 不渲染 badge
 *              - >0 未读 → badge 渲染含数字
 *              - >99 未读 → badge 显示 "99+"
 *              - 点击铃铛切换 NotificationPanel 显隐
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// notifications API mock —— NotificationPanel 内不会发请求，但 store import chain 可能触发
vi.mock('../../api/notifications', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
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
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  getBaseUrl: () => 'http://test',
}));

import { NotificationBell } from '../NotificationBell';
import { useNotificationsStore } from '../../stores/notificationsStore';
import type { Notification } from '../../api/notifications';

const sampleNotif = (id: number, isRead: boolean): Notification => ({
  id,
  userId: 1,
  type: 'ball_passed',
  projectId: 100,
  title: `notif ${id}`,
  body: 'body',
  isRead,
  createdAt: '2026-04-29T10:00:00Z',
  readAt: isRead ? '2026-04-29T10:00:00Z' : null,
});

beforeEach(() => {
  useNotificationsStore.getState().clear();
});

describe('NotificationBell badge 渲染', () => {
  it('0 未读时不渲染 badge', () => {
    useNotificationsStore.setState({
      notifications: [sampleNotif(1, true), sampleNotif(2, true)],
    });
    render(<NotificationBell />);

    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('1 未读 → badge 显示数字 1', () => {
    useNotificationsStore.setState({
      notifications: [sampleNotif(1, false), sampleNotif(2, true)],
    });
    render(<NotificationBell />);

    const badge = screen.getByTestId('notification-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('1');
  });

  it('5 未读 → badge 显示数字 5', () => {
    useNotificationsStore.setState({
      notifications: [
        sampleNotif(1, false),
        sampleNotif(2, false),
        sampleNotif(3, false),
        sampleNotif(4, false),
        sampleNotif(5, false),
      ],
    });
    render(<NotificationBell />);

    expect(screen.getByTestId('notification-badge').textContent).toBe('5');
  });

  it('100+ 未读 → badge 显示 "99+"', () => {
    const many = Array.from({ length: 105 }, (_, i) => sampleNotif(i + 1, false));
    useNotificationsStore.setState({ notifications: many });
    render(<NotificationBell />);

    expect(screen.getByTestId('notification-badge').textContent).toBe('99+');
  });
});

describe('NotificationBell 切到通知中心 view', () => {
  // 用户需求修正 2026-04-30：原 dropdown 升级为切到 currentView='notifications' 全屏页
  it('点击铃铛切换 currentView 为 notifications', async () => {
    const { useProgressUiStore } = await import('../../stores/progressUiStore');
    useProgressUiStore.setState({ currentView: 'kanban', selectedProjectId: 42 });
    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));
    expect(useProgressUiStore.getState().currentView).toBe('notifications');
    // 同时清除可能打开的详情页（避免遮挡通知中心）
    expect(useProgressUiStore.getState().selectedProjectId).toBeNull();
  });
});
