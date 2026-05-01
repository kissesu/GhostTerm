/**
 * @file NotificationsCenterView.test.tsx
 * @description NotificationsCenterView 单测：渲染列表 / 点击 markRead + 跳详情
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsCenterView } from '../NotificationsCenterView';
import type { Notification } from '../../api/notifications';

function makeNotification(id: number, projectId: number | null, isRead: boolean): Notification {
  return {
    id,
    userId: 1,
    type: 'new_feedback',
    projectId,
    title: `通知${id}`,
    body: `内容${id}`,
    isRead,
    createdAt: '2026-05-01T10:00:00Z',
  };
}

const mockLoad = vi.fn();
const mockMarkRead = vi.fn().mockResolvedValue(undefined);
const mockOpenProjectFromView = vi.fn();

const mockItems = [
  makeNotification(1, 10, false),
  makeNotification(2, null, true),
];

vi.mock('../../stores/notificationsStore', () => ({
  useNotificationsStore: (selector: (s: object) => unknown) =>
    selector({ items: mockItems, load: mockLoad, markRead: mockMarkRead }),
}));

vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({ openProjectFromView: mockOpenProjectFromView }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsCenterView', () => {
  it('渲染通知列表标题', () => {
    render(<NotificationsCenterView />);
    expect(screen.getByText('通知1')).toBeInTheDocument();
    expect(screen.getByText('通知2')).toBeInTheDocument();
  });

  it('点击有 projectId 的通知 → markRead + openProjectFromView', async () => {
    render(<NotificationsCenterView />);
    const item = document.querySelector('[data-notification-id="1"]') as HTMLElement;
    await userEvent.click(item);
    expect(mockMarkRead).toHaveBeenCalledWith(1);
    expect(mockOpenProjectFromView).toHaveBeenCalledWith(10, 'notifications');
  });

  it('点击无 projectId 的通知 → 只 markRead，不 openProject', async () => {
    render(<NotificationsCenterView />);
    const item = document.querySelector('[data-notification-id="2"]') as HTMLElement;
    await userEvent.click(item);
    expect(mockMarkRead).toHaveBeenCalledWith(2);
    expect(mockOpenProjectFromView).not.toHaveBeenCalled();
  });

  it('mount 后调用 load', () => {
    render(<NotificationsCenterView />);
    expect(mockLoad).toHaveBeenCalledOnce();
  });
});
