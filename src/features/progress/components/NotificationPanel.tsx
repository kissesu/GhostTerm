/**
 * @file NotificationPanel.tsx
 * @description 通知中心下拉面板（Phase 12）。
 *
 *              业务流程：
 *               - 渲染 notifications 数组前 20 条（store 已 DESC 排序）
 *               - 每条显示：title（未读加粗）+ body（截 80 字）+ 相对时间
 *               - 点击条目：markRead + （若 projectId）调 progressUiStore.setSelectedProject
 *               - "全部已读" 按钮：调 markAllRead
 *               - Esc 键关闭面板（onClose 回调）
 *
 *              视觉：固定相对铃铛右下角，宽 320，最高 400 内滚动。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect } from 'react';
import { CheckCheck } from 'lucide-react';

import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import type { Notification } from '../api/notifications';

interface NotificationPanelProps {
  onClose: () => void;
}

/** 截断 body：超过 80 字符加省略号 */
function truncateBody(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * ISO 时间 → 中文相对时间。
 *
 * 业务背景：UI 习惯"刚刚 / 5 分钟前 / 2 小时前 / 3 天前"，超 7 天显示日期
 */
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

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const notifications = useNotificationsStore((s) => s.notifications);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  // 仅显示前 20 条
  const visible = notifications.slice(0, 20);
  const hasUnread = notifications.some((n) => !n.isRead);

  // Esc 键关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 点击条目：若有 projectId 则跳转项目详情，记录 priorView=notifications 供详情页"返回"按钮智能回到通知中心
  const handleItemClick = (n: Notification) => {
    if (!n.isRead) {
      void markRead(n.id);
    }
    if (n.projectId !== null && n.projectId !== undefined) {
      // 切到通知中心 view + 记录 priorView，让详情页 handleBack 知道回哪
      setCurrentView('notifications');
      openProjectFromView(n.projectId, 'notifications');
      onClose();
    }
  };
  // 兜底：避免 setSelectedProject 在 useNotificationPanel 未引用时被 lint 标 dead；保留 reference
  void setSelectedProject;

  return (
    <div
      data-testid="notification-panel"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 320,
        maxHeight: 400,
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--c-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--c-fg)' }}>通知中心</span>
        {hasUnread && (
          <button
            type="button"
            data-testid="notification-mark-all-read"
            onClick={() => void markAllRead()}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--c-fg-muted)',
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CheckCheck size={12} aria-hidden="true" /> 全部已读
          </button>
        )}
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {visible.length === 0 && (
          <div
            data-testid="notification-empty"
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--c-fg-muted)',
              fontSize: 12,
            }}
          >
            暂无通知
          </div>
        )}
        {visible.map((n) => (
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
              padding: '10px 12px',
              borderBottom: '1px solid var(--c-border)',
              background: n.isRead ? 'transparent' : 'var(--c-bg)',
              cursor: 'pointer',
              border: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: n.isRead ? 400 : 600,
                color: 'var(--c-fg)',
                marginBottom: 2,
              }}
            >
              {n.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--c-fg-muted)',
                marginBottom: 4,
              }}
            >
              {truncateBody(n.body)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--c-fg-muted)',
              }}
            >
              {formatRelativeTime(n.createdAt)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
