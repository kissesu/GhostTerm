/**
 * @file NotificationsCenterView.tsx
 * @description 通知中心全屏视图（用户需求修正 2026-04-30）。
 *
 *              业务背景：原 dropdown 形态被升级为独立 view，作为 progressUiStore.currentView='notifications'
 *              的主区渲染，让用户期望的"通知中心页面"成型。
 *
 *              交互：
 *               - 顶部"返回"按钮 → 切回 priorView 或默认 'kanban'
 *               - 列表全部通知（不再截 20 条）
 *               - 点击 item：markRead + setCurrentView 保持 'notifications' + openProjectFromView 进详情，
 *                 详情页 handleBack 检测 priorView=notifications 时回到通知中心
 *               - 全部已读按钮
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { ArrowLeft, CheckCheck } from 'lucide-react';

import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import type { Notification } from '../api/notifications';

function truncateBody(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsCenterView() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  const hasUnread = notifications.some((n) => !n.isRead);

  const handleBack = () => {
    // 用户从顶栏铃铛进入；返回默认到看板（用户的常驻视图）
    setCurrentView('kanban');
  };

  const handleItemClick = (n: Notification) => {
    if (!n.isRead) {
      void markRead(n.id);
    }
    if (n.projectId !== null && n.projectId !== undefined) {
      // 进项目详情但记录 priorView=notifications，让 handleBack 智能回到这里
      openProjectFromView(n.projectId, 'notifications');
    }
  };

  return (
    <div
      data-testid="notifications-center-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'transparent',
        color: 'var(--text)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 20px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bar)',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            data-testid="notifications-back"
            onClick={handleBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            <ArrowLeft size={12} aria-hidden="true" /> 返回看板
          </button>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>通知中心</h2>
          <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 500 }}>
            共 {notifications.length} 条 · {notifications.filter((n) => !n.isRead).length} 条未读
          </span>
        </div>
        {hasUnread && (
          <button
            type="button"
            data-testid="notifications-mark-all-read"
            onClick={() => void markAllRead()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            <CheckCheck size={12} aria-hidden="true" /> 全部已读
          </button>
        )}
      </header>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {notifications.length === 0 && (
          <div
            data-testid="notifications-empty"
            style={{
              padding: '64px 20px',
              textAlign: 'center',
              color: 'var(--faint)',
              fontSize: 13,
            }}
          >
            暂无通知
          </div>
        )}
        {notifications.map((n) => (
          <button
            key={n.id}
            type="button"
            data-testid={`notification-item-${n.id}`}
            data-unread={!n.isRead ? 'true' : 'false'}
            onClick={() => handleItemClick(n)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '14px 20px',
              border: 'none',
              borderBottom: '1px solid var(--line)',
              background: n.isRead ? 'transparent' : 'rgba(184, 255, 106, 0.04)',
              cursor: n.projectId ? 'pointer' : 'default',
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: n.isRead ? 600 : 800,
                  color: 'var(--text)',
                }}
              >
                {n.title}
              </span>
              <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0, fontWeight: 500 }}>
                {formatRelativeTime(n.createdAt)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
              {truncateBody(n.body)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
