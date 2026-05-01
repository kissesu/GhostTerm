/**
 * @file NotificationBell.tsx
 * @description titlebar 通知铃铛 - 渲染未读数 badge；点击切到通知中心视图
 *              未读数 > 0 时显示红色角标（最大显示 99+）
 *              a11y：有未读时 aria-label 含具体数量
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';

export function NotificationBell(): ReactElement {
  // Zustand 5 selector 稳定引用：每 selector 独立拆分，避免新对象触发重渲
  const unread = useNotificationsStore((s) => s.unreadCount);
  const setView = useProgressUiStore((s) => s.setCurrentView);
  const closeProject = useProgressUiStore((s) => s.closeProject);

  return (
    <button
      type="button"
      onClick={() => {
        // 关闭当前详情页（若有），再切到通知中心视图
        closeProject();
        setView('notifications');
      }}
      aria-label={unread > 0 ? `${unread} 条未读通知` : '通知中心'}
      style={{
        position: 'relative',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 6,
      }}
    >
      {/* Bell icon — 1:1 设计稿 inline SVG；不引入额外依赖 */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10 21a2 2 0 0 0 4 0" />
      </svg>

      {/* 未读角标：> 0 才显示 */}
      {unread > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            /* 用 hex 而非 var(--red)：NotificationBell 在 AppLayout 渲染不在 .shellRoot 内，
               progress.module.css 的 token 不能解析；hex 写死保证红色稳定 */
            background: '#ef4444',
            color: '#fff',
            fontSize: 10,
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #0d0d0c',  /* 与背景 dark 形成 cutout 视觉，badge 更突出 */
            boxShadow: '0 0 0 1px rgba(239,68,68,0.4)',  /* 红光晕 */
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}
