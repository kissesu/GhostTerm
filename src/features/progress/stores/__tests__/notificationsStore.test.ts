/**
 * @file notificationsStore.test.ts
 * @description notificationsStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/notifications', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));

import { useNotificationsStore } from '../notificationsStore';
import { listNotifications, markNotificationRead } from '../../api/notifications';

beforeEach(() => {
  useNotificationsStore.getState().clear();
  vi.resetAllMocks();
});

describe('notificationsStore', () => {
  it('load 后 items 设值且 unreadCount 正确派生', async () => {
    const mockList = [
      { id: 1, isRead: false, content: 'msg1' } as any,
      { id: 2, isRead: true, content: 'msg2' } as any,
      { id: 3, isRead: false, content: 'msg3' } as any,
    ];
    vi.mocked(listNotifications).mockResolvedValue(mockList);
    await useNotificationsStore.getState().load();
    const s = useNotificationsStore.getState();
    expect(s.items).toHaveLength(3);
    expect(s.unreadCount).toBe(2);
    expect(s.loading).toBe(false);
  });

  it('markRead 减少 unreadCount', async () => {
    useNotificationsStore.setState({
      items: [
        { id: 1, isRead: false } as any,
        { id: 2, isRead: false } as any,
      ],
      unreadCount: 2,
    });
    vi.mocked(markNotificationRead).mockResolvedValue(undefined);
    await useNotificationsStore.getState().markRead(1);
    const s = useNotificationsStore.getState();
    expect(s.unreadCount).toBe(1);
    expect(s.items.find((n) => n.id === 1)?.isRead).toBe(true);
  });

  it('load 失败后 error 设值且 loading=false', async () => {
    vi.mocked(listNotifications).mockRejectedValue(new Error('server error'));
    await useNotificationsStore.getState().load();
    const s = useNotificationsStore.getState();
    expect(s.error).toBe('server error');
    expect(s.loading).toBe(false);
  });

  it('clear 重置所有状态', () => {
    useNotificationsStore.setState({
      items: [{ id: 1 } as any],
      unreadCount: 1,
      error: 'err',
    });
    useNotificationsStore.getState().clear();
    const s = useNotificationsStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.unreadCount).toBe(0);
    expect(s.error).toBeNull();
  });
});
