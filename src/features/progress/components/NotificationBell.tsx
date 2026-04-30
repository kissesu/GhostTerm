/**
 * @file NotificationBell.tsx
 * @description 顶部通知铃铛 + 未读数 badge（Phase 12）。
 *
 *              业务流程：
 *               - 渲染 lucide-react Bell 图标
 *               - 仅当 unreadCount > 0 时渲染右上角红点 badge（数字截断 99+）
 *               - 点击切换 NotificationPanel 弹窗（受控状态：本地 useState）
 *
 *              交互细节：
 *               - 点击铃铛切换面板开关
 *               - 面板已打开时再点击 → 关闭
 *               - Esc 键关闭面板由 NotificationPanel 内部 useEffect 处理
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { Bell } from 'lucide-react';

import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';

/**
 * 通知铃铛：点击进入通知中心全屏页面（progressUiStore.currentView='notifications'）。
 * 用户需求修正 2026-04-30：原 dropdown panel 改为切到独立通知中心 view，
 * 让"返回上一视图"语义清晰（详情页 handleBack 通过 priorView 字段决定回到哪）。
 */
export function NotificationBell() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);

  const handleClick = () => {
    // 关闭可能打开的详情页 + 切到通知中心全屏 view
    setSelectedProject(null);
    setCurrentView('notifications');
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={unreadCount > 0 ? `${unreadCount} 条未读通知` : '通知中心'}
        onClick={handleClick}
        style={{
          padding: '5px 8px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'transparent',
          color: 'var(--muted)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          position: 'relative',
          fontFamily: 'inherit',
        }}
      >
        <Bell size={14} aria-hidden="true" />
        {/* 仅当有未读时渲染 badge —— 测试用 data-testid 守 */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--red)',
              color: '#fff5f4',
              fontSize: 10,
              lineHeight: '16px',
              textAlign: 'center',
              fontWeight: 800,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
