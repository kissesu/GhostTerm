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

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import { useNotificationsStore } from '../stores/notificationsStore';
import { NotificationPanel } from './NotificationPanel';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // 容器 ref：用于 click-outside 关闭判定（包裹 button + panel 共同区域）
  const containerRef = useRef<HTMLDivElement>(null);
  // 直接订阅 notifications 数组（稳定引用），用 useMemo 之外的 selector 派生 unreadCount
  const notifications = useNotificationsStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // 点击 panel 外部关闭：仅在 open 时挂载 listener，避免长期占用
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={unreadCount > 0 ? `${unreadCount} 条未读通知` : '通知中心'}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: 6,
          borderRadius: 4,
          border: '1px solid var(--c-border)',
          background: 'transparent',
          color: 'var(--c-fg)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          position: 'relative',
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
              background: 'var(--c-danger, #d04545)',
              color: '#fff',
              fontSize: 10,
              lineHeight: '16px',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
