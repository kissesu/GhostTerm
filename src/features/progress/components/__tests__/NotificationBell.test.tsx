/**
 * @file NotificationBell.test.tsx
 * @description NotificationBell 单测：无未读 / 有未读 badge / 点击切视图 / a11y
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationBell } from '../NotificationBell';

// ============================================
// mock stores
// ============================================
const mockSetView = vi.fn();
const mockCloseProject = vi.fn();
let mockUnreadCount = 0;

vi.mock('../../stores/notificationsStore', () => ({
  useNotificationsStore: (selector: (s: object) => unknown) =>
    selector({ unreadCount: mockUnreadCount }),
}));

vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({ setCurrentView: mockSetView, closeProject: mockCloseProject }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUnreadCount = 0;
});

describe('NotificationBell', () => {
  it('unreadCount=0 时 aria-label="通知中心"，无角标', () => {
    mockUnreadCount = 0;
    render(<NotificationBell />);
    const btn = screen.getByRole('button', { name: '通知中心' });
    expect(btn).toBeInTheDocument();
    // 角标不存在（aria-hidden=true 不在 role 查询范围，用 querySelector）
    const badge = document.querySelector('span[aria-hidden="true"]');
    expect(badge).toBeNull();
  });

  it('unreadCount=5 时 aria-label="5 条未读通知" + 显示角标 "5"', () => {
    mockUnreadCount = 5;
    render(<NotificationBell />);
    const btn = screen.getByRole('button', { name: '5 条未读通知' });
    expect(btn).toBeInTheDocument();
    const badge = document.querySelector('span[aria-hidden="true"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('5');
  });

  it('unreadCount=100 时角标显示 "99+"', () => {
    mockUnreadCount = 100;
    render(<NotificationBell />);
    const badge = document.querySelector('span[aria-hidden="true"]');
    expect(badge!.textContent).toBe('99+');
  });

  it('点击 → 调 closeProject + setCurrentView("notifications")', async () => {
    mockUnreadCount = 3;
    render(<NotificationBell />);
    const btn = screen.getByRole('button');
    await userEvent.click(btn);
    expect(mockCloseProject).toHaveBeenCalledOnce();
    expect(mockSetView).toHaveBeenCalledWith('notifications');
  });

  it('点击顺序：closeProject 先于 setCurrentView', async () => {
    const callOrder: string[] = [];
    mockCloseProject.mockImplementation(() => { callOrder.push('close'); });
    mockSetView.mockImplementation(() => { callOrder.push('setView'); });

    mockUnreadCount = 0;
    render(<NotificationBell />);
    await userEvent.click(screen.getByRole('button'));
    expect(callOrder).toEqual(['close', 'setView']);
  });
});
